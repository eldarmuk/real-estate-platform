import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { AiRecommendationResponse, Listing, ListingFilters, ListingResponse, ListingStats } from './models';

@Injectable({ providedIn: 'root' })
export class ListingApiService {
  constructor(private readonly http: HttpClient) {}

  getListings(filters: ListingFilters): Observable<ListingResponse> {
    let params = new HttpParams();

    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }

    return this.http.get<ListingResponse>('/api/listings', { params });
  }

  getListing(id: number): Observable<Listing> {
    return this.http.get<Listing>(`/api/listings/${id}`);
  }

  getStats(): Observable<ListingStats> {
    return this.http.get<ListingStats>('/api/listings/stats/summary');
  }

  recommend(prompt: string): Observable<AiRecommendationResponse> {
    return this.http.post<AiRecommendationResponse>('/api/ai/recommend', { prompt });
  }
}
