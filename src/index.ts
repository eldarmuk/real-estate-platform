import 'dotenv/config'; 
import type { Prisma } from '@prisma/client';
import express from 'express';
import { prisma } from './prisma.js';

const app = express();

const PORT = process.env.PORT || 3000;

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

  const where: Prisma.ListingWhereInput = filters.length > 0 ? { AND: filters } : {};

  const [items, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.listing.count({ where }),
  ]);

  res.json({ items, total, page, pageSize });
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

function parseOptionalNumber(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
