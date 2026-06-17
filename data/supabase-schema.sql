-- UPSC evaluator: saved evaluation history (per-user, Google sign-in).
-- Run this once in the Supabase SQL editor for project uopdsonmsqujgfleoqzz.
--
-- Auth: Google OAuth via Supabase Auth. Each row is owned by the signed-in
-- user; RLS limits read/write to that user's own rows. The API routes
-- additionally enforce an email allowlist (ALLOWED_EMAILS) before spending the
-- Gemini key.

create table if not exists public.evaluations (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  mode          text not null,
  topic         text not null default '',         -- doubles as the history list title
  transcript    text not null default '',         -- legacy (flat-text era), unused by new runs
  overall_score integer not null,                 -- 0-100 percentage, for the trend chart
  verdict       text not null default '',         -- legacy
  criteria      jsonb not null default '{}'::jsonb,   -- legacy
  strengths     jsonb not null default '[]'::jsonb,   -- legacy
  priorities    jsonb not null default '[]'::jsonb,   -- legacy
  -- New structured model: full transcript pages, question list, eval result.
  questions     jsonb not null default '[]'::jsonb,
  pages         jsonb not null default '[]'::jsonb,
  result        jsonb not null default '{}'::jsonb
);

-- Migration for an existing table created before the structured model:
alter table public.evaluations add column if not exists questions jsonb not null default '[]'::jsonb;
alter table public.evaluations add column if not exists pages     jsonb not null default '[]'::jsonb;
alter table public.evaluations add column if not exists result    jsonb not null default '{}'::jsonb;

create index if not exists evaluations_user_created_idx
  on public.evaluations (user_id, created_at desc);

alter table public.evaluations enable row level security;

-- A user can only see and insert their own rows.
drop policy if exists "own read" on public.evaluations;
create policy "own read" on public.evaluations
  for select using (auth.uid() = user_id);

drop policy if exists "own insert" on public.evaluations;
create policy "own insert" on public.evaluations
  for insert with check (auth.uid() = user_id);
