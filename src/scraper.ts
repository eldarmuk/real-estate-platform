import axios from 'axios';
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from './prisma.js';

const BASE_URL = 'https://adresowo.pl';
const DEFAULT_START_URLS = [
  `${BASE_URL}/domy/`,
  `${BASE_URL}/domy/f2/`,
  `${BASE_URL}/domy/f3/`,
  `${BASE_URL}/domy/f4/`,
  `${BASE_URL}/domy/f5/`,
  `${BASE_URL}/mieszkania/`,
  `${BASE_URL}/mieszkania/f2/`,
  `${BASE_URL}/mieszkania/f3/`,
];

const MAX_LISTINGS = Number(process.env.SCRAPE_LIMIT ?? 100);
const REQUEST_DELAY_MS = Number(process.env.SCRAPE_DELAY_MS ?? 900);
const HTML_DIR = process.env.ADRESOWO_HTML_DIR?.trim();
const CLI_ARGS = process.argv.slice(2).filter((arg) => arg !== '--');
const SITEMAP_ENABLED = (process.env.SCRAPE_SITEMAP ?? 'false').toLowerCase() === 'true' || CLI_ARGS.includes('--sitemap');
const CLEAN_ENABLED = (process.env.SCRAPE_CLEAN ?? 'false').toLowerCase() === 'true' || CLI_ARGS.includes('--clean');
const QUEUE_LINK_LIMIT = Number(process.env.SCRAPE_QUEUE_LIMIT ?? 80);
const CANDIDATE_TARGET = Number(process.env.SCRAPE_CANDIDATE_TARGET ?? Math.max(MAX_LISTINGS * 5, 300));
const LOCAL_MODEL_PATH = process.env.LOCAL_LLM_MODEL_PATH ?? path.resolve(process.cwd(), 'models', 'llama-3.1.gguf');
const LOCAL_MODEL_COMMAND = process.env.LLAMA_CLI_PATH ?? 'llama-cli';
const LOCAL_MODEL_ENABLED = (process.env.LOCAL_LLM_ENRICH ?? 'true').toLowerCase() !== 'false';
const START_URLS = (process.env.ADRESOWO_START_URLS?.split(',') ?? DEFAULT_START_URLS)
  .map((url) => url.trim())
  .filter(Boolean);

type ScrapedListing = {
  title: string;
  url: string;
  source: string;
  propertyType: string | null;
  transactionType: string | null;
  location: string | null;
  price: number | null;
  pricePerSqm: number | null;
  sizeSqm: number | null;
  plotSizeSqm: number | null;
  constructionYear: number | null;
  rooms: number | null;
  houseType: string | null;
  imageUrl: string | null;
  rawDescription: string;
  rawAttributes: Record<string, string | number | null>;
};

let localModelWarningShown = false;

async function fetchHtml(url: string): Promise<string> {
  const response = await axios.get<string>(url, {
    timeout: 20_000,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.7',
      'Cache-Control': 'no-cache',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0 Safari/537.36 RealEstateRecruitmentTask/1.0',
    },
  });

  return response.data;
}

