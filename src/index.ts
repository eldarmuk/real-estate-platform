import 'dotenv/config'; 
import type { Prisma } from '@prisma/client';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from './prisma.js';

const app = express();

const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Real estate API is running!' });
});

app.get('/api/listings', async (req, res) => {
  const page = Math.max(Number(req.query.page ?? 1), 1);
  const pageSize = Math.min(Math.max(Number(req.query.pageSize ?? 20), 1), 50);
  const search = String(req.query.search ?? '').trim();
  const minPrice = parseOptionalNumber(req.query.minPrice);
  const maxPrice = parseOptionalNumber(req.query.maxPrice);
  const minSurface = parseOptionalNumber(req.query.minSurface);
  const maxSurface = parseOptionalNumber(req.query.maxSurface);
  const minRooms = parseOptionalNumber(req.query.minRooms);
  const maxRooms = parseOptionalNumber(req.query.maxRooms);
  const propertyType = parseOptionalString(req.query.propertyType);
  const location = parseOptionalString(req.query.location);
  const sort = parseOptionalString(req.query.sort) ?? 'newest';

  const filters: Prisma.ListingWhereInput[] = [];

  if (search) {
    filters.push({
      OR: [
        { title: { contains: search } },
        { location: { contains: search } },
        { rawDescription: { contains: search } },
      ],
    });
  }

  if (minPrice !== null) filters.push({ price: { gte: minPrice } });
  if (maxPrice !== null) filters.push({ price: { lte: maxPrice } });
  if (minSurface !== null) filters.push({ sizeSqm: { gte: minSurface } });
  if (maxSurface !== null) filters.push({ sizeSqm: { lte: maxSurface } });
  if (minRooms !== null) filters.push({ rooms: { gte: Math.round(minRooms) } });
  if (maxRooms !== null) filters.push({ rooms: { lte: Math.round(maxRooms) } });
  if (propertyType) filters.push({ propertyType: { equals: propertyType } });
  if (location) filters.push({ location: { contains: location } });

  const where: Prisma.ListingWhereInput = filters.length > 0 ? { AND: filters } : {};
  const orderBy = getListingOrder(sort);

  const [items, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.listing.count({ where }),
  ]);

  res.json({ items, total, page, pageSize });
});

app.get('/api/listings/stats/summary', async (_req, res) => {
  const [total, price, surface, propertyTypes] = await Promise.all([
    prisma.listing.count(),
    prisma.listing.aggregate({ _min: { price: true }, _max: { price: true } }),
    prisma.listing.aggregate({ _min: { sizeSqm: true }, _max: { sizeSqm: true } }),
    prisma.listing.groupBy({
      by: ['propertyType'],
      _count: { propertyType: true },
      orderBy: { _count: { propertyType: 'desc' } },
    }),
  ]);

  res.json({
    total,
    priceMin: price._min.price,
    priceMax: price._max.price,
    surfaceMin: surface._min.sizeSqm,
    surfaceMax: surface._max.sizeSqm,
    propertyTypes: propertyTypes
      .filter((item) => item.propertyType)
      .map((item) => ({ name: item.propertyType, count: item._count.propertyType })),
  });
});

app.get('/api/listings/:id', async (req, res) => {
  const id = Number(req.params.id);
  const listing = await prisma.listing.findUnique({ where: { id } });

  if (!listing) {
    res.status(404).json({ error: 'Listing not found' });
    return;
  }

  res.json(listing);
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

const frontendDist = path.resolve(process.cwd(), 'frontend', 'dist', 'frontend', 'browser');
app.use(express.static(frontendDist));
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

function parseOptionalNumber(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getListingOrder(sort: string): Prisma.ListingOrderByWithRelationInput {
  switch (sort) {
    case 'price-asc':
      return { price: 'asc' };
    case 'price-desc':
      return { price: 'desc' };
    case 'surface-desc':
      return { sizeSqm: 'desc' };
    case 'surface-asc':
      return { sizeSqm: 'asc' };
    default:
      return { scrapedAt: 'desc' };
  }
}
