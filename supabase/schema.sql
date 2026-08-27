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
-- follows
-- ---------------------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint no_self_follow check (follower_id <> following_id)
);

alter table public.follows enable row level security;

drop policy if exists "follows are publicly readable" on public.follows;
create policy "follows are publicly readable"
  on public.follows for select
  to authenticated
  using (true);

drop policy if exists "users manage their own follows" on public.follows;
create policy "users manage their own follows"
  on public.follows for all
  to authenticated
  using (auth.uid() = follower_id)
  with check (auth.uid() = follower_id);

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
