-- Jankrats social layer — Supabase schema.
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query → paste → Run).
-- Safe to re-run: uses "if not exists" / "or replace" throughout.

-- ---------------------------------------------------------------------------
-- profiles: one row per signed-in player, linked 1:1 to Supabase auth.users.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Anonymous brewer',
  avatar_url text,                    -- from Google account, informational only
  champion_banner_card_id text,       -- id from the Riftbound card database, e.g. "OGN-066/298"
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

drop policy if exists "users can insert their own profile" on public.profiles;
create policy "users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- Auto-create a profile row the first time someone signs in with Google.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Anonymous brewer'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- collection_entries: how many of each card a player owns, one row per
-- (player, card). This is what powers the Friends tab — every signed-in
-- player's collection is readable by every other signed-in player, so
-- friends can see what each other owns.
-- ---------------------------------------------------------------------------
create table if not exists public.collection_entries (
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id text not null,
  qty integer not null default 0,
  foil integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id),
  constraint non_negative_counts check (qty >= 0 and foil >= 0)
);

create index if not exists collection_entries_user_idx on public.collection_entries (user_id);

alter table public.collection_entries enable row level security;

drop policy if exists "collection entries are publicly readable" on public.collection_entries;
create policy "collection entries are publicly readable"
  on public.collection_entries for select
  to authenticated
  using (true);

drop policy if exists "users manage their own collection entries" on public.collection_entries;
create policy "users manage their own collection entries"
  on public.collection_entries for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- decks: each player's saved decks, one row per deck, keyed by the client-
-- generated deck id (so upserts don't need a separate id-mapping step).
-- This is what powers the Friends tab's "Decks" view — every signed-in
-- player's decks are readable by every other signed-in player.
-- ---------------------------------------------------------------------------
create table if not exists public.decks (
  id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'New deck',
  legend_id text,
  champion_id text,
  domains text[] not null default '{}',
  main jsonb not null default '[]',
  runes jsonb not null default '{}',
  battlefields text[] not null default '{}',
  sideboard jsonb not null default '[]',
  notes text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists decks_user_idx on public.decks (user_id);

alter table public.decks enable row level security;

drop policy if exists "decks are publicly readable" on public.decks;
create policy "decks are publicly readable"
  on public.decks for select
  to authenticated
  using (true);

drop policy if exists "users manage their own decks" on public.decks;
create policy "users manage their own decks"
  on public.decks for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- deck_deletions: a permanent, server-side record of every deck id a
-- player has deleted. Deleting a deck uploads the player's whole local
-- deck list on the next unrelated edit from any OTHER signed-in tab or
-- device that still has a stale copy of it in memory (bulkUpsertDecks
-- re-uploads the full list, not just the one changed deck) -- that would
-- silently resurrect the row. Recording the id here, and having every
-- sign-in re-check it and re-delete anything that snuck back, makes the
-- deletion durable no matter which device it happened on.
-- ---------------------------------------------------------------------------
create table if not exists public.deck_deletions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  deck_id text not null,
  deleted_at timestamptz not null default now(),
  primary key (user_id, deck_id)
);

alter table public.deck_deletions enable row level security;

drop policy if exists "users manage their own deck deletions" on public.deck_deletions;
create policy "users manage their own deck deletions"
  on public.deck_deletions for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- posts: the two post types (deck / pull) live in one table.
-- ---------------------------------------------------------------------------
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('deck', 'pull')),
  caption text,
  deck_json jsonb,                    -- deck posts: {legendId, championId, main:[...], runes:{...}, battlefields:[...]}
  media_path text,                    -- pull posts: storage object path in the "media" bucket
  media_type text check (media_type in ('photo', 'video')),
  card_ids text[] not null default '{}',  -- every card id involved, used to power the Top Cards leaderboard
  created_at timestamptz not null default now(),
  constraint deck_post_has_deck check (type <> 'deck' or deck_json is not null),
  constraint pull_post_has_media check (type <> 'pull' or media_path is not null)
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists posts_author_idx on public.posts (author_id);

alter table public.posts enable row level security;

drop policy if exists "posts are publicly readable" on public.posts;
create policy "posts are publicly readable"
  on public.posts for select
  to authenticated
  using (true);

drop policy if exists "users can create their own posts" on public.posts;
create policy "users can create their own posts"
  on public.posts for insert
  to authenticated
  with check (auth.uid() = author_id);