async function collectListingUrls(): Promise<string[]> {
  const urls = new Set<string>();
  const queue = [...START_URLS];
  const visited = new Set<string>();
  const existingSet = await getExistingListingUrlSet();

  if (SITEMAP_ENABLED) {
    await seedFromSitemaps(queue);
  }

  while (queue.length > 0 && getNewUrlCount(urls, existingSet) < MAX_LISTINGS && urls.size < CANDIDATE_TARGET) {
    const pageUrl = queue.shift();
    if (!pageUrl || visited.has(pageUrl)) continue;

    visited.add(pageUrl);
    console.log(`Scanning: ${pageUrl}`);

    if (isListingUrl(pageUrl)) {
      urls.add(stripHash(pageUrl));
      continue;
    }

    const html = await fetchHtml(pageUrl);
    const $ = cheerio.load(html);

    $('a[href]').each((_, element) => {
      const absoluteUrl = toAdresowoPageUrl($(element).attr('href'));
      if (!absoluteUrl) return;

      if (isListingUrl(absoluteUrl)) {
        urls.add(stripHash(absoluteUrl));
        return;
      }

      if (isPaginationUrl(absoluteUrl) && !visited.has(absoluteUrl) && queue.length < QUEUE_LINK_LIMIT) {
        queue.push(stripHash(absoluteUrl));
      }
    });

    await sleep(REQUEST_DELAY_MS);
  }

  const candidates = [...urls];
  if (candidates.length === 0) return [];

  const filtered = CLEAN_ENABLED ? candidates : candidates.filter((url) => !existingSet.has(url));
  console.log(`Collected ${candidates.length} candidates, ${filtered.length} new after DB filtering.`);
  return filtered.slice(0, MAX_LISTINGS);
}

async function fetchSitemapUrls(startUrl: string): Promise<string[]> {
  const origin = new URL(startUrl).origin;
  const tried: string[] = [new URL('/sitemap.xml', origin).toString(), new URL('/sitemap_index.xml', origin).toString()];
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const sitemapUrl of tried) {
    await collectFromSitemap(sitemapUrl, origin, urls, seen, 0);
  }

  return Array.from(new Set(urls)).filter(isListingUrl).slice(0, CANDIDATE_TARGET);
}

async function seedFromSitemaps(queue: string[]): Promise<void> {
  console.log('Sitemap discovery enabled.');

  for (const startUrl of START_URLS) {
    try {
      const discovered = await fetchSitemapUrls(startUrl);
      for (const url of discovered) {
        if (queue.length >= CANDIDATE_TARGET) return;
        queue.push(stripHash(url));
      }
    } catch (error) {
      console.warn('Sitemap fetch failed for', startUrl, error instanceof Error ? error.message : error);
    }
  }
}

async function collectFromSitemap(
  sitemapUrl: string,
  origin: string,
  urls: string[],
  seen: Set<string>,
  depth: number,
): Promise<void> {
  if (seen.has(sitemapUrl) || depth > 3 || urls.length >= CANDIDATE_TARGET) return;
  seen.add(sitemapUrl);

  try {
    const res = await axios.get<string>(sitemapUrl, { timeout: 10_000 });
    if (res.status !== 200 || !res.data) return;

    for (const loc of parseSitemapXml(res.data)) {
      try {
        const url = new URL(loc);
        if (url.hostname !== new URL(origin).hostname) continue;

        if (url.pathname.endsWith('.xml')) {
          await collectFromSitemap(url.toString(), origin, urls, seen, depth + 1);
        } else if (isListingUrl(url.toString())) {
          urls.push(url.toString());
        }
      } catch {
        continue;
      }
    }
  } catch {
    return;
  }
}

function parseSitemapXml(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)]
    .map((match) => match[1])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim());
}

async function cleanExistingListings(): Promise<void> {
  const result = await prisma.listing.deleteMany({ where: { source: 'adresowo.pl' } });
  console.log(`Cleaned ${result.count} existing Adresowo listings.`);
}

async function getExistingListingUrlSet(): Promise<Set<string>> {
  if (CLEAN_ENABLED) return new Set();

  try {
    const existing = await prisma.listing.findMany({
      where: { source: 'adresowo.pl' },
      select: { url: true },
    });
    return new Set(existing.map((listing) => listing.url));
  } catch (error) {
    console.warn('DB check for existing URLs failed:', error instanceof Error ? error.message : error);
    return new Set();
  }
}

function getNewUrlCount(urls: Set<string>, existingSet: Set<string>): number {
  if (CLEAN_ENABLED) return urls.size;

  let count = 0;
  for (const url of urls) {
    if (!existingSet.has(url)) count += 1;
  }
  return count;
}

