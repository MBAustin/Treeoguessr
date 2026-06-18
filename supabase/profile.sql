-- Treeoguessr profile schema: per-mode species mastery tracking.
-- Run this in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run after supabase/schema.sql; independent of the other tables.

-- ---------------------------------------------------------------------------
-- species_guesses: one row per (player, mode, taxon), accumulating how many
-- times that player has guessed that species right or wrong in that mode.
-- Drives the Profile page totals/most-identified lists and the "x of y species
-- in this area" counter. (Repeats are avoided at the photo level via seen_photos,
-- not by hiding species, so this no longer gates round selection.)
-- ---------------------------------------------------------------------------
create table if not exists public.species_guesses (
  user_id         uuid not null references auth.users (id) on delete cascade default auth.uid(),
  mode            text not null check (mode in ('normal', 'hard', 'botanist')),
  taxon_id        bigint not null,
  scientific_name text not null,
  common_name     text,
  correct_count   int  not null default 0,
  incorrect_count int  not null default 0,
  first_seen_at   timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (user_id, mode, taxon_id)
);

alter table public.species_guesses enable row level security;

-- drop-then-create so the whole file is safe to re-run (create policy isn't idempotent).
drop policy if exists "select own species_guesses" on public.species_guesses;
create policy "select own species_guesses"
  on public.species_guesses for select
  using (auth.uid() = user_id);

drop policy if exists "insert own species_guesses" on public.species_guesses;
create policy "insert own species_guesses"
  on public.species_guesses for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own species_guesses" on public.species_guesses;
create policy "update own species_guesses"
  on public.species_guesses for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists species_guesses_user_mode_idx
  on public.species_guesses (user_id, mode);

-- ---------------------------------------------------------------------------
-- record_guess: atomically upsert one guess. Runs as the caller (SECURITY
-- INVOKER), so the RLS insert/update policies above enforce ownership — the
-- user_id is taken from auth.uid(), never from the client.
-- ---------------------------------------------------------------------------
create or replace function public.record_guess(
  p_mode            text,
  p_taxon_id        bigint,
  p_scientific_name text,
  p_common_name     text,
  p_correct         boolean
) returns void
language sql
as $$
  insert into public.species_guesses
    (user_id, mode, taxon_id, scientific_name, common_name, correct_count, incorrect_count)
  values
    (auth.uid(), p_mode, p_taxon_id, p_scientific_name, p_common_name,
     case when p_correct then 1 else 0 end,
     case when p_correct then 0 else 1 end)
  on conflict (user_id, mode, taxon_id) do update set
    correct_count   = public.species_guesses.correct_count   + case when p_correct then 1 else 0 end,
    incorrect_count = public.species_guesses.incorrect_count + case when p_correct then 0 else 1 end,
    common_name     = coalesce(excluded.common_name, public.species_guesses.common_name),
    updated_at      = now();
$$;

-- ---------------------------------------------------------------------------
-- seen_photos: which iNaturalist photos a player has already been shown, so the
-- game can keep surfacing the same species across games but never repeat the same
-- photo (tracked per photo, since one observation can have several). One row per
-- (player, photo).
-- ---------------------------------------------------------------------------
create table if not exists public.seen_photos (
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  photo_id   bigint not null,
  seen_at    timestamptz not null default now(),
  primary key (user_id, photo_id)
);

-- Migrate installs created before per-photo tracking (column was observation_id).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'seen_photos' and column_name = 'observation_id'
  ) then
    alter table public.seen_photos rename column observation_id to photo_id;
  end if;
end $$;

alter table public.seen_photos enable row level security;

drop policy if exists "select own seen_photos" on public.seen_photos;
create policy "select own seen_photos"
  on public.seen_photos for select
  using (auth.uid() = user_id);

drop policy if exists "insert own seen_photos" on public.seen_photos;
create policy "insert own seen_photos"
  on public.seen_photos for insert
  with check (auth.uid() = user_id);

drop policy if exists "delete own seen_photos" on public.seen_photos;
create policy "delete own seen_photos"
  on public.seen_photos for delete
  using (auth.uid() = user_id);
