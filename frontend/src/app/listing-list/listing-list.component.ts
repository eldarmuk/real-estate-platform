import { AsyncPipe, CurrencyPipe, DecimalPipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BehaviorSubject, finalize, Observable, switchMap, tap } from 'rxjs';
import { FavoritesService } from '../favorites.service';
import { ListingApiService } from '../listing-api.service';
import { AiRecommendationResponse, Listing, ListingFilters, ListingResponse, ListingStats } from '../models';

type SearchMode = 'classic' | 'ai';
type ViewMode = 'grid' | 'list';

@Component({
  selector: 'app-listing-list',
  imports: [AsyncPipe, CurrencyPipe, DecimalPipe, NgClass, NgFor, NgIf, ReactiveFormsModule, RouterLink],
  templateUrl: './listing-list.component.html',
  styleUrl: './listing-list.component.css',
})
export class ListingListComponent {
  private readonly api = inject(ListingApiService);
  private readonly fb = inject(FormBuilder);
  readonly favorites = inject(FavoritesService);

  readonly aiLimit = 240;
  readonly pageSize = 12;
  readonly loading = signal(false);
  readonly aiLoading = signal(false);
  readonly aiError = signal<string | null>(null);
  readonly page = signal(1);
  readonly mode = signal<SearchMode>('classic');
  readonly viewMode = signal<ViewMode>('grid');
  readonly aiResult = signal<AiRecommendationResponse | null>(null);
  readonly stats$: Observable<ListingStats> = this.api.getStats();
  readonly refresh$ = new BehaviorSubject<void>(undefined);

  readonly filtersForm = this.fb.nonNullable.group({
    search: '',
    location: '',
    propertyType: '',
    minPrice: '',
    maxPrice: '',
    minSurface: '',
    maxSurface: '',
    minRooms: '',
    sort: 'newest',
  });
  readonly aiPrompt = this.fb.nonNullable.control('');

  readonly listings$ = this.refresh$.pipe(
    tap(() => this.loading.set(true)),
    switchMap(() => this.api.getListings(this.buildFilters()).pipe(finalize(() => this.loading.set(false)))),
  );

  setMode(mode: SearchMode): void {
    this.mode.set(mode);
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
  }

  applyFilters(): void {
    this.page.set(1);
    this.refresh$.next();
  }

  resetFilters(): void {
    this.page.set(1);
    this.filtersForm.reset({
      search: '',
      location: '',
      propertyType: '',
      minPrice: '',
      maxPrice: '',
      minSurface: '',
      maxSurface: '',
      minRooms: '',
      sort: 'newest',
    });
    this.refresh$.next();
  }

  searchWithAi(): void {
    const prompt = this.aiPrompt.value.trim();
    if (!prompt || prompt.length > this.aiLimit) return;

    this.aiLoading.set(true);
    this.aiError.set(null);
    this.api
      .recommend(prompt)
      .pipe(finalize(() => this.aiLoading.set(false)))
      .subscribe({
        next: (result) => this.aiResult.set(result),
        error: () => this.aiError.set('AI search is unavailable right now. Try a normal filtered search.'),
      });
  }

  nextPage(response: ListingResponse): void {
    if (this.page() * this.pageSize >= response.total) return;
    this.page.update((page) => page + 1);
    this.refresh$.next();
  }

  previousPage(): void {
    if (this.page() === 1) return;
    this.page.update((page) => page - 1);
    this.refresh$.next();
  }

  toggleFavorite(listing: Listing): void {
    this.favorites.toggle(listing);
  }

  trackListing(_index: number, listing: Listing): number {
    return listing.id;
  }

  private buildFilters(): ListingFilters {
    const raw = this.filtersForm.getRawValue();

    return {
      search: raw.search,
      location: raw.location,
      propertyType: raw.propertyType,
      minPrice: toNumber(raw.minPrice),
      maxPrice: toNumber(raw.maxPrice),
      minSurface: toNumber(raw.minSurface),
      maxSurface: toNumber(raw.maxSurface),
      minRooms: toNumber(raw.minRooms),
      sort: raw.sort,
      page: this.page(),
      pageSize: this.pageSize,
    };
  }
}

function toNumber(value: string): number | null {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) ? parsed : null;
}
