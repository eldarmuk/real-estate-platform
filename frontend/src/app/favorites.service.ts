import { Injectable, signal } from '@angular/core';
import { Listing } from './models';

const STORAGE_KEY = 'real-estate-favorites';

@Injectable({ providedIn: 'root' })
export class FavoritesService {
  readonly favorites = signal<Listing[]>(loadFavorites());

  isFavorite(id: number): boolean {
    return this.favorites().some((listing) => listing.id === id);
  }

  toggle(listing: Listing): void {
    const exists = this.isFavorite(listing.id);
    const next = exists ? this.favorites().filter((item) => item.id !== listing.id) : [listing, ...this.favorites()];
    this.favorites.set(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  clear(): void {
    this.favorites.set([]);
    localStorage.removeItem(STORAGE_KEY);
  }
}

function loadFavorites(): Listing[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Listing[]) : [];
  } catch {
    return [];
  }
}
