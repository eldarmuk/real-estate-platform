import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { buildApiUrl } from './api-url';
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

    return this.http.get<ListingResponse>(this.apiUrl('listings'), { params });
  }

  getListing(id: number): Observable<Listing> {
    return this.http.get<Listing>(this.apiUrl(`listings/${id}`));
  }

  getStats(): Observable<ListingStats> {
    return this.http.get<ListingStats>(this.apiUrl('listings/stats/summary'));
  }

  recommend(prompt: string): Observable<AiRecommendationResponse> {
    return this.http.post<AiRecommendationResponse>(this.apiUrl('ai/recommend'), { prompt });
  }

  private apiUrl(path: string): string {
    return buildApiUrl(path);
  }
}
