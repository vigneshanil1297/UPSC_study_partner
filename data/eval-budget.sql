-- Hard spend caps for the paid Gemini calls.
-- Run this once in the Supabase SQL editor for project uopdsonmsqujgfleoqzz.
--
-- Why a DB function and not app code: the routes only have the anon key
-- server-side, and a read-then-write counter races under concurrent requests
-- (two calls both read N, both write N+1 -> overshoot). This SECURITY DEFINER
-- function does the check-and-increment atomically under a row lock, so a
-- counter can never exceed its budget no matter how many requests race.
--
-- Two independent budgets, keyed by id:
--   * 'eval'      -- gemini-3.1-pro evaluation. 169 lifetime / 3 per day
--                    (~INR 2200; pro output dominates cost).
--   * 'flashlite' -- gemini-3.1-flash-lite transcription + question extraction.
--                    Cheap (~INR 3/pdf) but on a separate route, so the eval
--                    cap doesn't bound it; this stops a retry/loop storm.
--                    ~19 flash-lite calls per 18-page pdf, so 3600/90 leaves
--                    generous headroom over the 169-pdf eval ceiling.
-- Day boundary is IST.

create table if not exists public.eval_budget (
  id           text primary key,                 -- 'eval' | 'flashlite'
  total_budget integer not null,
  total_used   integer not null default 0,
  daily_max    integer not null,
  day          date    not null default (now() at time zone 'Asia/Kolkata')::date,
  daily_used   integer not null default 0
);

-- Seed the budget rows. Edit these numbers to re-budget later (or:
-- update public.eval_budget set total_budget = N, daily_max = M where id = '...').
insert into public.eval_budget (id, total_budget, daily_max) values
  ('eval',      169,  3),
  ('flashlite', 3600, 90)
on conflict (id) do nothing;

-- Lock the table down: RLS on + no policies => anon/authenticated cannot read
-- or write it directly. Access is ONLY through the function below, which runs
-- as the definer and bypasses RLS.
alter table public.eval_budget enable row level security;

-- Atomically consume one credit from budget p_kind. Returns ok=true and the new
-- counters when a credit was granted, ok=false + reason when a cap is hit.
create or replace function public.consume_eval_credit(p_kind text default 'eval')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  r     public.eval_budget;
  dused integer;
begin
  -- Serialize concurrent callers on this row.
  select * into r from public.eval_budget where id = p_kind for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_budget_row');
  end if;

  -- Roll the per-day counter over at the IST date boundary.
  dused := case when r.day <> today then 0 else r.daily_used end;

  if r.total_used >= r.total_budget then
    update public.eval_budget set day = today, daily_used = dused where id = p_kind;
    return jsonb_build_object('ok', false, 'reason', 'total_exhausted',
      'total_used', r.total_used, 'total_budget', r.total_budget,
      'daily_used', dused, 'daily_max', r.daily_max);
  end if;

  if dused >= r.daily_max then
    update public.eval_budget set day = today, daily_used = dused where id = p_kind;
    return jsonb_build_object('ok', false, 'reason', 'daily_exhausted',
      'total_used', r.total_used, 'total_budget', r.total_budget,
      'daily_used', dused, 'daily_max', r.daily_max);
  end if;

  update public.eval_budget
     set total_used = r.total_used + 1,
         daily_used = dused + 1,
         day        = today
   where id = p_kind;

  return jsonb_build_object('ok', true,
    'total_used', r.total_used + 1, 'total_budget', r.total_budget,
    'daily_used', dused + 1, 'daily_max', r.daily_max);
end;
$$;

revoke all on function public.consume_eval_credit(text) from public;
grant execute on function public.consume_eval_credit(text) to anon, authenticated;

-- Refund one credit to budget p_kind. Called when a paid call was charged
-- up-front (consume_eval_credit) but then FAILED before producing a result
-- (Vercel/Cloud Run timeout, model 5xx, malformed output) — so a failure the
-- user didn't cause doesn't burn their daily allowance. Decrements never below
-- zero, and only touches daily_used when the charge happened today (a refund
-- arriving after the IST day-rollover would otherwise underflow yesterday's
-- count into today's). consume is still the safe up-front guard; this just
-- gives back what a confirmed failure didn't spend.
create or replace function public.refund_eval_credit(p_kind text default 'eval')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  r     public.eval_budget;
begin
  select * into r from public.eval_budget where id = p_kind for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_budget_row');
  end if;

  update public.eval_budget
     set total_used = greatest(r.total_used - 1, 0),
         daily_used = case when r.day = today then greatest(r.daily_used - 1, 0)
                           else r.daily_used end
   where id = p_kind;

  return jsonb_build_object('ok', true, 'refunded', true);
end;
$$;

revoke all on function public.refund_eval_credit(text) from public;
grant execute on function public.refund_eval_credit(text) to anon, authenticated;
