import { AsyncPipe, CurrencyPipe, DatePipe, DecimalPipe, KeyValuePipe, NgFor, NgIf } from '@angular/common';
import { Component, Input, OnChanges } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FavoritesService } from '../favorites.service';
import { Observable } from 'rxjs';
import { ListingApiService } from '../listing-api.service';
import { Listing } from '../models';

@Component({
  selector: 'app-listing-detail',
  imports: [AsyncPipe, CurrencyPipe, DatePipe, DecimalPipe, KeyValuePipe, NgFor, NgIf, RouterLink],
  templateUrl: './listing-detail.component.html',
  styleUrl: './listing-detail.component.css',
})
export class ListingDetailComponent implements OnChanges {
  @Input() id?: string;
  listing$?: Observable<Listing>;

  constructor(
    private readonly api: ListingApiService,
    readonly favorites: FavoritesService,
  ) {}

  ngOnChanges(): void {
    const listingId = Number(this.id);
    if (Number.isFinite(listingId)) {
      this.listing$ = this.api.getListing(listingId);
    }
  }

  toggleFavorite(listing: Listing): void {
    this.favorites.toggle(listing);
  }
}
