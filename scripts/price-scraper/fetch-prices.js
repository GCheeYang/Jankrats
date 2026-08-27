// Pulls every card's USD (EN) price off Bilgewater Market's own browse
// listing (https://bilgewatermarket.com/cards) by rendering it in a real
// headless browser and scrolling through it, the same way a person would --
// rather than calling any internal endpoint directly. Upserts the result
// into the `card_prices` Supabase table (see supabase/schema.sql).
//
// Usage:
//   node --env-file=.env fetch-prices.js
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

const BROWSE_URL = "https://bilgewatermarket.com/cards";
const SCROLL_PAUSE_MS = 800;
const MAX_SCROLLS = 400;
const STABLE_ROUNDS_TO_STOP = 3;
const UPSERT_BATCH_SIZE = 500;

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

async function scrapeAll(page) {
  await page.goto(BROWSE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000); // first batch renders client-side after load

  let stableRounds = 0;
  let lastCount = -1;
  for (let i = 0; i < MAX_SCROLLS; i++) {
    const count = await page.evaluate(() => document.querySelectorAll('a[href^="/cards/"]').length);
    if (count === lastCount) {
      stableRounds++;
      if (stableRounds >= STABLE_ROUNDS_TO_STOP) break;
    } else {
      stableRounds = 0;
    }
    lastCount = count;

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(SCROLL_PAUSE_MS);
  }

  const rows = await collectRows(page);
  console.log(`Collected ${rows.length} printing rows after scrolling.`);
  return rows;
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
    const rows = await scrapeAll(page);
    const priceRows = reduceToCardPrices(rows);
    console.log(`Reduced to ${priceRows.length} unique card IDs.`);
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
