-- Treeoguessr VS mode schema: usernames, friendships, and async match challenges.
-- Run this in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run after supabase/schema.sql; independent of game_results.

-- ---------------------------------------------------------------------------
-- profiles: one username per signed-in user. Needed so players can find each
-- other by name. Username format (3-20 chars, [A-Za-z0-9_]) is enforced in the
-- app; here we only enforce case-insensitive uniqueness.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  username   text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

alter table public.profiles enable row level security;

-- Any authenticated user can read profiles (username search needs this).
create policy "profiles readable by authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create policy "insert own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- friendships: a directed request (requester → addressee) that becomes mutual
-- once accepted. The expression unique index blocks duplicates in either
-- direction, so A→B and a later B→A can't both exist.
-- ---------------------------------------------------------------------------
create table if not exists public.friendships (
  id         uuid primary key default gen_random_uuid(),
  requester  uuid not null references auth.users (id) on delete cascade,
  addressee  uuid not null references auth.users (id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester <> addressee)
);

create unique index if not exists friendships_pair_idx
  on public.friendships (least(requester, addressee), greatest(requester, addressee));

alter table public.friendships enable row level security;

create policy "select own friendships"
  on public.friendships for select
  to authenticated
  using (auth.uid() = requester or auth.uid() = addressee);

create policy "insert own friend request"
  on public.friendships for insert
  to authenticated
  with check (auth.uid() = requester);

-- Only the addressee can accept (or otherwise update) a pending request.
create policy "addressee updates friendship"
  on public.friendships for update
  to authenticated
  using (auth.uid() = addressee)
  with check (auth.uid() = addressee);

-- Either party can remove the friendship (decline / unfriend).
create policy "either party deletes friendship"
  on public.friendships for delete
  to authenticated
  using (auth.uid() = requester or auth.uid() = addressee);

-- ---------------------------------------------------------------------------
-- matches: an async VS challenge. The challenger creates it (pending) with
-- their location; the opponent accepts, which freezes the 16 rounds server-side
-- (status active). Round freezing and score writes happen through service-role
-- API routes, so RLS only needs to cover client reads, creation, and decline.
-- ---------------------------------------------------------------------------
create table if not exists public.matches (
  id               uuid primary key default gen_random_uuid(),
  challenger       uuid not null references auth.users (id) on delete cascade,
  opponent         uuid not null references auth.users (id) on delete cascade,
  mode             text not null check (mode in ('normal', 'hard', 'botanist')),
  status           text not null default 'pending'
                     check (status in ('pending', 'active', 'complete', 'declined')),
  challenger_loc   jsonb not null,
  opponent_loc     jsonb,
  rounds           jsonb,
  challenger_score int,
  opponent_score   int,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (challenger <> opponent)
);

create index if not exists matches_challenger_idx on public.matches (challenger, created_at desc);
create index if not exists matches_opponent_idx   on public.matches (opponent, created_at desc);

alter table public.matches enable row level security;

create policy "select own matches"
  on public.matches for select
  to authenticated
  using (auth.uid() = challenger or auth.uid() = opponent);

create policy "challenger creates match"
  on public.matches for insert
  to authenticated
  with check (auth.uid() = challenger and status = 'pending');

-- The opponent may decline a pending match from the client. Accepting (which
-- freezes rounds) and score writes go through the service-role routes instead.
create policy "opponent declines match"
  on public.matches for update
  to authenticated
  using (auth.uid() = opponent)
  with check (auth.uid() = opponent and status = 'declined');
