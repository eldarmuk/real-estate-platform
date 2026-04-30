import assert from 'node:assert/strict';
import { buildApiUrl, railwayApiBase } from '../frontend/src/app/api-url.js';
import {
  type ListingQuery,
  type ListingSearchItem,
  matchesListingQuery,
  matchesLocation,
  matchesSearch,
  parseOptionalNumber,
  queryFromAiPlan,
  sortListings,
} from '../src/listing-search.js';

type TestCase = {
  name: string;
  run: () => void;
};

const baseListing: ListingSearchItem = {
  title: 'Mieszkanie na sprzedaż ul. Kobierzyńska Kraków',
  url: 'https://adresowo.pl/o/example',
  source: 'adresowo.pl',
  propertyType: 'Mieszkanie',
  transactionType: 'sprzedaz',
  location: 'Kraków',
  price: 650_000,
  pricePerSqm: 13_000,
  sizeSqm: 50,
  plotSizeSqm: null,
  constructionYear: 2021,
  rooms: 2,
  houseType: null,
  rawDescription: 'Bright flat near transit with balcony.',
  rawAttributes: {},
  scrapedAt: new Date('2026-04-30T10:00:00Z'),
};

const emptyQuery: ListingQuery = {
  search: '',
  minPrice: null,
  maxPrice: null,
  minSurface: null,
  maxSurface: null,
  minRooms: null,
  maxRooms: null,
  propertyType: null,
  location: null,
  sort: 'newest',
};

const tests: TestCase[] = [
  {
    name: 'parses optional numbers from Polish-style form input',
    run: () => {
      assert.equal(parseOptionalNumber('650 000'), 650000);
      assert.equal(parseOptionalNumber('42,5'), 42.5);
      assert.equal(parseOptionalNumber(''), null);
      assert.equal(parseOptionalNumber('not a number'), null);
    },
  },
  {
    name: 'matches locations with and without Polish diacritics',
    run: () => {
      assert.equal(matchesLocation('Kraków', 'Krakow'), true);
      assert.equal(matchesLocation('Łódź Bałuty', 'Lodz'), true);
      assert.equal(matchesLocation('Warszawa', 'Krakow'), false);
    },
  },
  {
    name: 'matches search terms across title, location, description, and raw attributes',
    run: () => {
      assert.equal(matchesSearch(baseListing, 'krakow balcony'), true);
      assert.equal(matchesSearch(baseListing, 'kobierzynska transit'), true);
      assert.equal(matchesSearch({ ...baseListing, rawAttributes: { ekspozycja: 'południowa' } }, 'poludniowa'), true);
      assert.equal(matchesSearch(baseListing, 'garden'), false);
    },
  },
  {
    name: 'applies structured filters independently',
    run: () => {
      assert.equal(matchesListingQuery(baseListing, { ...emptyQuery, location: 'Krakow', maxPrice: 700_000, minSurface: 40 }), true);
      assert.equal(matchesListingQuery(baseListing, { ...emptyQuery, maxPrice: 500_000 }), false);
      assert.equal(matchesListingQuery(baseListing, { ...emptyQuery, propertyType: 'Dom' }), false);
    },
  },
  {
    name: 'falls back to raw attributes when normalized numbers are missing',
    run: () => {
      const listing = {
        ...baseListing,
        price: null,
        sizeSqm: null,
        rooms: null,
        rawAttributes: { price: '650000', powierzchnia: '50', pokoje: '2' },
      };

      assert.equal(matchesListingQuery(listing, { ...emptyQuery, maxPrice: 700_000, minSurface: 45, minRooms: 2 }), true);
    },
  },
  {
    name: 'sorts null numeric values last',
    run: () => {
      const cheap = { ...baseListing, id: 1, price: 500_000 };
      const expensive = { ...baseListing, id: 2, price: 900_000 };
      const unknown = { ...baseListing, id: 3, price: null };

      assert.deepEqual(
        sortListings([unknown, expensive, cheap], 'price-asc').map((item) => item.id),
        [1, 2, 3],
      );
    },
  },
  {
    name: 'converts AI plans to the same query shape used by classic search',
    run: () => {
      assert.deepEqual(queryFromAiPlan({ location: 'Krakow', maxPrice: 700_000, sort: 'price-asc' }), {
        search: '',
        location: 'Krakow',
        propertyType: null,
        minPrice: null,
        maxPrice: 700_000,
        minSurface: null,
        maxSurface: null,
        minRooms: null,
        maxRooms: null,
        sort: 'price-asc',
      });
    },
  },
  {
    name: 'uses the local proxy during Angular development',
    run: () => {
      assert.equal(buildApiUrl('listings', 'localhost'), '/api/listings');
      assert.equal(buildApiUrl('/ai/recommend', '127.0.0.1'), '/api/ai/recommend');
    },
  },
  {
    name: 'uses Railway directly when deployed on the custom domain',
    run: () => {
      assert.equal(buildApiUrl('listings', 'eldarmukhtar.ovh'), `${railwayApiBase}/listings`);
      assert.equal(buildApiUrl('/listings/42', 'www.eldarmukhtar.ovh'), `${railwayApiBase}/listings/42`);
    },
  },
];

let failed = 0;

for (const test of tests) {
  try {
    test.run();
    console.log(`PASS ${test.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${test.name}`);
    console.error(error);
  }
}

if (failed > 0) {
  console.error(`${failed} test${failed === 1 ? '' : 's'} failed.`);
  process.exitCode = 1;
} else {
  console.log(`${tests.length} tests passed.`);
}
