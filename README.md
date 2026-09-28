# Real estate platform

A prototype for browsing Polish property listings, saving favorites and searching with filters or a short natural-language request.

Angular · TypeScript · Express · Prisma

AI requests become structured filters over existing listings, with a keyword fallback. The nine offline search tests passed on 28 September 2026; the full deployed flow was not retested.

<details>
<summary>Setup and technical notes</summary>

# Real estate platform

A TypeScript project for exploring Polish property listings through filters and natural-language requests. It brings together an Angular interface, an Express API, a MySQL/MariaDB database through Prisma, and listing import tools.

## What you can explore

- Browse listings, filter by location, price, area, room count and property type, and open a detail page.
- Keep favorites in the browser’s local storage. They are not synchronized to a user account.
- Describe a property in a short prompt. The backend asks a configured AI provider for structured filters, validates the fields, and searches the stored listings.
- If the AI provider is unavailable, the recommendation endpoint falls back to a deterministic keyword plan. If matches are sparse, it progressively relaxes some filters.

For example, a request such as “a flat in Krakow under 700000 PLN” is translated into filters over existing listings. It does not generate new properties, and the returned matches depend on the database contents.

## Architecture

```text
Angular UI → Express API → Prisma / MariaDB adapter → listing database
                  ↓
          optional AI search-plan provider

Saved HTML or listing pages → scraper / parser → database
```

The backend uses Groq first when configured, then Gemini, before the deterministic fallback. The scraper has a separate, optional local-model enrichment path. These are different flows.

Useful entry points:

- [`src/index.ts`](src/index.ts): API routes and recommendation flow.
- [`src/listing-search.ts`](src/listing-search.ts): reusable filtering and sorting helpers.
- [`src/scraper.ts`](src/scraper.ts): import, parsing and enrichment.
- [`prisma/schema.prisma`](prisma/schema.prisma): listing schema.
- [`frontend/src/app`](frontend/src/app): list/detail views and favorites.
- [`tests/run-tests.ts`](tests/run-tests.ts): focused offline search and URL-routing checks.

## Local setup

Use a recent Node.js version supported by the checked-in Angular and Prisma dependencies (Node 24 was used for the offline tests below), npm, and a local MySQL/MariaDB database.

```sh
npm ci
npm --prefix frontend ci
```

Create a local `.env` in the repository root. Use credentials for your own disposable development database:

```dotenv
DATABASE_URL=mysql://USER:PASSWORD@localhost:3306/real_estate_dev
PORT=3000
```

`GROQ_API_KEY` and/or `GEMINI_API_KEY` are optional for AI search planning. Without them, the recommendation route uses its deterministic fallback. Do not commit credentials.

```sh
npx prisma generate
npx prisma db push
npm run dev
```

`prisma db push` changes the database schema; use the development database configured above. In a second terminal:

```sh
npm run dev:frontend
```

Open `http://localhost:4200`. The frontend proxy forwards `/api` to port 3000. `GET http://localhost:3000/api/health` returns a basic API health message. An empty database produces an empty listing view; the repository does not include a ready-to-use seed dataset.

## Importing listings

`npm run scrape` builds and runs the importer. It can fetch Adresowo pages or read saved HTML using `ADRESOWO_HTML_DIR`. For a local import, point that variable to HTML you are permitted to use and set `LOCAL_LLM_ENRICH=false` if you do not have a local model configured.

Network scraping is not needed for the offline tests. The `SCRAPE_CLEAN` option / `--clean` flag modifies existing listings and should not be enabled casually against an existing database. Inspect the scraper settings before running it.

## Checks

```sh
npm test
```

This compiles and runs the existing tests for search, filtering, sorting and API URL construction. These focused tests do not require a database, API keys or network scraping. They do not establish end-to-end correctness of the server, external AI calls or the deployed UI.

Verified on 28 September 2026 with Node 24.19.0: all 9 existing offline tests passed. No scraping, database migration or paid AI requests were run for this documentation update.

For builds, `npm run build` generates Prisma’s client and compiles the backend; `npm run build:frontend` builds the Angular app. `npm start` also runs `prisma db push` through its prestart hook, so inspect the target database before using it.

## Current boundaries

- Filtering currently loads database listings into application memory. It is a prototype approach, not a demonstrated large-scale search architecture.
- The server and shared search module contain overlapping logic; the offline tests primarily exercise the shared module.
- The frontend contains an explicit hosted API URL in `api-url.ts`. Update that and the deployment configuration when hosting your own copy.
- A generated search plan can misinterpret a request, and relaxed filters may return approximate matches. Check the returned filters and listing details.

[My portfolio](https://eldarmukhtar.ovh/)

</details>
