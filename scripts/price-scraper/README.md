# Price scraper

Pulls EN (USD) prices off Bilgewater Market's `/cards` browse page and
upserts them into the `card_prices` Supabase table. Runs daily via
[`.github/workflows/update-card-prices.yml`](../../.github/workflows/update-card-prices.yml).

**Known limitation, not a bug:** this only ever captures the ~25 cards
shown in Bilgewater's default (unfiltered) view. Everything past that --
search, domain/rarity/set filters, a card's own detail page, and their
bulk `api.bilgewatermarket.com/api/cards-with-prices` endpoint -- requires
a live API call gated behind Firebase App Check + reCAPTCHA v3, and a
headless automated browser reliably fails that check (confirmed directly:
Google's own reCAPTCHA token exchange comes back 403 before Bilgewater's
API is even reached, from a cold Playwright browser regardless of IP or
wait time). That's Bilgewater's deliberate anti-scraping boundary, not
something this script should try to work around. So `card_prices` only
ever has real numbers for a couple dozen cards; every other card falls
back to the "Price" placeholder link in the app. Getting full coverage
would need either a different data source or an occasional manual export
from a real signed-in browser session -- not a scheduled CI job.

## Run it locally (e.g. for the first backfill)

1. `cd scripts/price-scraper && npm install`
2. `npx playwright install --with-deps chromium` (one-time browser download)
3. Copy `.env.example` to `.env` and fill in your Supabase project's URL and
   **service_role** key (Project Settings → API in the Supabase dashboard —
   not the anon key, and never commit this file).
4. `node --env-file=.env fetch-prices.js`

It logs the row/card counts it found and upserts, and exits non-zero on
failure (missing env vars, a Supabase error, finding suspiciously few
cards -- which would mean the page markup changed, not the App Check
limitation above -- etc).

## Scheduled runs

The GitHub Actions workflow passes `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` in from repo secrets (Settings → Secrets and
variables → Actions) instead of a `.env` file — set those once and the
daily run just works.
