-- Treeoguessr profile schema: per-mode species mastery tracking.
-- Run this in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run after supabase/schema.sql; independent of the other tables.

-- ---------------------------------------------------------------------------
-- species_guesses: one row per (player, mode, taxon), accumulating how many
-- times that player has guessed that species right or wrong in that mode.
-- Drives the Profile page totals, the "x of y species in this area" counter,
-- and round selection (a species mastered in a mode is hidden until the area
-- is exhausted; a missed one stays in the pool).
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

create policy "select own species_guesses"
  on public.species_guesses for select
  using (auth.uid() = user_id);

create policy "insert own species_guesses"
  on public.species_guesses for insert
  with check (auth.uid() = user_id);

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
