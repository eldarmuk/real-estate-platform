export type Listing = {
  id: number;
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
  rawAttributes: Record<string, string | number | null> | null;
  scrapedAt: string;
};

export type ListingResponse = {
  items: Listing[];
  total: number;
  page: number;
  pageSize: number;
};

export type ListingFilters = {
  search?: string;
  location?: string;
  propertyType?: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  minSurface?: number | null;
  maxSurface?: number | null;
  minRooms?: number | null;
  sort?: string;
  page?: number;
  pageSize?: number;
};

export type ListingStats = {
  total: number;
  priceMin: number | null;
  priceMax: number | null;
  surfaceMin: number | null;
  surfaceMax: number | null;
  propertyTypes: Array<{ name: string; count: number }>;
};

export type AiRecommendationResponse = {
  explanation: string;
  filters: ListingFilters & { reasoning?: string };
  items: Listing[];
};