drop policy if exists "users can delete their own posts" on public.posts;
create policy "users can delete their own posts"
  on public.posts for delete
  to authenticated
  using (auth.uid() = author_id);

-- ---------------------------------------------------------------------------
-- friend_requests: a mutual friendship, gated by request + accept. One row
-- per pair, "pending" until the recipient accepts it (see the update
-- policy below, which only lets the recipient do that) or either side
-- deletes it -- decline, cancel, and unfriend are all just deleting the
-- row, regardless of its status. Only readable by the two people it's
-- between (unlike the old `follows`, which was publicly readable), since
-- a pending row is who-requested-whom information that isn't anyone
-- else's business.
-- ---------------------------------------------------------------------------
create table if not exists public.friend_requests (
  requester_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending', -- 'pending' | 'accepted'
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (requester_id, recipient_id),
  constraint no_self_friend_request check (requester_id <> recipient_id)
);

alter table public.friend_requests enable row level security;

drop policy if exists "friend requests are readable by the two people in them" on public.friend_requests;
create policy "friend requests are readable by the two people in them"
  on public.friend_requests for select
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = recipient_id);

drop policy if exists "users send their own friend requests" on public.friend_requests;
create policy "users send their own friend requests"
  on public.friend_requests for insert
  to authenticated
  with check (auth.uid() = requester_id and status = 'pending');

drop policy if exists "only the recipient can accept a request" on public.friend_requests;
create policy "only the recipient can accept a request"
  on public.friend_requests for update
  to authenticated
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

drop policy if exists "either side can delete a request or friendship" on public.friend_requests;
create policy "either side can delete a request or friendship"
  on public.friend_requests for delete
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = recipient_id);

-- One-time migration from the old one-directional `follows` (kept around
-- just long enough to carry its data over): a pair that followed each
-- other both ways becomes an accepted friendship; a one-directional follow
-- becomes a pending request in that same direction, so nobody's existing
-- connections just vanish under the new request/accept model. A no-op,
-- safe to leave in permanently, once `follows` is gone (including on a
-- fresh install, which never had a `follows` table to migrate from).
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id)
);
insert into public.friend_requests (requester_id, recipient_id, status, responded_at)
select f.follower_id, f.following_id,
  case when exists (
    select 1 from public.follows f2 where f2.follower_id = f.following_id and f2.following_id = f.follower_id
  ) then 'accepted' else 'pending' end,
  case when exists (
    select 1 from public.follows f2 where f2.follower_id = f.following_id and f2.following_id = f.follower_id
  ) then now() else null end
from public.follows f
on conflict (requester_id, recipient_id) do nothing;
drop table if exists public.follows;

