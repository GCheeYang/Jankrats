// Jankrats — identify-cards Edge Function.
//
// Takes still frames (extracted client-side from an uploaded pack-opening
// photo or video, or a live camera recording) and asks Claude to read off
// which Riftbound cards are visible. Returns loose {name, qty,
// collectorNumber} guesses — matching those against the real card database
// happens client-side, reusing the same fuzzy matcher the voice-import flow
// already uses (bestCardMatch in app.js), so this function never needs to
// know the card list itself.
//
// Two request shapes, picked by body.mode:
//   - (default / "identify") { frames } -> { ok, cards }
//     The normal path. Also folds in a handful of recent
//     scan_qty_reviews (see below) as extra guidance before calling Claude.
//   - "review" { frames, cardName, aiQty, trueQty } -> { ok, analysis }
//     Called once a person corrects a wrong quantity in the review table
//     (see teachScanQuantityCorrection in app.js). Sends the SAME frames
//     back to Claude along with what it originally guessed and what the
//     actual count was, asks for a short generalizable explanation of what
//     visual evidence indicates the true count, and stores that analysis
//     in scan_qty_reviews -- which the default path above then folds into
//     every future identify call, so a real quantity mistake teaches
//     something durable instead of just getting silently overwritten in
//     one person's local edit.
//
// Deploy with: supabase functions deploy identify-cards
// Needs the ANTHROPIC_API_KEY secret set first (get a key at
// console.anthropic.com — this is separate from a claude.ai subscription):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically by
// Supabase, same as every other Edge Function in this project.

import Anthropic from "npm:@anthropic-ai/sdk@latest";
import { createClient } from "npm:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-opus-5";
const MAX_FRAMES = 40;
const MAX_QTY_LESSONS = 8; // recent scan_qty_reviews rows folded into the identify prompt
const MAX_LESSON_CHARS = 300; // defensive cap per lesson in case a review answer runs long

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const BASE_SYSTEM_PROMPT = `You are looking at still frames sampled from a live camera feed, a recorded video, or a single photo, of someone opening a pack of the Riftbound Trading Card Game, sweeping/fanning a handful of cards past the camera, or showing off cards they own.

The frames are given to you in chronological order (frame 1 is earliest), sampled roughly every 0.2-0.4 seconds. Some frames may show no card at all (a gap between sweeps, an empty table, a hand mid-motion) -- that's expected, just ignore those. Identify every distinct physical card visible across the rest.

Many frames will be angled, partially cut off, or motion-blurred rather than a clean flat shot -- that's normal for a continuous sweep, not a reason to skip a card. If the title text isn't fully legible in a given frame, use the small set code + number printed in a bottom corner of the card (e.g. "OGN-066") to identify or confirm it instead; a legible corner number is just as good evidence as a legible name.

Counting physical copies is the hard part, so use this priority order:

1. PRIMARY signal — track the frontmost, fully-legible card across the sequence. If a card with a given name is the clear, unobstructed front card in one frame, then a few frames later a DIFFERENT card becomes the front card, and later still a card with that SAME name becomes the front card again, that is almost always the person having flipped past it and back to a second physical copy, not the camera revisiting the first one — count each such distinct "turn at the front" as a separate copy. Don't collapse these into 1 just because the name repeats; a repeated name across non-adjacent turns at the front is the main evidence you have for multiple copies.
2. SECONDARY signal — in a single frame, cards are often fanned in one hand with several copies of the same card stacked directly behind the front one, each showing only a sliver of its edge or corner (cost pip, color, border). Count each distinct sliver you can clearly attribute to that same card as an additional copy, but don't guess at a stack whose individual cards you can't actually distinguish -- an ambiguous blur of red borders behind a card is not evidence of a specific count.
3. When the two signals disagree, or when you're genuinely unsure, prefer the LOWER number and let a human correct it upward -- an undercount is a quick fix for the person reviewing your results, but a confident wrong number is easy to miss.

Only count the same physical copy once even though it appears in several consecutive frames while the camera or hand holds still on it -- that's the one case where repetition means "still the same card," not a new copy.

For each distinct card, report:
- "name": the card's title text, exactly as printed
- "qty": how many separate physical copies you're confident are shown, per the priority order above
- "collectorNumber": the small set code + number printed on the card (e.g. "OGN-066/298"), if it's legible — omit this field entirely if you can't read it

List the cards in the JSON array in the order each one is FIRST seen across the frames (earliest first) -- the person scanning wants their results back in the same order they showed the cards to the camera.

Respond with ONLY a JSON array, no prose, no markdown code fences. If you can't identify any cards, respond with []. Example:
[{"name":"Bargain-Bin Baron, Sir Reginald Duct-Taped","qty":1,"collectorNumber":"OGN-066/298"},{"name":"Anchor Dump","qty":3}]`;

