# Price scraper

Pulls every card's price off Bilgewater Market's `/cards` browse listing
(rendered in a real headless browser, scrolled like a person would) and
upserts it into the `card_prices` Supabase table. Runs daily via
[`.github/workflows/update-card-prices.yml`](../../.github/workflows/update-card-prices.yml).

## Run it locally (e.g. for the first backfill)

1. `cd scripts/price-scraper && npm install`
2. `npx playwright install --with-deps chromium` (one-time browser download)
3. Copy `.env.example` to `.env` and fill in your Supabase project's URL and
   **service_role** key (Project Settings → API in the Supabase dashboard —
   not the anon key, and never commit this file).
4. `node --env-file=.env fetch-prices.js`

It logs a running count as it scrolls and upserts, and exits non-zero on
failure (missing env vars, a Supabase error, etc).

## Scheduled runs

The GitHub Actions workflow passes `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` in from repo secrets (Settings → Secrets and
variables → Actions) instead of a `.env` file — set those once and the
daily run just works.
