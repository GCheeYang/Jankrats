// Pulls every card's USD (EN) price from Bilgewater Market's own bulk
// pricing API (https://api.bilgewatermarket.com/api/cards-with-prices) and
// upserts the result into the `card_prices` Supabase table (see
// supabase/schema.sql).
//
// This used to scrape the /cards browse page's HTML by scrolling it, but
// that page only ever renders its first ~50 printing rows -- it doesn't
// load more on scroll (confirmed: scrolling to the real bottom of the
// document never grows the DOM past 50 anchors). So the old scroll loop's
// "3 stable rounds" exit condition tripped almost immediately every run,
// silently uploading prices for only ~25 of the game's ~1200+ cards while
// still exiting 0 -- the workflow looked healthy for weeks while it wasn't.
//
// The bulk API returns every card/language/print-variation row in one
// response, no pagination needed. It sits behind Firebase App Check
// though, which 401s ("App Check token required") on a plain server-side
// request -- it only works called from inside a real page already loaded
// at bilgewatermarket.com, which is what establishes that trust client-
// side. So we still launch a real (headless) browser, but only to load one
// page and call fetch() from inside its context -- no DOM scraping left.
//
// Usage:
//   node --env-file=.env fetch-prices.js
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

const WARMUP_URL = "https://bilgewatermarket.com/cards";
const API_URL = "https://api.bilgewatermarket.com/api/cards-with-prices";
const UPSERT_BATCH_SIZE = 500;

// Sanity floor so a future site change (another silent breakage like the
// one this replaced) fails the workflow loudly instead of quietly
// uploading a near-empty result. Real count as of writing is ~1266.
const MIN_EXPECTED_CARD_IDS = 500;

async function fetchAllCardRows(page) {
  await page.goto(WARMUP_URL, { waitUntil: "domcontentloaded" });
  const data = await page.evaluate(async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Bilgewater API request failed: HTTP ${res.status}`);
    return res.json();
  }, API_URL);
  return Array.isArray(data && data.cards) ? data.cards : [];
}

// Collapses the API's per-(card_id, language, print_variation) rows down
// to one EN price + one EN foil price per card_id, the shape the app's
// card_prices table (and cardTileHtml's price display) expects. A card_id
// can have several non-foiled English rows (normal, plus assorted promo
// variants) -- "normal" wins for the base price when it exists, since a
// promo print isn't representative of what the card normally sells for.
function reduceToCardPrices(rows) {
  const byId = new Map();
  for (const row of rows) {
    if (row.language !== "english" || !row.card_id || typeof row.price_usd !== "number") continue;
    if (!byId.has(row.card_id)) {
      byId.set(row.card_id, { card_id: row.card_id, en_price_usd: null, en_foil_price_usd: null, _basePriority: -1 });
    }
    const entry = byId.get(row.card_id);
    if (row.print_variation === "foiled") {
      entry.en_foil_price_usd = row.price_usd;
      continue;
    }
    const priority = row.print_variation === "normal" ? 1 : 0;
    if (priority >= entry._basePriority) {
      entry.en_price_usd = row.price_usd;
      entry._basePriority = priority;
    }
  }
  const now = new Date().toISOString();
  return Array.from(byId.values()).map(({ card_id, en_price_usd, en_foil_price_usd }) => ({
    card_id,
    en_price_usd,
    en_foil_price_usd,
    updated_at: now
  }));
}

async function upsertPrices(supabase, priceRows) {
  for (let i = 0; i < priceRows.length; i += UPSERT_BATCH_SIZE) {
    const batch = priceRows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabase.from("card_prices").upsert(batch, { onConflict: "card_id" });
    if (error) throw new Error(`Supabase upsert failed on batch starting at ${i}: ${error.message}`);
    console.log(`Upserted ${Math.min(i + UPSERT_BATCH_SIZE, priceRows.length)} / ${priceRows.length} cards.`);
  }
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const rows = await fetchAllCardRows(page);
    console.log(`Fetched ${rows.length} card/language/print rows from the API.`);

    const priceRows = reduceToCardPrices(rows);
    console.log(`Reduced to ${priceRows.length} unique EN card IDs.`);
    if (priceRows.length < MIN_EXPECTED_CARD_IDS) {
      throw new Error(
        `Only found ${priceRows.length} EN card IDs, expected at least ${MIN_EXPECTED_CARD_IDS} -- ` +
        "Bilgewater likely changed their site/API. Refusing to upsert a partial result."
      );
    }

    await upsertPrices(supabase, priceRows);
    console.log("Done.");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
