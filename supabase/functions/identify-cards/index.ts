// Jankrats — identify-cards Edge Function.
//
// Takes still frames (extracted client-side from an uploaded pack-opening
// photo or video) and asks Claude to read off which Riftbound cards are
// visible. Returns loose {name, qty, collectorNumber} guesses — matching
// those against the real card database happens client-side, reusing the
// same fuzzy matcher the voice-import flow already uses (bestCardMatch in
// app.js), so this function never needs to know the card list itself.
//
// Deploy with: supabase functions deploy identify-cards
// Needs the ANTHROPIC_API_KEY secret set first (get a key at
// console.anthropic.com — this is separate from a claude.ai subscription):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import Anthropic from "npm:@anthropic-ai/sdk@latest";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-opus-5";
const MAX_FRAMES = 20;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are looking at still frames from a video (or a single photo) of someone opening a pack of the Riftbound Trading Card Game, or showing off cards they own.

Identify every distinct physical card visible across the frames. The same card often appears in several consecutive frames (a panning shot) — count it once per physical copy shown, not once per frame it happens to appear in.

Cards are frequently held fanned out in one hand rather than laid flat: several copies of the same card stacked directly behind each other, with only a sliver of each one's edge or corner (its cost pip, color, border) visible behind the frontmost copy. That sliver is still a separate physical card, not a duplicate frame of the front one — look for it and count it. Don't require copies to be fully laid out side by side to count them; a fanned hand showing 3 same-colored edges stacked behind one fully-visible card of that name means qty 3, not qty 1.

For each distinct card, report:
- "name": the card's title text, exactly as printed
- "qty": how many separate physical copies you're confident are shown, including any partially-hidden behind others in a fanned stack
- "collectorNumber": the small set code + number printed on the card (e.g. "OGN-066/298"), if it's legible — omit this field entirely if you can't read it

Respond with ONLY a JSON array, no prose, no markdown code fences. If you can't identify any cards, respond with []. Example:
[{"name":"Bargain-Bin Baron, Sir Reginald Duct-Taped","qty":1,"collectorNumber":"OGN-066/298"},{"name":"Anchor Dump","qty":3}]`;

function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (_e) {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Model didn't return parseable JSON: " + text.slice(0, 200));
  }
}

// The browser calls this function directly (not server-to-server like
// send-push), so it needs to answer the CORS preflight and echo these
// headers on every response, or the browser blocks the request before it
// ever reaches the code below — that shows up client-side as "failed to
// send a request to the Edge Function", not as any error from this file.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "POST only" }, 405);

  try {
    const body = await req.json();
    const frames: string[] = Array.isArray(body.frames) ? body.frames.slice(0, MAX_FRAMES) : [];
    if (!frames.length) return jsonResponse({ ok: false, error: "No frames provided" }, 400);

    const imageBlocks = frames.map((dataUrl) => {
      const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
      if (!match) throw new Error("Frame isn't a base64 image data URL");
      return {
        type: "image",
        source: { type: "base64", media_type: match[1], data: match[2] },
      };
    });

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            ...imageBlocks,
            { type: "text", text: `Here are ${frames.length} frame(s) to look at. Identify the cards.` },
          ],
        },
      ],
    } as any);

    let raw = "[]";
    for (const block of response.content as any[]) {
      if (block.type === "text") { raw = block.text; break; }
    }

    const cards = extractJson(raw);
    return jsonResponse({ ok: true, cards });
  } catch (err) {
    console.error(err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
