import { GoogleGenAI } from "@google/genai";

// Per-route models, chosen to spread the free-tier daily quota.
// flash-lite has a much higher RPD (~500/day) — use it for the request-heavy
// per-page transcription and question extraction. Reserve full flash (low RPD,
// ~20/day) for the single high-value reasoning call per run: evaluation.
export const MODEL_TRANSCRIBE = "gemini-3.1-flash-lite";
export const MODEL_EXTRACT = "gemini-3.1-flash-lite";
// Paid: the single high-value reasoning call per run. Spend is hard-capped by
// the credit counter in app/api/evaluate/route.ts (data/eval-budget.sql).
export const MODEL_EVALUATE = "gemini-3.1-pro-preview";

// Free tier is heavily rate-limited (e.g. 5 req/min on 2.5-flash) and the
// shared backend occasionally returns 503 under load. Retry both transient
// cases with backoff, honoring Gemini's suggested retryDelay when present.
const MAX_RETRIES = 5;

// Wall-clock budget for all retries + sleeps combined. Vercel's Hobby plan kills
// a function at 60s; if we sleep past that the platform serves an HTML error
// page (which the client can't parse) instead of our JSON. Stop retrying with
// time to spare so the route returns a clean JSON error instead of timing out.
// Override with RETRY_BUDGET_MS where the host allows longer requests (the eval
// Cloud Run service runs with a 300s timeout — see infra/eval-run).
const RETRY_BUDGET_MS = Number(process.env.RETRY_BUDGET_MS) || 45_000;
// Cap any single backoff so one long sleep can't eat the whole budget.
const MAX_BACKOFF_MS = 8_000;

function transientStatus(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  // The SDK surfaces the upstream JSON in the message; match the codes there.
  if (/"code"\s*:\s*429|RESOURCE_EXHAUSTED/.test(msg)) return 429;
  if (/"code"\s*:\s*503|UNAVAILABLE/.test(msg)) return 503;
  return null;
}

function suggestedDelayMs(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  // "retryDelay":"6s" or "Please retry in 6.93s."
  const m = msg.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/) ?? msg.match(/retry in (\d+(?:\.\d+)?)s/);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Run a Gemini call, retrying on 429/503 with exponential backoff + jitter.
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = transientStatus(err);
      if (status === null || attempt === MAX_RETRIES) throw err;
      const backoff = Math.min(2 ** attempt * 1000, MAX_BACKOFF_MS) + Math.random() * 1000;
      const wait = Math.min(suggestedDelayMs(err) ?? backoff, MAX_BACKOFF_MS);
      // Bail if waiting would push us past the function's time budget — better to
      // throw the rate-limit error now (clean JSON) than be killed mid-sleep.
      if (Date.now() - start + wait > RETRY_BUDGET_MS) throw err;
      await sleep(wait);
    }
  }
  // Unreachable: the loop either returns or throws above.
  throw new Error("Retry budget exhausted.");
}

// Lazily construct the client so importing this module (e.g. during build)
// doesn't require the key — it's only needed when a request actually runs.
// Server-only: never import from a client component, or the key leaks.
// Get a free key at https://aistudio.google.com/apikey (no billing needed).
let client: GoogleGenAI | null = null;

export function getGenAI(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set. Add it to .env.local (or Vercel env vars).");
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}
