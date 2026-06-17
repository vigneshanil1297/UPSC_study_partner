import { createClient } from "@supabase/supabase-js";
import type { EvalMode, EvalResult, Question, StructuredPage } from "./criteria";

// Client-side Supabase, used only for saving + listing evaluation history.
// The publishable (anon) key is safe to expose to the browser; row access is
// governed by RLS policies on the `evaluations` table (see
// data/supabase-schema.sql). If the env vars are absent the app still works —
// history just stays disabled.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabase = url && key ? createClient(url, key) : null;
export const historyEnabled = Boolean(supabase);

// One saved evaluation. The structured transcript (pages), the question list,
// and the full evaluation result are stored as jsonb so a past run can be
// restored verbatim. `overall_score` is a 0-100 percentage derived from the
// per-answer scores, kept scalar for the trend chart. `topic` doubles as the
// list title.
export type EvalRecord = {
  id: string;
  created_at: string;
  mode: EvalMode;
  topic: string;
  overall_score: number;
  questions: Question[];
  pages: StructuredPage[];
  result: EvalResult;
};

// Average of each answer's score/max, as a 0-100 percentage.
export function overallPercent(result: EvalResult): number {
  const answers = result.answers.filter((a) => a.max_score > 0);
  if (!answers.length) return 0;
  const avg = answers.reduce((s, a) => s + a.score / a.max_score, 0) / answers.length;
  return Math.round(avg * 100);
}

export async function saveEvaluation(input: {
  mode: EvalMode;
  title: string;
  questions: Question[];
  pages: StructuredPage[];
  result: EvalResult;
}): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("evaluations").insert({
    mode: input.mode,
    topic: input.title,
    overall_score: overallPercent(input.result),
    questions: input.questions,
    pages: input.pages,
    result: input.result,
  });
  if (error) throw new Error(error.message);
}

export async function fetchHistory(limit = 20): Promise<EvalRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("evaluations")
    .select("id, created_at, mode, topic, overall_score, questions, pages, result")
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