-- ---------------------------------------------------------------------------
-- kudos (one per user per post)
-- ---------------------------------------------------------------------------
create table if not exists public.kudos (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.kudos enable row level security;

drop policy if exists "kudos are publicly readable" on public.kudos;
create policy "kudos are publicly readable"
  on public.kudos for select
  to authenticated
  using (true);

drop policy if exists "users manage their own kudos" on public.kudos;
create policy "users manage their own kudos"
  on public.kudos for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists comments_post_idx on public.comments (post_id, created_at);

alter table public.comments enable row level security;

drop policy if exists "comments are publicly readable" on public.comments;
create policy "comments are publicly readable"
  on public.comments for select
  to authenticated
  using (true);

drop policy if exists "users can add their own comments" on public.comments;
create policy "users can add their own comments"
  on public.comments for insert
  to authenticated
  with check (auth.uid() = author_id);

drop policy if exists "users can delete their own comments" on public.comments;
create policy "users can delete their own comments"
  on public.comments for delete
  to authenticated
  using (auth.uid() = author_id);

-- ---------------------------------------------------------------------------
-- push_subscriptions: Web Push endpoints, one row per browser subscription.
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "users manage their own push subscriptions" on public.push_subscriptions;
create policy "users manage their own push subscriptions"
  on public.push_subscriptions for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Service-role only (Edge Functions use the service key, which bypasses RLS
-- anyway — this policy is belt-and-suspenders documentation, not required).

-- ---------------------------------------------------------------------------
-- card_prices: TCGplayer market prices (via tcgcsv.com), one row per card_id,
-- refreshed daily by scripts/price-scraper (see its README) via the service role key.
-- Not user-owned, so no per-row auth.uid() check -- readable by everyone,
-- writable only by the service key (which bypasses RLS), same as
-- push_subscriptions above.
-- ---------------------------------------------------------------------------
create table if not exists public.card_prices (
  card_id text primary key,
  en_price_usd numeric,
  en_foil_price_usd numeric,
  tcgplayer_product_id bigint,
  updated_at timestamptz not null default now()
);

-- Lets the app link straight to a card's TCGplayer page
-- (https://www.tcgplayer.com/product/<id>); cleans up an already-created
-- table, which the create above won't retroactively alter.
alter table public.card_prices add column if not exists tcgplayer_product_id bigint;

-- USD only -- CN pricing was dropped after the first pass; these clean up
-- an already-created table (create table above won't retroactively alter
-- one that already has them).
alter table public.card_prices drop column if exists cn_price_cny;
alter table public.card_prices drop column if exists cn_foil_price_cny;

alter table public.card_prices enable row level security;

drop policy if exists "card prices are publicly readable" on public.card_prices;
create policy "card prices are publicly readable"
  on public.card_prices for select
  to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- scan_corrections: a shared "the AI misread this as X, a person confirmed
-- it's actually card Y" dictionary for the camera/photo scan-import flow.
-- Keyed by the normalized AI-detected phrase text (see normalizeForMatch()
-- in app.js) so a repeat misread gets auto-fixed before it's even shown,
-- instead of every signed-in player hitting the same wrong match forever.
-- Not user-owned -- it's a crowd-sourced lookup table everyone reads and
-- writes to, same shared-trust model the rest of this app already uses for
-- decks/posts visible to any signed-in player.
-- ---------------------------------------------------------------------------
create table if not exists public.scan_corrections (
  phrase text primary key,
  card_id text not null,
  updated_at timestamptz not null default now()
);

alter table public.scan_corrections enable row level security;

drop policy if exists "scan corrections are publicly readable" on public.scan_corrections;
create policy "scan corrections are publicly readable"
  on public.scan_corrections for select
  to anon, authenticated
  using (true);

drop policy if exists "signed-in users can teach scan corrections" on public.scan_corrections;
create policy "signed-in users can teach scan corrections"
  on public.scan_corrections for insert
  to authenticated
  with check (true);

drop policy if exists "signed-in users can update scan corrections" on public.scan_corrections;
create policy "signed-in users can update scan corrections"
  on public.scan_corrections for update
  to authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- scan_qty_reviews: a growing log of "the AI reported qty X for this card,
-- the actual count was Y" cases, each paired with Claude's own short
-- explanation of what it should have looked for. Written and read only by
-- the identify-cards Edge Function (service role, bypasses RLS) -- never
-- directly by client code -- so these policies exist for defense-in-depth
-- and documentation, same reasoning as push_subscriptions' service-role
-- note above, not because the client needs a path in.
-- ---------------------------------------------------------------------------
create table if not exists public.scan_qty_reviews (
  id uuid primary key default gen_random_uuid(),
  card_name text not null,
  ai_qty integer not null,
  true_qty integer not null,
  analysis text not null,
  created_at timestamptz not null default now()
);

create index if not exists scan_qty_reviews_created_at_idx on public.scan_qty_reviews (created_at desc);

alter table public.scan_qty_reviews enable row level security;

-- No policies -- RLS with zero policies denies every request through the
-- anon/authenticated roles entirely; only the service-role key (which
-- bypasses RLS) can touch this table, which is exactly what we want.

-- ---------------------------------------------------------------------------
-- scan_add_events: one row per card actually added from a scan's review
-- table, flagging whether the person had to fix the identity and/or
-- quantity the AI guessed. Unlike scan_corrections (a lookup table that
-- gets overwritten) and scan_qty_reviews (corrections only), this logs
-- EVERY add, correction or not -- the denominator, not just the
-- numerator -- so the correction rate can actually be tracked over time
-- instead of just a raw, usage-inflated correction count. Write-only from
-- the app's side; there's no select policy because the app never reads it
-- back. Review it directly via the Supabase SQL editor (which runs with
-- elevated access, not through these policies) -- e.g. to see whether the
-- correction rate is trending down as scan_corrections/scan_qty_reviews
-- accumulate, or whether the self-learning approach needs a rethink:
--
--   select
--     date_trunc('week', created_at) as week,
--     count(*) as total_adds,
--     count(*) filter (where had_identity_correction or had_qty_correction) as corrected,
--     round(100.0 * count(*) filter (where had_identity_correction or had_qty_correction) / count(*), 1) as correction_rate_pct
--   from public.scan_add_events
--   group by 1
--   order by 1;
-- ---------------------------------------------------------------------------
create table if not exists public.scan_add_events (
  id uuid primary key default gen_random_uuid(),
  card_id text,
  had_identity_correction boolean not null default false,
  had_qty_correction boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists scan_add_events_created_at_idx on public.scan_add_events (created_at desc);

alter table public.scan_add_events enable row level security;

drop policy if exists "signed-in users can log scan add events" on public.scan_add_events;
create policy "signed-in users can log scan add events"
  on public.scan_add_events for insert
  to authenticated
  with check (true);

-- ---------------------------------------------------------------------------
-- top_cards: usage-derived leaderboard, computed from every post's card_ids.
-- ---------------------------------------------------------------------------
create or replace view public.top_cards as
select
  card_id,
  count(*) as post_count,
  count(*) filter (where p.type = 'deck') as deck_count,
  count(*) filter (where p.type = 'pull') as pull_count,
  max(p.created_at) as last_seen_at
from public.posts p
cross join lateral unnest(p.card_ids) as card_id
group by card_id
order by post_count desc;

-- ---------------------------------------------------------------------------
-- tournaments: a Swiss event, organizer-owned. id is the short join code
-- participants use to find and join it. The entire player/round/match
-- state (the same shape app.js already keeps in localStorage) lives in
-- `data`, written only by the organizer's client -- participants only
-- ever read it, self-join via tournament_participants, and report their
-- own match's score via tournament_match_reports (both below), never
-- write to this table directly, so they can't tamper with pairings or
-- someone else's score.
-- ---------------------------------------------------------------------------
create table if not exists public.tournaments (
  id text primary key,
  organizer_id uuid not null references public.profiles(id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create index if not exists tournaments_organizer_idx on public.tournaments (organizer_id);

alter table public.tournaments enable row level security;

-- Anyone signed in can read a tournament row *if they already know its
-- id* (the join code is the access control here, same trust model as a
-- link/invite code -- there's no way to browse the list of every
-- tournament through the app itself).
drop policy if exists "tournaments are readable by signed-in users" on public.tournaments;
create policy "tournaments are readable by signed-in users"
  on public.tournaments for select
  to authenticated
  using (true);

drop policy if exists "organizers manage their own tournaments" on public.tournaments;
create policy "organizers manage their own tournaments"
  on public.tournaments for all
  to authenticated
  using (auth.uid() = organizer_id)
  with check (auth.uid() = organizer_id);

-- ---------------------------------------------------------------------------
-- tournament_participants: self-service join requests. A participant signs
-- in and inserts their own row against a tournament's join code + their
-- display name; the tourney_sync_participant trigger below immediately
-- merges that into tournaments.data.players server-side, so registration
-- doesn't depend on the organizer's browser being open to catch it.
-- ---------------------------------------------------------------------------
create table if not exists public.tournament_participants (
  tournament_id text not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'Player',
  joined_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);

create index if not exists tournament_participants_tournament_idx on public.tournament_participants (tournament_id);

alter table public.tournament_participants enable row level security;

drop policy if exists "tournament participants are readable by signed-in users" on public.tournament_participants;
create policy "tournament participants are readable by signed-in users"
  on public.tournament_participants for select
  to authenticated
  using (true);

drop policy if exists "users can join a tournament as themselves" on public.tournament_participants;
create policy "users can join a tournament as themselves"
  on public.tournament_participants for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "users can leave, organizers can remove participants" on public.tournament_participants;
create policy "users can leave, organizers can remove participants"
  on public.tournament_participants for delete
  to authenticated
  using (
    auth.uid() = user_id
    or auth.uid() = (select organizer_id from public.tournaments where id = tournament_id)
  );

-- A joiner can only insert their own tournament_participants row (RLS
-- above), never write to tournaments.data directly (that table's RLS
-- restricts writes to the organizer). This trigger is what actually
-- grants them a seat: it runs as the function owner (bypassing that
-- organizer-only restriction the same way the owner of any table does),
-- so the join registers immediately and reliably no matter whose
-- browser is or isn't open at the time.
-- Fills the first unclaimed blank slot (a player with no name and no
-- userId -- one of the placeholder rows the "New Tournament" modal
-- pre-seeds from the requested participant count) rather than always
-- appending a new row, so a join lands the player in the roster the
-- organizer already set up instead of tacking on an extra seat. Once
-- Start Tournament is clicked every blank slot gets a "Player N"
-- placeholder name (see app.js), so this only matches during setup --
-- a join with no blank slot left (none pre-seeded, or the tournament
-- already started) falls back to appending a new row so nobody who
-- joins is ever silently dropped.
create or replace function public.tourney_sync_participant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cur_data jsonb;
  players jsonb;
  n int;
  i int;
  slot jsonb;
  filled boolean := false;
  new_players jsonb := '[]'::jsonb;
begin
  select data into cur_data from public.tournaments where id = new.tournament_id for update;
  if cur_data is null then
    return new;
  end if;

  players := coalesce(cur_data->'players', '[]'::jsonb);
  n := jsonb_array_length(players);

  -- Already on the roster (e.g. a duplicate insert slipping past the
  -- upsert's own conflict handling) -- nothing to do.
  for i in 0..n - 1 loop
    if (players->i)->>'userId' = new.user_id::text then
      return new;
    end if;
  end loop;

  for i in 0..n - 1 loop
    slot := players->i;
    if not filled and (slot->>'userId') is null and coalesce(btrim(slot->>'name'), '') = '' then
      slot := slot || jsonb_build_object('name', coalesce(new.name, 'Player'), 'userId', new.user_id::text);
      filled := true;
    end if;
    new_players := new_players || jsonb_build_array(slot);
  end loop;

  if not filled then
    new_players := players || jsonb_build_array(jsonb_build_object(
      'id', 'plyr_' || replace(new.user_id::text, '-', ''),
      'name', coalesce(new.name, 'Player'),
      'dropped', false,
      'userId', new.user_id::text
    ));
  end if;

  update public.tournaments
  set data = (cur_data || jsonb_build_object('players', new_players))
             || jsonb_build_object('updatedAt', (extract(epoch from clock_timestamp()) * 1000)::bigint),
      updated_at = now()
  where id = new.tournament_id;

  return new;
end;
$$;

drop trigger if exists tournament_participants_sync on public.tournament_participants;
create trigger tournament_participants_sync
  after insert on public.tournament_participants
  for each row execute function public.tourney_sync_participant();

-- ---------------------------------------------------------------------------
-- tournament_match_reports: self-service score reporting. A signed-in
-- participant upserts their own report for a match they're playing in;
-- RLS only lets them write rows under their own user_id (same trust model
-- as tournament_participants above). That alone doesn't prove they're
-- actually in that match, so the tourney_sync_match_report trigger below
-- re-checks that by cross-referencing tournaments.data.players before
-- merging the result -- a report for a match the reporter isn't part of
-- is silently ignored.
-- ---------------------------------------------------------------------------
create table if not exists public.tournament_match_reports (
  tournament_id text not null references public.tournaments(id) on delete cascade,
  round_number int not null,
  match_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  result text,
  games jsonb,
  reported_at timestamptz not null default now(),
  primary key (tournament_id, match_id, user_id)
);

create index if not exists tournament_match_reports_tournament_idx on public.tournament_match_reports (tournament_id);

alter table public.tournament_match_reports enable row level security;

drop policy if exists "match reports are readable by signed-in users" on public.tournament_match_reports;
create policy "match reports are readable by signed-in users"
  on public.tournament_match_reports for select
  to authenticated
  using (true);

drop policy if exists "users can report their own match result" on public.tournament_match_reports;
create policy "users can report their own match result"
  on public.tournament_match_reports for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "users can update their own match report" on public.tournament_match_reports;
create policy "users can update their own match report"
  on public.tournament_match_reports for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Merges a participant's own-match report into tournaments.data, the same
-- way tourney_sync_participant merges a join -- runs as the function
-- owner so it can write tournaments.data despite that table's RLS
-- restricting direct writes to the organizer. Only takes effect when the
-- reporting user is genuinely one of the match's two players (by their
-- roster player id, not just their account) and the tournament is still
-- active; otherwise it's a silent no-op rather than an error, since a
-- stale/late report (e.g. after the organizer already completed the
-- tournament) shouldn't surface as a failure to the player.
create or replace function public.tourney_sync_match_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cur_data jsonb;
  players jsonb;
  rounds jsonb;
  n_players int;
  n_rounds int;
  i int;
  j int;
  reporter_player_id text;
  round_obj jsonb;
  match_obj jsonb;
  new_matches jsonb;
  new_rounds jsonb := '[]'::jsonb;
  found boolean := false;
begin
  select data into cur_data from public.tournaments where id = new.tournament_id for update;
  if cur_data is null or coalesce(cur_data->>'status', '') <> 'active' then
    return new;
  end if;

  players := coalesce(cur_data->'players', '[]'::jsonb);
  n_players := jsonb_array_length(players);
  for i in 0..n_players - 1 loop
    if (players->i)->>'userId' = new.user_id::text then
      reporter_player_id := (players->i)->>'id';
    end if;
  end loop;
  if reporter_player_id is null then
    return new;
  end if;

  rounds := coalesce(cur_data->'rounds', '[]'::jsonb);
  n_rounds := jsonb_array_length(rounds);
  for i in 0..n_rounds - 1 loop
    round_obj := rounds->i;
    if (round_obj->>'number')::int = new.round_number then
      new_matches := '[]'::jsonb;
      for j in 0..jsonb_array_length(round_obj->'matches') - 1 loop
        match_obj := (round_obj->'matches')->j;
        if match_obj->>'id' = new.match_id
           and (match_obj->>'p1Id' = reporter_player_id or match_obj->>'p2Id' = reporter_player_id) then
          match_obj := match_obj || jsonb_build_object('result', new.result, 'games', new.games);
          found := true;
        end if;
        new_matches := new_matches || jsonb_build_array(match_obj);
      end loop;
      round_obj := round_obj || jsonb_build_object('matches', new_matches);
    end if;
    new_rounds := new_rounds || jsonb_build_array(round_obj);
  end loop;

  if not found then
    return new;
  end if;

  update public.tournaments
  set data = (cur_data || jsonb_build_object('rounds', new_rounds))
             || jsonb_build_object('updatedAt', (extract(epoch from clock_timestamp()) * 1000)::bigint),
      updated_at = now()
  where id = new.tournament_id;

  return new;
end;
$$;

drop trigger if exists tournament_match_reports_sync on public.tournament_match_reports;
create trigger tournament_match_reports_sync
  after insert or update on public.tournament_match_reports
  for each row execute function public.tourney_sync_match_report();

-- ---------------------------------------------------------------------------
-- storage: a public-read "media" bucket for pull-post photos/videos.
-- Each object is stored under "<user_id>/<uuid>.<ext>" so ownership is checkable by path.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 52428800)  -- 50MB cap per file; short video clips fit comfortably
on conflict (id) do nothing;

drop policy if exists "media is publicly readable" on storage.objects;
create policy "media is publicly readable"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'media');

drop policy if exists "users upload media into their own folder" on storage.objects;
create policy "users upload media into their own folder"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users delete their own media" on storage.objects;
create policy "users delete their own media"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- messages: 1:1 direct messages between players (e.g. asking someone who has
-- a card you need what they'd sell it for). Only the two people in a thread
-- can read it; you can only send as yourself; the recipient can mark
-- messages read but nobody can edit a message's text after it's sent.
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint no_self_message check (sender_id <> recipient_id)
);

create index if not exists messages_sender_idx on public.messages (sender_id, created_at desc);
create index if not exists messages_recipient_idx on public.messages (recipient_id, created_at desc);

alter table public.messages enable row level security;

drop policy if exists "participants can read their messages" on public.messages;
create policy "participants can read their messages"
  on public.messages for select
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

drop policy if exists "users send messages as themselves" on public.messages;
create policy "users send messages as themselves"
  on public.messages for insert
  to authenticated
  with check (auth.uid() = sender_id);

drop policy if exists "recipients mark messages read" on public.messages;
create policy "recipients mark messages read"
  on public.messages for update
  to authenticated
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

revoke update on public.messages from authenticated;
grant update (read_at) on public.messages to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- feedback: bug reports / feature requests from the in-app feedback button.
-- Signed-in users can only insert their own rows; there is deliberately no
-- select policy, so submissions are readable only by the project owner
-- (Supabase dashboard / service role), never by other users.
-- ---------------------------------------------------------------------------
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('feature', 'bug', 'other')),
  body text not null check (char_length(body) between 1 and 4000),
  page text check (page is null or char_length(page) <= 200),
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

drop policy if exists "users submit their own feedback" on public.feedback;
create policy "users submit their own feedback"
  on public.feedback for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Live tournament updates (a player joining, scores reported) reach every
-- open browser through Supabase Realtime, which only streams tables that are
-- in this publication. It was missing for tournaments, so an organizer's
-- screen never learned about joins until they reopened the tournament.
do $$
begin
  alter publication supabase_realtime add table public.tournaments;
exception when duplicate_object then null;
end $$;
