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
  topic         text not null default '',
  transcript    text not null default '',
  overall_score integer not null,
  verdict       text not null default '',
  criteria      jsonb not null default '{}'::jsonb,
  strengths     jsonb not null default '[]'::jsonb,
  priorities    jsonb not null default '[]'::jsonb
);

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
