import { createClient } from "@supabase/supabase-js";
import type { Evaluation, EvalMode } from "./criteria";

// Client-side Supabase, used only for saving + listing evaluation history.
// The publishable (anon) key is safe to expose to the browser; row access is
// governed by RLS policies on the `evaluations` table (see
// data/supabase-schema.sql). If the env vars are absent the app still works —
// history just stays disabled.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabase = url && key ? createClient(url, key) : null;
export const historyEnabled = Boolean(supabase);

// One saved evaluation. Columns mirror the Evaluation shape, flattened so the
// scalar fields (score, verdict) are queryable for trend charts.
export type EvalRecord = {
  id: string;
  created_at: string;
  mode: EvalMode;
  topic: string;
  transcript: string;
  overall_score: number;
  verdict: string;
  criteria: Evaluation["criteria"];
  strengths: string[];
  priorities: string[];
};

export async function saveEvaluation(input: {
  mode: EvalMode;
  topic: string;
  transcript: string;
  evaluation: Evaluation;
}): Promise<void> {
  if (!supabase) return;
  const ev = input.evaluation;
  const { error } = await supabase.from("evaluations").insert({
    mode: input.mode,
    topic: input.topic,
    transcript: input.transcript,
    overall_score: ev.overall_score,
    verdict: ev.one_line_verdict,
    criteria: ev.criteria,
    strengths: ev.top_strengths,
    priorities: ev.top_priorities,
  });
  if (error) throw new Error(error.message);
}

export async function fetchHistory(limit = 20): Promise<EvalRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("evaluations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as EvalRecord[];
}

// --- Auth (Google sign-in) ---
// The browser client persists the session and handles the OAuth redirect
// automatically (detectSessionInUrl default). Server-side API routes verify
// the resulting token + email allowlist — see lib/auth-server.ts.
export async function signInWithGoogle(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
    },
  });
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}

// Current session JWT, sent as a Bearer token on API calls so the server can
// authenticate the caller.
export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

// Rebuild the in-app Evaluation object from a stored record so a past run can
// be re-displayed with the same UI.
export function recordToEvaluation(r: EvalRecord): Evaluation {
  return {
    overall_score: r.overall_score,
    one_line_verdict: r.verdict,
    criteria: r.criteria,
    top_strengths: r.strengths,
    top_priorities: r.priorities,
  };
}
