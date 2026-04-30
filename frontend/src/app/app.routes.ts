import { Routes } from '@angular/router';
import { FavoritesComponent } from './favorites/favorites.component';
import { ListingDetailComponent } from './listing-detail/listing-detail.component';
import { ListingListComponent } from './listing-list/listing-list.component';

export const routes: Routes = [
  { path: '', component: ListingListComponent },
  { path: 'favorites', component: FavoritesComponent },
  { path: 'listings/:id', component: ListingDetailComponent },
  { path: '**', redirectTo: '' },
];