function toAdresowoPageUrl(href: string | undefined): string | null {
  if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) return null;

  try {
    const url = new URL(href, BASE_URL);
    if (url.hostname !== 'adresowo.pl') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isListingUrl(url: string): boolean {
  return new URL(url).pathname.startsWith('/o/');
}

function isPaginationUrl(url: string): boolean {
  const pathname = new URL(url).pathname;
  return (
    pathname === '/domy/' ||
    pathname === '/mieszkania/' ||
    /^\/domy\/f\d+\/?$/.test(pathname) ||
    /^\/mieszkania\/f\d+\/?$/.test(pathname)
  );
}

function stripHash(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  return parsed.toString();
}

async function importSavedHtmlListings(directory: string): Promise<number> {
  const files = await collectHtmlFiles(directory);
  console.log(`Importing saved Adresowo HTML from: ${directory}`);
  console.log(`Found ${files.length} HTML files.`);

  let saved = 0;
  for (const file of files) {
    if (saved >= MAX_LISTINGS) break;

    const html = await readFile(file, 'utf8');
    const url = inferUrlFromHtml(html) ?? `saved-html://${path.basename(file)}`;
    const listing = parseListing(html, url);
    if (!listing) {
      console.log(`Skipped non-listing or incomplete HTML: ${file}`);
      continue;
    }

    await saveListing(await enrichMissingFields(listing));
    saved += 1;
    console.log(`Saved ${saved}/${MAX_LISTINGS}: ${listing.title}`);
  }

  return saved;
}

async function collectHtmlFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectHtmlFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && /\.(html?|xhtml)$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function inferUrlFromHtml(html: string): string | null {
  const $ = cheerio.load(html);
  return firstNonEmpty(
    $('link[rel="canonical"]').attr('href'),
    getMeta($, 'og:url'),
    $('[data-url]').first().attr('data-url'),
  );
}

function parseListing(html: string, url: string): ScrapedListing | null {
  const $ = cheerio.load(html);
  const bodyText = cleanText($('body').text());
  const pageTitle = cleanText($('title').text()).replace(/\s*\|\s*Adresowo\.pl\s*$/i, '');
  const metaDescription = firstNonEmpty(getMeta($, 'description'), getMeta($, 'og:description'));
  const jsonLd = extractJsonLdPlace($);

  const title = firstNonEmpty(buildOfferTitle($), getMeta($, 'og:title'), pageTitle);
  const rawDescription = cleanDescription(firstNonEmpty(cleanText($('#description').text()), jsonLd.description, metaDescription));
  if (!title || !rawDescription) return null;

  const pricePerSqm = parsePricePerSqm(bodyText);
  const price = parsePrice(pageTitle, bodyText, pricePerSqm);
  const sizeSqm = parseSurface(pageTitle, metaDescription, rawDescription);
  const plotSizeSqm = parsePlotSize(metaDescription, rawDescription, bodyText);
  const constructionYear = parseConstructionYear(bodyText, rawDescription);
  const rooms = parseRooms(metaDescription, rawDescription);
  const rawAttributes = extractAttributes($);

  rawAttributes.price = price;
  rawAttributes.pricePerSqm = pricePerSqm;
  rawAttributes.sizeSqm = sizeSqm;
  rawAttributes.plotSizeSqm = plotSizeSqm;
  rawAttributes.constructionYear = constructionYear;
  rawAttributes.rooms = rooms;

  return {
    title,
    url,
    source: 'adresowo.pl',
    propertyType: inferPropertyType(title, bodyText),
    transactionType: inferTransactionType(pageTitle, bodyText),
    location: extractLocation($, jsonLd.address, title),
    price,
    pricePerSqm,
    sizeSqm,
    plotSizeSqm,
    constructionYear,
    rooms,
    houseType: inferHouseType(title, bodyText),
    imageUrl: extractImageUrl($),
    rawDescription,
    rawAttributes,
  };
}

async function enrichMissingFields(listing: ScrapedListing): Promise<ScrapedListing> {
  const missingFields = getMissingFieldNames(listing);
  if (missingFields.length === 0 || !LOCAL_MODEL_ENABLED) return listing;

  console.log(`Local model checking ${listing.title}: missing ${missingFields.join(', ')}`);
  const aiFields = await askLocalModelForMissingFields(listing, missingFields);
  if (!aiFields) {
    console.log(`Local model made no changes for ${listing.title}`);
    return listing;
  }

  const enriched: ScrapedListing = {
    ...listing,
    propertyType: listing.propertyType ?? normalizePropertyType(aiFields.propertyType),
    transactionType: listing.transactionType ?? normalizeTransactionType(aiFields.transactionType),
    location: listing.location ?? cleanOptionalString(aiFields.location),
    price: listing.price ?? cleanOptionalNumber(aiFields.price),
    pricePerSqm: listing.pricePerSqm ?? cleanOptionalNumber(aiFields.pricePerSqm),
    sizeSqm: listing.sizeSqm ?? cleanOptionalNumber(aiFields.sizeSqm),
    plotSizeSqm: listing.plotSizeSqm ?? cleanOptionalNumber(aiFields.plotSizeSqm),
    constructionYear: listing.constructionYear ?? cleanOptionalInteger(aiFields.constructionYear),
    rooms: listing.rooms ?? cleanOptionalInteger(aiFields.rooms),
    houseType: listing.houseType ?? cleanOptionalString(aiFields.houseType),
  };

  enriched.rawAttributes = {
    ...enriched.rawAttributes,
    localModelChecked: new Date().toISOString(),
    localModelFieldsRequested: missingFields.join(', '),
  };

  const changes = describeEnrichmentChanges(listing, enriched, missingFields);
  if (changes.length > 0) {
    enriched.rawAttributes.localModelFieldsChanged = changes.join('; ');
    console.log(`Local model enriched ${listing.title}: ${changes.join('; ')}`);
  } else {
    console.log(`Local model checked ${listing.title}, but did not fill any missing field.`);
  }

  return enriched;
}

function getMissingFieldNames(listing: ScrapedListing): string[] {
  return ([
    'propertyType',
    'transactionType',
    'location',
    'price',
    'pricePerSqm',
    'sizeSqm',
    'plotSizeSqm',
    'constructionYear',
    'rooms',
    'houseType',
  ] as const).filter((field) => listing[field] === null);
}

async function askLocalModelForMissingFields(listing: ScrapedListing, missingFields: string[]): Promise<Partial<ScrapedListing> | null> {
  if (!existsSync(LOCAL_MODEL_PATH)) return null;

  const prompt = [
    'Extract missing real-estate fields from this Polish listing.',
    'Return only compact JSON. Use null when the value is not explicitly supported by the text.',
    'Allowed keys: propertyType, transactionType, location, price, pricePerSqm, sizeSqm, plotSizeSqm, constructionYear, rooms, houseType.',
    `Missing keys to check: ${missingFields.join(', ')}`,
    `Known values: ${JSON.stringify({
      title: listing.title,
      propertyType: listing.propertyType,
      transactionType: listing.transactionType,
      location: listing.location,
      price: listing.price,
      pricePerSqm: listing.pricePerSqm,
      sizeSqm: listing.sizeSqm,
      plotSizeSqm: listing.plotSizeSqm,
      constructionYear: listing.constructionYear,
      rooms: listing.rooms,
      houseType: listing.houseType,
    })}`,
    `Description: ${listing.rawDescription.slice(0, 1800)}`,
  ].join('\n');

  try {
    const output = await runLocalModel(prompt);
    return parseLocalModelJson(output);
  } catch (error) {
    if (!localModelWarningShown) {
      console.warn(
        `Local model enrichment skipped: ${error instanceof Error ? error.message : error}. ` +
          'Set LLAMA_CLI_PATH to a llama.cpp compatible executable, or LOCAL_LLM_ENRICH=false to disable this hook.',
      );
      localModelWarningShown = true;
    }
    return null;
  }
}

function runLocalModel(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(LOCAL_MODEL_COMMAND, ['-m', LOCAL_MODEL_PATH, '-p', prompt, '-n', '220', '--temp', '0'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('local model timed out'));
    }, Number(process.env.LOCAL_LLM_TIMEOUT_MS ?? 45_000));

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `local model exited with code ${code}`));
    });
  });
}

