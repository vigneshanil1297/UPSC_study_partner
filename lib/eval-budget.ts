import { createClient } from "@supabase/supabase-js";

// Server-side spend caps for the paid Gemini calls. The actual check-and-
// increment is an atomic Postgres function (data/eval-budget.sql); this is just
// the thin RPC caller. Uses the anon key — the function is SECURITY DEFINER and
// granted to anon, so it can update the locked-down budget table on our behalf.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// Which budget to draw from: 'eval' = gemini-3.1-pro, 'flashlite' = the
// per-page transcription + question extraction calls.
export type BudgetKind = "eval" | "flashlite";

export type CreditResult = {
  ok: boolean;
  reason?: string;
  total_used?: number;
  total_budget?: number;
  daily_used?: number;
  daily_max?: number;
};

// Consume one credit from the given budget. Fail-OPEN when Supabase env is
// absent (local dev, which routes through the claude CLI and spends no Gemini
// quota anyway); fail-CLOSED on an actual RPC error, so a DB blip can never
// silently uncap a paid model.
export async function consumeCredit(kind: BudgetKind = "eval"): Promise<CreditResult> {
  if (!url || !key) return { ok: true, reason: "uncapped_no_supabase" };
  const supabase = createClient(url, key);
  const { data, error } = await supabase.rpc("consume_eval_credit", { p_kind: kind });
  if (error) return { ok: false, reason: `budget_check_failed: ${error.message}` };
  return data as CreditResult;
}
