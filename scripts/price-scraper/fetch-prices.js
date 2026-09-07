// Pulls EN (USD) card prices off Bilgewater Market's `/cards` browse page
// and upserts them into the `card_prices` Supabase table (see
// supabase/schema.sql).
//
// IMPORTANT CAVEAT, found the hard way: this only ever captures the
// default ~50-row / ~25-unique-card view Bilgewater shows before any
// search or filter is applied. That is NOT a bug in this script to fix --
// it's Bilgewater's actual data-access boundary:
//
//   - Anything beyond that default view (search, domain/rarity/set
//     filters, a specific card's own detail page, and their bulk
//     `/api/cards-with-prices` endpoint) requires a live call to
//     api.bilgewatermarket.com, which sits behind Firebase App Check +
//     reCAPTCHA v3.
//   - A headless, freshly-launched Playwright browser reliably fails that
//     reCAPTCHA v3 check (Google's own token-exchange call comes back 403
//     before Bilgewater's API is even reached), so every one of those
//     requests 401s -- confirmed directly: card-detail pages, the search
//     box, and the bulk endpoint all fail the same way from a cold
//     automated browser, regardless of IP or how long you wait after
//     page load.
//   - The unfiltered default view is the one exception -- it doesn't
//     trigger any of those gated calls, which is exactly why the
//     original version of this script (scrolling that page hoping for
//     more) "worked" for weeks while silently only ever covering ~25
//     cards: scrolling further never loaded more, because there was
//     nothing further to load without a gated request.
//
// Given that, deliberately working around App Check/reCAPTCHA to reach
// the rest of their catalog isn't something to build here -- it's
// Bilgewater's explicit anti-scraping boundary, not an accident. So this
// stays scoped to whatever's legitimately public: the default view, read
// once (no more scroll-and-hope loop, since scrolling provably does
// nothing here).
//
// Practical effect: `card_prices` only ever has real numbers for ~25
// cards; every other card falls back to the "Price" placeholder link in
// the app. Getting full coverage would need a different data source, or
// accepting a manual/occasional refresh from a real signed-in browser
// session instead of a scheduled CI job.
//
// Usage:
//   node --env-file=.env fetch-prices.js
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

const BROWSE_URL = "https://bilgewatermarket.com/cards";
const UPSERT_BATCH_SIZE = 500;

// Sanity floor -- catches a total-failure case (0 cards found because the
// page's markup changed) without pretending full-catalog coverage is the
// bar; see the caveat above for why that bar isn't reachable here.
const MIN_EXPECTED_CARD_IDS = 15;

function parseMoney(text) {
  if (!text) return null;
  const cleaned = text.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

async function collectRows(page) {
  return page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href^="/cards/"]'));
    return anchors
      .map((a) => {
        const href = a.getAttribute("href") || "";
        const heading = a.querySelector("h3");
        const badgeWrap = heading ? heading.nextElementSibling : null;
        const badges = badgeWrap
          ? Array.from(badgeWrap.children).map((d) => d.textContent.trim())
          : [];
        const id = badges[0] || null;
        const isFoil = /print_variation=foiled/.test(href) || badges.slice(1).some((b) => /foil/i.test(b));

        let en = null;
        const priceRows = a.querySelectorAll(".p-3 .flex.items-center.justify-between");
        priceRows.forEach((row) => {
          const spans = row.querySelectorAll("span");
          if (spans.length < 2) return;
          const label = spans[0].textContent.trim();
          const value = spans[1].textContent.trim();
          if (label === "EN") en = value;
        });

        return { id, isFoil, en };
      })
      .filter((r) => r.id);
  });
}

function reduceToCardPrices(rows) {
  const byId = new Map();
  for (const row of rows) {
    if (!byId.has(row.id)) {
      byId.set(row.id, {
        card_id: row.id,
        en_price_usd: null,
        en_foil_price_usd: null
      });
    }
    const entry = byId.get(row.id);
    const en = parseMoney(row.en);
    if (row.isFoil) {
      if (en !== null) entry.en_foil_price_usd = en;
    } else {
      if (en !== null) entry.en_price_usd = en;
    }
  }
  const now = new Date().toISOString();
  return Array.from(byId.values()).map((entry) => ({ ...entry, updated_at: now }));
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
    await page.goto(BROWSE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000); // first batch renders client-side after load

    const rows = await collectRows(page);
    console.log(`Collected ${rows.length} printing rows from the default (unfiltered) view.`);

    const priceRows = reduceToCardPrices(rows);
    console.log(`Reduced to ${priceRows.length} unique card IDs.`);
    if (priceRows.length < MIN_EXPECTED_CARD_IDS) {
      throw new Error(
        `Only found ${priceRows.length} card IDs, expected at least ${MIN_EXPECTED_CARD_IDS} -- ` +
        "Bilgewater likely changed their page markup. Refusing to upsert a partial result."
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