function parseLocalModelJson(output: string): Partial<ScrapedListing> | null {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(output.slice(start, end + 1)) as Partial<ScrapedListing>;
  } catch {
    return null;
  }
}

function describeEnrichmentChanges(before: ScrapedListing, after: ScrapedListing, checkedFields: string[]): string[] {
  return checkedFields
    .filter((field) => before[field as keyof ScrapedListing] === null && after[field as keyof ScrapedListing] !== null)
    .map((field) => `${field}=${String(after[field as keyof ScrapedListing])}`);
}

function buildOfferTitle($: CheerioAPI): string | null {
  const header = $('#offer-navigation h1');
  const category = cleanText(header.find('div').first().text());
  const street = cleanText(header.find('span').eq(0).text());
  const location = cleanText(header.find('span').eq(1).text());
  return [category, street, location].filter(Boolean).join(' ').trim() || null;
}

function extractAttributes($: CheerioAPI): Record<string, string | number | null> {
  const attributes: Record<string, string | number | null> = {};
  const selectors = ['main section[aria-label]', '#offer-navigation'];

  for (const selector of selectors) {
    $(selector).each((_, element) => addAttributeFromText(attributes, cleanText($(element).text())));
  }

  return attributes;
}

function addAttributeFromText(attributes: Record<string, string | number | null>, text: string): void {
  if (!text || text.length > 260) return;

  for (const separator of [':', '\uff1a']) {
    const index = text.indexOf(separator);
    if (index <= 0) continue;

    const label = text.slice(0, index).trim();
    const value = text.slice(index + 1).trim();
    if (label.length >= 2 && label.length <= 60 && value) {
      attributes[normalizeLabel(label)] = value;
    }
  }
}

