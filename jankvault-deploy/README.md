# Jank Vault social layer — setup checklist

Everything here happens in your own browser, on accounts only you can create.
Once you're through it, send me back the four values marked **→ send me this**
and I'll wire the app up to them.

## 1. Create the Supabase project

1. Go to supabase.com and sign up / log in.
2. Click **New project**. Pick any name (e.g. "jank-vault"), a database
   password (Supabase needs one — you won't need to remember it, it's not
   used day to day), and the region closest to your group.
3. Wait for the project to finish provisioning (~2 minutes).
4. In the left sidebar: **Project Settings → API**.
   - Copy the **Project URL** → send me this
   - Copy the **anon / public** key (NOT the `service_role` key — that one
     must never leave Supabase) → send me this

## 2. Run the database schema

1. In the left sidebar: **SQL Editor → New query**.
2. Open `supabase/schema.sql` from the project files I gave you, paste the
   whole thing in, and click **Run**.
3. This creates every table (profiles, posts, follows, kudos, comments,
   push subscriptions), the security rules that keep people from editing
   each other's data, and the `media` storage bucket for photos/videos.
   It's safe to re-run if you ever need to.

## 3. Set up Google sign-in

This is the fiddliest part — Google requires its own project just to hand
out an OAuth client ID.

1. Go to console.cloud.google.com, create a project (or reuse one you
   already have).
2. **APIs & Services → OAuth consent screen** — fill in an app name (e.g.
   "Jank Vault") and your email as support/developer contact. "External"
   user type is fine; you don't need to submit it for verification for a
   small group — Google just caps it at 100 test users until/unless you do.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   → Application type: **Web application**.
4. Back in Supabase: **Authentication → Providers → Google**, toggle it on.
   This page shows you the exact **redirect URL** to paste into the Google
   client you just created (looks like
   `https://<your-project>.supabase.co/auth/v1/callback`) — add it under
   "Authorized redirect URIs" on the Google Cloud credential.
5. Copy the **Client ID** and **Client Secret** Google gives you and paste
   them into that same Supabase Google provider page. Save.
6. Copy the **Client ID** again → send me this (the secret stays in
   Supabase — I never need it, don't send it to me).

## 4. Push notifications (VAPID keys + Edge Function)

Web Push needs its own keypair (separate from Google/Supabase) that proves
to browsers your server is who it says it is. I already generated one for
you — see the `vapid_keys.txt` file I sent alongside this doc. Two values
in there:

- `VAPID_PUBLIC_KEY` — goes in the app's config (I'll wire this in for you,
  see the bottom of this doc), safe to be public.
- `VAPID_PRIVATE_KEY` — secret, never goes in the app. It only lives as a
  Supabase Edge Function secret (next step).

To actually send push messages when someone posts or comments:

1. Deploy the Edge Function at `supabase/functions/send-push/index.ts`.
   This needs the Supabase CLI running somewhere with real internet access
   (my sandbox can't reach Supabase directly — see the note in-chat) — your
   own machine works fine: `npx supabase login`, `npx supabase link
   --project-ref <your-project-ref>`, then `npx supabase functions deploy
   send-push`.
2. Set the function's secrets (Project Settings → Edge Functions, or via
   CLI: `npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...
   VAPID_SUBJECT=mailto:you@example.com SITE_URL=https://your-deployed-url`).
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically
   by Supabase — you don't need to set those two yourself.
3. In the Supabase dashboard: **Database → Webhooks → Create a new hook**.
   Make two of these:
   - Table `posts`, event `INSERT`, target: the `send-push` Edge Function.
   - Table `comments`, event `INSERT`, target: the `send-push` Edge Function.

That's it — new posts notify a poster's followers, new comments notify the
post's author.

## 5. Pick hosting

Push notifications (and the service worker they need) only work over HTTPS
with the app actually deployed somewhere — not from a downloaded file or
the claude.ai preview. Two good free options:

- **Vercel, if you have (or don't mind making) a GitHub account** — connect
  the repo, it auto-deploys on every push. This is the smoother long-term
  setup.
- **Netlify Drop (netlify.com/drop)** — no account or git needed at all,
  you just drag a folder onto the page and get a live URL. Simpler to start
  with, but you'll re-drop the folder by hand each time there's an update.

Let me know which one you'd rather do and I'll tailor the deploy steps and
hand you a ready-to-drop/push folder.

---

**What to send back when you're done:** Supabase Project URL, Supabase anon
key, Google OAuth Client ID, and which hosting option you picked. You don't
need to touch `config.js` yourself — send me those values and I'll fill it
in and rebuild the deploy folder.
