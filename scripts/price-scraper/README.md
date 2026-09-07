# Price scraper

Pulls every card's price from Bilgewater Market's own bulk pricing API
(`api.bilgewatermarket.com/api/cards-with-prices`) and upserts it into the
`card_prices` Supabase table. Runs daily via
[`.github/workflows/update-card-prices.yml`](../../.github/workflows/update-card-prices.yml).

That API sits behind Firebase App Check and 401s on a plain server-side
request, so this still launches a real (headless) browser -- just to load
one page at bilgewatermarket.com and call the API from inside its context,
which is enough to pass App Check. No DOM scraping or scrolling involved
anymore (an earlier version scraped the `/cards` browse listing's HTML,
which turned out to only ever render its first ~50 rows and never load
more on scroll -- it silently under-priced ~98% of cards for weeks while
still exiting 0).

## Run it locally (e.g. for the first backfill)

1. `cd scripts/price-scraper && npm install`
2. `npx playwright install --with-deps chromium` (one-time browser download)
3. Copy `.env.example` to `.env` and fill in your Supabase project's URL and
   **service_role** key (Project Settings → API in the Supabase dashboard —
   not the anon key, and never commit this file).
4. `node --env-file=.env fetch-prices.js`

It logs the row/card counts it found and upserts, and exits non-zero on
failure (missing env vars, a Supabase error, the API returning suspiciously
few cards, etc).

## Scheduled runs

The GitHub Actions workflow passes `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` in from repo secrets (Settings → Secrets and
variables → Actions) instead of a `.env` file — set those once and the
daily run just works.
