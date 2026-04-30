import { AsyncPipe, CurrencyPipe, DecimalPipe, NgIf } from '@angular/common';
import { Component, Input, OnChanges } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { ListingApiService } from '../listing-api.service';
import { Listing } from '../models';

@Component({
  selector: 'app-listing-detail',
  imports: [AsyncPipe, CurrencyPipe, DecimalPipe, NgIf, RouterLink],
  templateUrl: './listing-detail.component.html',
  styleUrl: './listing-detail.component.css',
})
export class ListingDetailComponent implements OnChanges {
  @Input() id?: string;
  listing$?: Observable<Listing>;

  constructor(private readonly api: ListingApiService) {}

  ngOnChanges(): void {
    const listingId = Number(this.id);
    if (Number.isFinite(listingId)) {
      this.listing$ = this.api.getListing(listingId);
    }
  }
}
