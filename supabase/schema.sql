-- Treeoguessr database schema.
-- Run this in the Supabase dashboard: SQL Editor → New query → paste → Run.

create table if not exists public.game_results (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  mode       text not null check (mode in ('normal', 'hard', 'botanist')),
  score      int  not null,
  total      int  not null,
  radius     int  not null,
  created_at timestamptz not null default now()
);

-- Row Level Security: players can only see and write their own results.
alter table public.game_results enable row level security;

create policy "select own results"
  on public.game_results for select
  using (auth.uid() = user_id);

create policy "insert own results"
  on public.game_results for insert
  with check (auth.uid() = user_id);

create index if not exists game_results_user_idx
  on public.game_results (user_id, created_at desc);
