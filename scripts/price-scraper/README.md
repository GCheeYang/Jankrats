# Price updater

Pulls Riftbound card prices from [tcgcsv.com](https://tcgcsv.com) -- a free,
public daily mirror of TCGplayer's catalog and prices (Bilgewater Market's
prices come from TCGplayer too) -- and upserts them into the `card_prices`
Supabase table. Runs daily via
[`.github/workflows/update-card-prices.yml`](../../.github/workflows/update-card-prices.yml).

- **Matching:** a TCGplayer product's "Number" (`066a/298`, `304*/298`) is
  exactly the suffix of our card ids, so id = `<set abbreviation>-<Number>`
  (e.g. `OGN-066a/298`). Only ids that exist in `cards_data.js` are written.
- **Prices:** TCGplayer Market Price, Normal and Foil. Foil-only cards
  (signature, overnumbered, ...) store their foil price as the main price.
- **Not covered (~9%):** tokens, `-P` promo printings and a few rune
  variants aren't listed on TCGplayer under matching ids; they keep the
  "Price" placeholder link in the app. The run logs a sample.
- **Schedule:** tcgcsv rebuilds once a day at ~20:05 UTC and asks for at most
  one pull per 24h, a custom User-Agent, and a 100ms pause between requests
  -- the script and the 21:00 UTC cron follow all three.
- **Safety:** refuses to write if it matches fewer than half of our cards
  (the source format or our id scheme changed).

## Try it without touching the database

```
cd scripts/price-scraper
node fetch-prices.js --dry-run
```

Needs no install and no keys; prints per-set counts and how many of our
cards got a price.

## Run it for real locally

1. `cd scripts/price-scraper && npm install`
2. Copy `.env.example` to `.env` and fill in your Supabase project's URL and
   **service_role** key (Project Settings → API -- not the anon key, and
   never commit this file).
3. `node --env-file=.env fetch-prices.js`

## Scheduled runs

The GitHub Actions workflow passes `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` in from repo secrets (Settings → Secrets and
variables → Actions). It can also be run on demand from the Actions tab
("Run workflow").