function parsePrice(title: string, text: string, pricePerSqm: number | null): number | null {
  const titleMatch = normalizeLabel(normalizeNumericText(title)).match(/-\s*([\d\s,.]+)\s*(?:zl|pln)\s*$/i);
  if (titleMatch?.[1]) return parsePolishNumber(titleMatch[1]);

  const matches = [...normalizeLabel(normalizeNumericText(text)).matchAll(/([\d\s,.]+)\s*(?:zl|pln)\b/gi)]
    .map((match) => parsePolishNumber(match[1] ?? ''))
    .filter((value): value is number => value !== null);

  return matches.find((value) => value !== pricePerSqm && value > 20_000) ?? null;
}

function parsePricePerSqm(text: string): number | null {
  const match = normalizeLabel(normalizeNumericText(text)).match(/([\d\s,.]+)\s*zl\s*\/\s*m(?:2|\u00b2|kw\.?)/i);
  return match?.[1] ? parsePolishNumber(match[1]) : null;
}

function parseSurface(...texts: Array<string | null | undefined>): number | null {
  for (const text of texts) {
    const normalized = normalizeNumericText(text ?? '');
    const titleMatch = normalized.match(/-\s*(\d+(?:[,.]\d+)?)\s*m(?:2|\u00b2|kw\.?)(?:\s*-|$)/i);
    if (titleMatch?.[1]) return Number(titleMatch[1].replace(',', '.'));

    const descriptionMatch = normalizeLabel(normalized).match(/powierzchni(?:a)?(?: domu)?\s*(\d+(?:[,.]\d+)?)\s*m(?:2|kw)?/i);
    if (descriptionMatch?.[1]) return Number(descriptionMatch[1].replace(',', '.'));
  }

  return null;
}

