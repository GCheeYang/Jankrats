// Jank Vault — send-push Edge Function.
//
// Triggered by two Supabase Database Webhooks (set up in the dashboard,
// see SETUP.md step 5): one on INSERT into public.posts, one on INSERT
// into public.comments. Each webhook POSTs the new row here; this function
// figures out who should be notified and sends them a Web Push message.
//
// Deploy with: supabase functions deploy send-push
// (needs the Supabase CLI on a machine with real internet access — this
// can't be run from Claude's sandboxed cloud workspace, see SETUP.md.)

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
const SITE_URL = Deno.env.get("SITE_URL") || "/";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function sendToUser(userId: string, payload: Record<string, unknown>) {
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("*")
    .eq("user_id", userId);
  if (!subs || !subs.length) return;

  await Promise.all(
    subs.map(async (sub) => {
      const pushSub = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      try {
        await webpush.sendNotification(pushSub, JSON.stringify(payload));
      } catch (err: any) {
        // 404/410 means the browser subscription is dead — clean it up.
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        } else {
          console.error("push send failed:", err);
        }
      }
    })
  );
}

async function displayName(userId: string): Promise<string> {
  const { data } = await supabase.from("profiles").select("display_name").eq("id", userId).single();
  return (data && data.display_name) || "Someone";
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const table = body.table as string;
    const record = body.record as Record<string, any>;

    if (table === "posts") {
      const authorName = await displayName(record.author_id);
      const { data: followers } = await supabase
        .from("follows")
        .select("follower_id")
        .eq("following_id", record.author_id);

      const kind = record.type === "deck" ? "posted a new deck" : "shared a pull";
      const payload = {
        title: "Jank Vault",
        body: `${authorName} ${kind}${record.caption ? `: "${record.caption}"` : ""}`,
        url: `${SITE_URL}#feed`,
      };
      await Promise.all((followers || []).map((f) => sendToUser(f.follower_id, payload)));
    } else if (table === "comments") {
      const { data: post } = await supabase
        .from("posts")
        .select("author_id")
        .eq("id", record.post_id)
        .single();
      if (post && post.author_id !== record.author_id) {
        const commenterName = await displayName(record.author_id);
        const payload = {
          title: "Jank Vault",
          body: `${commenterName} commented: "${record.body}"`,
          url: `${SITE_URL}#feed`,
        };
        await sendToUser(post.author_id, payload);
      }
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
