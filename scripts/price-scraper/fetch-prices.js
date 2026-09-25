// Pulls Riftbound card prices from tcgcsv.com -- a free, public, no-login
// daily mirror of TCGplayer's catalog and prices (Bilgewater Market's own
// prices come from TCGplayer too) -- and upserts them into the
// `card_prices` Supabase table (see supabase/schema.sql).
//
// This replaced a Playwright scraper of Bilgewater's browse page, which
// could only ever see the ~30 cards in its unfiltered default view (the
// rest sits behind Firebase App Check + reCAPTCHA), leaving most prices
// frozen at whatever a long-ago bulk fetch had stored.
//
// Matching: a TCGplayer product's "Number" (e.g. "066a/298", "304*/298")
// is exactly the suffix of our card ids, so id = `${group abbreviation}-${Number}`
// (e.g. "OGN-066a/298"). Only ids that exist in cards_data.js are upserted.
//
// Prices: TCGplayer Market Price, split by subTypeName into Normal / Foil.
// Cards that only exist as foil (signature, overnumbered, ...) have no
// Normal row; their foil price is stored as the main price so they don't
// show "no price".
//
// Usage:
//   node --env-file=.env fetch-prices.js
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const TCGCSV = "https://tcgcsv.com/tcgplayer";
const RIFTBOUND_CATEGORY_ID = 89;
const UPSERT_BATCH_SIZE = 500;

// Refuse to write if we matched suspiciously few of our own cards -- that
// means the source format changed, not that prices are genuinely missing.
const MIN_MATCHED_FRACTION = 0.5;

// tcgcsv blocks generic User-Agents and asks for a 100ms pause between
// requests and no more than one full pull per 24h (see tcgcsv.com/docs).
const USER_AGENT = "Jankrats-Price-Updater/1.0.0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  await sleep(100);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const body = await res.json();
  if (body.success === false) throw new Error(`${url} -> ${JSON.stringify(body.errors)}`);
  return body.results || [];
}

function loadOurCardIds() {
  const file = path.join(__dirname, "..", "..", "cards_data.js");
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox);
  const cards = sandbox.window.__RIFTBOUND_CARDS__;
  if (!Array.isArray(cards) || !cards.length) throw new Error("Couldn't read cards_data.js");
  return new Set(cards.map((c) => c.id));
}

function numberOf(product) {
  const e = (product.extendedData || []).find((x) => x.name === "Number");
  return e ? String(e.value).trim() : null;
}

async function collectPrices(ourIds) {
  const byId = new Map();
  const groups = await getJson(`${TCGCSV}/${RIFTBOUND_CATEGORY_ID}/groups`);
  for (const g of groups) {
    const abbr = g.abbreviation;
    if (!abbr) continue;
    const products = await getJson(`${TCGCSV}/${RIFTBOUND_CATEGORY_ID}/${g.groupId}/products`);
    const prices = await getJson(`${TCGCSV}/${RIFTBOUND_CATEGORY_ID}/${g.groupId}/prices`);
    const idByProduct = new Map();
    for (const p of products) {
      const n = numberOf(p);
      if (n) idByProduct.set(p.productId, `${abbr}-${n}`);
    }
    for (const pr of prices) {
      const id = idByProduct.get(pr.productId);
      if (!id || !ourIds.has(id)) continue;
      const price = pr.marketPrice ?? pr.midPrice;
      if (price === null || price === undefined) continue;
      if (!byId.has(id)) byId.set(id, { normal: null, foil: null });
      const entry = byId.get(id);
      if (pr.subTypeName === "Foil") entry.foil = price;
      else entry.normal = price;
    }
    console.log(`${abbr} (${g.name}): ${products.length} products, ${prices.length} price rows`);
  }
  return byId;
}

function toRows(byId) {
  const now = new Date().toISOString();
  return Array.from(byId, ([card_id, v]) => ({
    card_id,
    en_price_usd: v.normal ?? v.foil,
    en_foil_price_usd: v.normal !== null ? v.foil : null,
    updated_at: now
  }));
}

async function upsertPrices(supabase, rows) {
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabase.from("card_prices").upsert(batch, { onConflict: "card_id" });
    if (error) throw new Error(`Supabase upsert failed on batch starting at ${i}: ${error.message}`);
    console.log(`Upserted ${Math.min(i + UPSERT_BATCH_SIZE, rows.length)} / ${rows.length} cards.`);
  }
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dryRun = process.argv.includes("--dry-run");
  if (!dryRun && (!supabaseUrl || !serviceRoleKey)) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.");
    process.exit(1);
  }

  const ourIds = loadOurCardIds();
  const byId = await collectPrices(ourIds);
  const rows = toRows(byId);
  const unmatched = [...ourIds].filter((id) => !byId.has(id));
  console.log(`Matched prices for ${rows.length} of ${ourIds.size} cards; ${unmatched.length} have no TCGplayer price.`);
  if (unmatched.length) console.log(`Sample without a price: ${unmatched.slice(0, 15).join(", ")}`);

  if (rows.length < ourIds.size * MIN_MATCHED_FRACTION) {
    throw new Error(
      `Only matched ${rows.length} of ${ourIds.size} cards (need at least ${Math.round(ourIds.size * MIN_MATCHED_FRACTION)}) -- ` +
      "tcgcsv's format or our id scheme likely changed. Refusing to upsert a partial result."
    );
  }
  if (dryRun) { console.log("Dry run: not writing to Supabase."); return; }

  const { createClient } = require("@supabase/supabase-js"); // lazy so --dry-run needs no npm install
  await upsertPrices(createClient(supabaseUrl, serviceRoleKey), rows);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