function parsePlotSize(...texts: Array<string | null | undefined>): number | null {
  for (const text of texts) {
    const match = normalizeLabel(text ?? '').match(
      /(?:dzialk(?:a|i|e|ce)|plot|powierzchnia dzialki)[^0-9]{0,80}(\d+(?:[,.]\d+)?)\s*m/i,
    );
    if (match?.[1]) return Number(match[1].replace(',', '.'));
  }

  return null;
}

function parseConstructionYear(...texts: Array<string | null | undefined>): number | null {
  for (const text of texts) {
    const match = normalizeLabel(text ?? '').match(/(?:rok budowy|year of construction|wybudowan[yoa] w)\D*(19\d{2}|20\d{2})/);
    if (match?.[1]) return Number(match[1]);
  }

  return null;
}

function parseRooms(...texts: Array<string | null | undefined>): number | null {
  for (const text of texts) {
    const match = normalizeLabel(text ?? '').match(/(\d+)\s*(?:pokoi|pokoje|pok\.?|rooms?)/i);
    if (match?.[1]) return Number(match[1]);
  }

  return null;
}

function extractLocation($: CheerioAPI, jsonLdAddress: string | null, title: string): string | null {
  const headerLocation = cleanText($('#offer-navigation h1 span').eq(1).text());
  if (headerLocation) return headerLocation;

  if (jsonLdAddress) {
    const parts = jsonLdAddress.split(',').map((part) => part.trim());
    return parts.slice(1, -1).join(', ') || parts[1] || null;
  }

  return title.match(/^(?:Dom|Mieszkanie)\s+([^,]+)/i)?.[1]?.trim() ?? null;
}

function inferPropertyType(title: string, text: string): string | null {
  const titleOnly = normalizeLabel(title);
  if (titleOnly.includes('mieszkanie')) return 'Mieszkanie';
  if (titleOnly.includes('dom')) return 'Dom';
  if (titleOnly.includes('dzialka')) return 'Dzialka';

  const haystack = normalizeLabel(`${title} ${text}`);
  if (haystack.includes('mieszkanie')) return 'Mieszkanie';
  if (haystack.includes('dom')) return 'Dom';
  if (haystack.includes('dzialka')) return 'Dzialka';
  return null;
}

function inferTransactionType(title: string, text: string): string {
  const titleOnly = normalizeLabel(title);
  if (titleOnly.includes('na sprzedaz')) return 'sprzedaz';
  if (titleOnly.includes('wynajem') || titleOnly.includes('do wynajecia')) return 'wynajem';

  const haystack = normalizeLabel(text);
  return haystack.includes('wynajem') || haystack.includes('do wynajecia') ? 'wynajem' : 'sprzedaz';
}

function inferHouseType(title: string, text: string): string | null {
  const haystack = normalizeLabel(`${title} ${text}`);
  if (haystack.includes('blizniak')) return 'blizniak';
  if (haystack.includes('wolnostojacy')) return 'wolnostojacy';
  if (haystack.includes('szeregowy')) return 'szeregowy';
  if (haystack.includes('siedlisko')) return 'siedlisko';
  return null;
}

function normalizePropertyType(value: unknown): string | null {
  const normalized = normalizeLabel(String(value ?? ''));
  if (normalized.includes('mieszkanie')) return 'Mieszkanie';
  if (normalized.includes('dom')) return 'Dom';
  if (normalized.includes('dzialka')) return 'Dzialka';
  return null;
}

function normalizeTransactionType(value: unknown): string | null {
  const normalized = normalizeLabel(String(value ?? ''));
  if (normalized.includes('wynajem') || normalized.includes('do wynajecia')) return 'wynajem';
  if (normalized.includes('sprzedaz') || normalized.includes('na sprzedaz')) return 'sprzedaz';
  return null;
}

function cleanOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = cleanText(value);
  return cleaned.length > 0 && cleaned.toLowerCase() !== 'null' ? cleaned : null;
}

function cleanOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  return parsePolishNumber(value);
}

function cleanOptionalInteger(value: unknown): number | null {
  const parsed = cleanOptionalNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

function extractImageUrl($: CheerioAPI): string | null {
  const image = firstNonEmpty(getMeta($, 'og:image'), $('main img').first().attr('src'), $('main img').first().attr('data-src'));
  if (!image) return null;

  try {
    return new URL(image, BASE_URL).toString();
  } catch {
    return null;
  }
}

function extractJsonLdPlace($: CheerioAPI): { address: string | null; description: string | null } {
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    try {
      const parsed = JSON.parse($(element).text()) as unknown;
      const graph = isRecord(parsed) && Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed];

      for (const item of graph) {
        if (!isRecord(item)) continue;

        const address = isRecord(item.address) ? item.address.streetAddress : null;
        const description = typeof item.description === 'string' ? item.description : null;
        if (typeof address === 'string' || description) {
          return { address: typeof address === 'string' ? address : null, description };
        }
      }
    } catch {
      continue;
    }
  }

  return { address: null, description: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parsePolishNumber(value: string): number | null {
  const normalized = value
    .replace(/\u00a0/g, ' ')
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/[^\d.]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLabel(label: string): string {
  return cleanText(label)
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeNumericText(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/[\u2013\u2014]/g, '-');
}

function cleanDescription(text: string | null): string | null {
  const cleaned = cleanText(text)
    .replace(/\bZobacz podobne oferty\b.*$/i, '')
    .replace(/\bKontakt\b.*$/i, '')
    .replace(/\bOferta dodana\b.*$/i, '')
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}

function cleanText(text: string | null | undefined): string {
  return (text ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  return values.find((value) => value && value.trim().length > 0)?.trim() ?? null;
}

function getMeta($: CheerioAPI, name: string): string | null {
  return cleanText(
    $(`meta[name="${name}"]`).attr('content') ??
      $(`meta[property="${name}"]`).attr('content') ??
      $(`meta[property="og:${name}"]`).attr('content'),
  );
}

async function saveListing(listing: ScrapedListing): Promise<void> {
  await prisma.listing.upsert({
    where: { url: listing.url },
    update: {
      ...listing,
      scrapedAt: new Date(),
    },
    create: listing,
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrapeListings(): Promise<void> {
  if (CLEAN_ENABLED) {
    await cleanExistingListings();
  }

  if (HTML_DIR) {
    const saved = await importSavedHtmlListings(HTML_DIR);
    console.log(`Saved HTML import complete. Saved ${saved} listings.`);
    return;
  }

  console.log(`Starting Adresowo scraper. Target: ${MAX_LISTINGS} listings.`);
  console.log(`Start URLs: ${START_URLS.join(', ')}`);

  const urls = await collectListingUrls();
  console.log(`Found ${urls.length} candidate listing URLs.`);

  let saved = 0;
  for (const url of urls) {
    try {
      console.log(`Fetching listing: ${url}`);
      const html = await fetchHtml(url);
      const listing = parseListing(html, url);

      if (!listing) {
        console.log(`Skipped listing with missing title/description: ${url}`);
        continue;
      }

      await saveListing(await enrichMissingFields(listing));
      saved += 1;
      console.log(`Saved ${saved}/${MAX_LISTINGS}: ${listing.title}`);

      if (saved >= MAX_LISTINGS) break;
      await sleep(REQUEST_DELAY_MS);
    } catch (error) {
      console.error(`Failed to scrape ${url}`);
      console.error(error instanceof Error ? error.message : error);
    }
  }

  console.log(`Scraping complete. Saved ${saved} listings.`);
}

scrapeListings()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