const REVIEW_SYSTEM_PROMPT = `You previously looked at a set of frames from a Riftbound TCG card-scanning session and reported a count for one card. The person who scanned these cards has now told you the count you reported was wrong and given you the actual correct count.

Look at the frames again with that correction in mind. In 2-3 short sentences, explain what specific, generalizable visual signal in frames like these actually indicates the correct count rather than what you originally reported -- for example, a card reappearing as the clear front-and-center card after a genuinely different card was shown in between (a real second copy), versus the same physical card just being held steady or re-examined (not a new copy), or a stack sliver behind the front card that was ambiguous. If the frames genuinely don't contain enough evidence to explain the correction either way, say so plainly instead of guessing -- that itself is useful (it likely means the recording didn't get a clean look at every copy, not that anything was misread).

Write your answer so it generalizes to counting DIFFERENT cards in future scans, not just this one card. Do not just restate the numbers you were given. Respond with plain text only, no JSON, no markdown.`;

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

function firstTextBlock(content: any[]): string {
  for (const block of content) {
    if (block.type === "text") return block.text;
  }
  return "";
}

function framesToImageBlocks(frames: string[]) {
  return frames.map((dataUrl) => {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
    if (!match) throw new Error("Frame isn't a base64 image data URL");
    return {
      type: "image",
      source: { type: "base64", media_type: match[1], data: match[2] },
    };
  });
}

// Recent corrections' analyses, folded into the identify prompt as
// non-binding guidance -- capped in count and length so this can't grow
// the prompt without bound as more corrections come in over time.
async function recentQtyLessons(): Promise<string> {
  const { data, error } = await supabase
    .from("scan_qty_reviews")
    .select("analysis")
    .order("created_at", { ascending: false })
    .limit(MAX_QTY_LESSONS);
  if (error || !data || !data.length) return "";
  const lines = data
    .map((row: { analysis: string }) => (row.analysis || "").trim().slice(0, MAX_LESSON_CHARS))
    .filter(Boolean)
    .map((line: string) => `- ${line}`);
  if (!lines.length) return "";
  return `\n\nLESSONS FROM PAST QUANTITY CORRECTIONS (real cases where a person fixed a wrong count -- treat these as generalizable guidance about what to look for, not facts about these specific cards):\n${lines.join("\n")}`;
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

async function handleReview(body: any) {
  const frames: string[] = Array.isArray(body.frames) ? body.frames.slice(0, MAX_FRAMES) : [];
  const cardName = String(body.cardName || "").trim();
  const aiQty = Number(body.aiQty);
  const trueQty = Number(body.trueQty);
  if (!frames.length) return jsonResponse({ ok: false, error: "No frames provided" }, 400);
  if (!cardName || !Number.isFinite(aiQty) || !Number.isFinite(trueQty)) {
    return jsonResponse({ ok: false, error: "cardName, aiQty, and trueQty are required" }, 400);
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: REVIEW_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          ...framesToImageBlocks(frames),
          {
            type: "text",
            text: `Card: "${cardName}". You previously reported qty ${aiQty}. The actual correct qty is ${trueQty}.`,
          },
        ],
      },
    ],
  } as any);

  const analysis = firstTextBlock(response.content as any[]).trim();
  if (analysis) {
    const { error } = await supabase.from("scan_qty_reviews").insert({
      card_name: cardName, ai_qty: aiQty, true_qty: trueQty, analysis,
    });
    if (error) console.error("scan_qty_reviews insert failed", error);
  }
  return jsonResponse({ ok: true, analysis });
}

async function handleIdentify(body: any) {
  const frames: string[] = Array.isArray(body.frames) ? body.frames.slice(0, MAX_FRAMES) : [];
  if (!frames.length) return jsonResponse({ ok: false, error: "No frames provided" }, 400);

  const lessons = await recentQtyLessons();

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: BASE_SYSTEM_PROMPT + lessons,
    messages: [
      {
        role: "user",
        content: [
          ...framesToImageBlocks(frames),
          { type: "text", text: `Here are ${frames.length} frame(s) to look at. Identify the cards.` },
        ],
      },
    ],
  } as any);

  const raw = firstTextBlock(response.content as any[]) || "[]";
  const cards = extractJson(raw);
  return jsonResponse({ ok: true, cards });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "POST only" }, 405);

  try {
    const body = await req.json();
    if (body.mode === "review") return await handleReview(body);
    return await handleIdentify(body);
  } catch (err) {
    console.error(err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
