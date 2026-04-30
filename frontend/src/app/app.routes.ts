import { Routes } from '@angular/router';
import { ListingDetailComponent } from './listing-detail/listing-detail.component';
import { ListingListComponent } from './listing-list/listing-list.component';

export const routes: Routes = [
  { path: '', component: ListingListComponent },
  { path: 'listings/:id', component: ListingDetailComponent },
  { path: '**', redirectTo: '' },
];
