export type AiSearchPlan = {
  search?: string;
  location?: string;
  propertyType?: string;
  minPrice?: number;
  maxPrice?: number;
  minSurface?: number;
  maxSurface?: number;
  minRooms?: number;
  sort?: string;
  reasoning?: string;
};

export type ListingSearchItem = {
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
  rawDescription: string;
  rawAttributes: unknown;
  scrapedAt: Date;
};

export type ListingQuery = {
  search: string;
  minPrice: number | null;
  maxPrice: number | null;
  minSurface: number | null;
  maxSurface: number | null;
  minRooms: number | null;
  maxRooms: number | null;
  propertyType: string | null;
  location: string | null;
  sort: string;
};

export function parseOptionalNumber(value: unknown): number | null {
  if (Array.isArray(value)) return parseOptionalNumber(value[0]);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;

  const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function queryFromAiPlan(plan: AiSearchPlan): ListingQuery {
  return {
    search: plan.search ?? '',
    location: plan.location ?? null,
    propertyType: plan.propertyType ?? null,
    minPrice: plan.minPrice ?? null,
    maxPrice: plan.maxPrice ?? null,
    minSurface: plan.minSurface ?? null,
    maxSurface: plan.maxSurface ?? null,
    minRooms: plan.minRooms ?? null,
    maxRooms: null,
    sort: plan.sort ?? 'newest',
  };
}

export function matchesListingQuery(listing: ListingSearchItem, query: ListingQuery): boolean {
  if (query.propertyType && normalizeForSearch(listing.propertyType) !== normalizeForSearch(query.propertyType)) return false;
  if (query.location && !matchesLocation(listing.location, query.location)) return false;
  if (query.minPrice !== null && !numberAtLeast(getListingNumber(listing, 'price'), query.minPrice)) return false;
  if (query.maxPrice !== null && !numberAtMost(getListingNumber(listing, 'price'), query.maxPrice)) return false;
  if (query.minSurface !== null && !numberAtLeast(getListingNumber(listing, 'sizeSqm'), query.minSurface)) return false;
  if (query.maxSurface !== null && !numberAtMost(getListingNumber(listing, 'sizeSqm'), query.maxSurface)) return false;
  if (query.minRooms !== null && !numberAtLeast(getListingNumber(listing, 'rooms'), Math.round(query.minRooms))) return false;
  if (query.maxRooms !== null && !numberAtMost(getListingNumber(listing, 'rooms'), Math.round(query.maxRooms))) return false;
  if (query.search && !matchesSearch(listing, query.search)) return false;

  return true;
}

export function matchesSearch(listing: ListingSearchItem, search: string): boolean {
  const terms = tokenize(search);
  if (terms.length === 0) return true;

  const searchText = normalizeForSearch(listingToSearchText(listing));
  const searchTokens = new Set(tokenize(searchText));
  return terms.every((term) => searchTokens.has(term) || searchText.includes(` ${term} `));
}

export function matchesLocation(location: string | null, query: string): boolean {
  if (!location) return false;

  const locationTokens = new Set(tokenize(location));
  return buildLocationVariants(query).some((variant) => {
    const terms = tokenize(variant);
    return terms.length > 0 && terms.every((term) => locationTokens.has(term));
  });
}

export function sortListings<T extends ListingSearchItem>(items: T[], sort: string): T[] {
  return [...items].sort((a, b) => compareListings(a, b, sort));
}

export function compareListings(a: ListingSearchItem, b: ListingSearchItem, sort: string): number {
  switch (sort) {
    case 'price-asc':
      return compareNullableNumber(a.price, b.price, 'asc');
    case 'price-desc':
      return compareNullableNumber(a.price, b.price, 'desc');
    case 'surface-asc':
      return compareNullableNumber(a.sizeSqm, b.sizeSqm, 'asc');
    case 'surface-desc':
      return compareNullableNumber(a.sizeSqm, b.sizeSqm, 'desc');
    default:
      return b.scrapedAt.getTime() - a.scrapedAt.getTime();
  }
}

export function normalizeForSearch(value: unknown): string {
  return ` ${removeDiacritics(String(value ?? '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

export function removeDiacritics(value: string): string {
  return value
    .replace(/\u0142/g, 'l')
    .replace(/\u0141/g, 'L')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function buildLocationVariants(location: string): string[] {
  const trimmed = location.trim();
  const normalized = removeDiacritics(trimmed).toLowerCase();
  const variants = new Set<string>([trimmed]);
  const known: Record<string, string[]> = {
    krakow: ['Kraków', 'Krakow'],
    lodz: ['Łódź', 'Lodz'],
    wroclaw: ['Wrocław', 'Wroclaw'],
    gdansk: ['Gdańsk', 'Gdansk'],
    poznan: ['Poznań', 'Poznan'],
  };

  for (const value of known[normalized] ?? []) {
    variants.add(value);
  }

  return [...variants];
}

function listingToSearchText(listing: ListingSearchItem): string {
  return [
    listing.title,
    listing.url,
    listing.source,
    listing.propertyType,
    listing.transactionType,
    listing.location,
    listing.price,
    listing.pricePerSqm,
    listing.sizeSqm,
    listing.plotSizeSqm,
    listing.constructionYear,
    listing.rooms,
    listing.houseType,
    listing.rawDescription,
    JSON.stringify(listing.rawAttributes ?? {}),
  ]
    .filter((value) => value !== null && value !== undefined)
    .join(' ');
}

function getListingNumber(listing: ListingSearchItem, field: 'price' | 'sizeSqm' | 'rooms'): number | null {
  const direct = listing[field];
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;

  const raw = isRecord(listing.rawAttributes) ? listing.rawAttributes : {};
  const fallbackKeys: Record<typeof field, string[]> = {
    price: ['price', 'cena'],
    sizeSqm: ['sizeSqm', 'powierzchnia', 'powierzchnia mieszkania', 'powierzchnia domu'],
    rooms: ['rooms', 'liczba pokoi', 'pokoje'],
  };

  for (const key of fallbackKeys[field]) {
    const value = raw[key];
    const parsed = parseOptionalNumber(value);
    if (parsed !== null) return parsed;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function tokenize(value: string): string[] {
  return normalizeForSearch(value)
    .split(/\s+/)
    .filter((term) => term.length >= 2);
}

function numberAtLeast(value: number | null, min: number): boolean {
  return typeof value === 'number' && value >= min;
}

function numberAtMost(value: number | null, max: number): boolean {
  return typeof value === 'number' && value <= max;
}

function compareNullableNumber(a: number | null, b: number | null, direction: 'asc' | 'desc'): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === 'asc' ? a - b : b - a;
}
