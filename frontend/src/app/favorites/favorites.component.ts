import { CurrencyPipe, NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FavoritesService } from '../favorites.service';
import { Listing } from '../models';

@Component({
  selector: 'app-favorites',
  imports: [CurrencyPipe, NgFor, NgIf, RouterLink],
  templateUrl: './favorites.component.html',
  styleUrl: './favorites.component.css',
})
export class FavoritesComponent {
  readonly favoritesService = inject(FavoritesService);

  remove(listing: Listing): void {
    this.favoritesService.toggle(listing);
  }
}
