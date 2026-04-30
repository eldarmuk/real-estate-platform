import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { AiRecommendationResponse, Listing, ListingFilters, ListingResponse, ListingStats } from './models';

const railwayApiBase = 'https://real-estate-platform-production-17ac.up.railway.app/api';

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
    const normalizedPath = path.replace(/^\/+/, '');

    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return `/api/${normalizedPath}`;
    }

    return `${railwayApiBase}/${normalizedPath}`;
  }
}
