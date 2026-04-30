import { AsyncPipe, CurrencyPipe, DecimalPipe, NgFor, NgIf } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BehaviorSubject, combineLatest, finalize, Observable, startWith, switchMap, tap } from 'rxjs';
import { ListingApiService } from '../listing-api.service';
import { Listing, ListingFilters, ListingResponse, ListingStats } from '../models';

@Component({
  selector: 'app-listing-list',
  imports: [AsyncPipe, CurrencyPipe, DecimalPipe, NgFor, NgIf, ReactiveFormsModule, RouterLink],
  templateUrl: './listing-list.component.html',
  styleUrl: './listing-list.component.css',
})
export class ListingListComponent implements OnInit {
  private readonly api = inject(ListingApiService);
  private readonly fb = inject(FormBuilder);

  readonly pageSize = 12;
  readonly loading = signal(false);
  readonly page = signal(1);
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

  readonly listings$ = combineLatest([this.refresh$, this.filtersForm.valueChanges.pipe(startWith(this.filtersForm.getRawValue()))]).pipe(
    tap(() => this.loading.set(true)),
    switchMap(() => this.api.getListings(this.buildFilters()).pipe(finalize(() => this.loading.set(false)))),
  );

  ngOnInit(): void {
    this.filtersForm.updateValueAndValidity({ emitEvent: true });
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
