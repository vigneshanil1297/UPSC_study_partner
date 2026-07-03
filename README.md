# UPSC Mains Answer Evaluator

Browser tool to parse handwritten UPSC Mains answer booklets (uploaded as PDFs)
and get examiner-style, inline feedback against the paper's syllabus, a topper
playbook, and real topper exemplars. Primary use: **PSIR optional Papers 1 & 2**;
GS Paper I is also supported. Built with Next.js + Google Gemini, deploys to
Vercel (+ a Cloud Run service for the long evaluation call).

## How it works

```
Upload answer-booklet PDF (+ optional question paper)
→ Gemini vision transcribes each page into a layout-faithful digital answer-sheet
→ you correct low-confidence words inline
→ one evaluation call marks it like an examiner: red margin notes anchored to
  lines, per-question demand checklist, value-additions for extra marks,
  structure/word-count vs topper benchmark
```

The two-step split (transcribe, then evaluate) lets you fix handwriting
mis-reads before scoring. The Gemini API key lives only on the server — it is
never exposed to the browser.

## Models & cost

- Transcription + question extraction: `gemini-3.1-flash-lite` (cheap, high
  quota) — set in `lib/gemini.ts`.
- Evaluation: `gemini-3.1-pro-preview` — **paid**. Spend is hard-capped by an
  atomic credit counter in Supabase (`data/eval-budget.sql`: total budget +
  per-day limit), with refund-on-failure, plus a GCP billing-cutoff Cloud
  Function (`infra/billing-cap-fn`).
- In local dev, AI calls can route through the `claude` CLI instead
  (`lib/llm.ts` provider switch).

## What the evaluation checks

- Core demand of the question (met / partial / not) and the question's own
  expected points (hit / partial / missed).
- Directive compliance ("critically examine", "to what extent"…) against fixed
  rubrics (`lib/directives.ts`).
- Value-additions: 2–4 concrete, ready-to-use points/quotes for extra marks —
  the heart of the feedback.
- Structure vs topper benchmark: point count, intro/body/conclusion spatial
  split, word count vs the paper's word limits (`lib/structure.ts`).
- Diagrams (GS only): aptness + labelling, judged visually from the cropped
  drawing. PSIR is graded on thinkers/debates, so no diagram-pushing there.
- PSIR answers are judged on PSIR-specific dimensions (thinker command, debate
  coverage, quotes, Indian/contemporary bridge — `lib/criteria.ts`) with the
  PSIR playbook + syllabus (`lib/knowledge-base.ts`, `lib/syllabus.ts`).

## Setup

```bash
npm install
cp .env.local.example .env.local   # add GEMINI_API_KEY
npm run dev
```

Open http://localhost:3000.

## Knowledge base

- **Syllabus:** `lib/syllabus.ts` (GS1 + PSIR Paper I/II, official wording).
- **Playbooks:** `lib/knowledge-base.ts` — topper playbook (GS), essay lens,
  PSIR lens (thinkers/schools/debates), distilled from real topper copies.
- **Topic templates:** `lib/topic-templates.ts` — per-syllabus-area dimension
  guidance (GS1's 13 areas + PSIR Paper 1/2 sections).
- **Topper exemplars:** drop `.txt`/`.md` files into `data/exemplars/`, tagged
  `mode:`/`subject:` (see that folder's README). Retrieved by topic overlap and
  injected as "what good looks like" anchors.

## Calibration

`npx tsx scripts/calibrate.ts` runs the real evaluation prompt over fixtures in
`data/calibration/` with known expected score bands (strong topper-grade answer
→ high; deliberately weak answer → low) and reports drift. Run it after any
prompt/knowledge-base change. Note: with the Gemini provider this spends real
evaluation calls.

## Deploy

- **Vercel:** push to GitHub, import repo, set `GEMINI_API_KEY` (+ Supabase env
  vars) in Project Settings. Hosts the UI, transcription, and question
  extraction.
- **Cloud Run (`infra/eval-run`):** hosts the evaluation endpoint (the pro-model
  call can take minutes, past Vercel's 60s cap). Set `NEXT_PUBLIC_EVAL_URL` to
  its base URL. See `infra/eval-run/DEPLOY.md`.
- **Supabase:** run `data/supabase-schema.sql` + `data/eval-budget.sql`. Google
  OAuth sign-in with an email allowlist; history + mistake bank per user via RLS.

## Project layout

| Path | Purpose |
|---|---|
| `app/page.tsx` | Upload / transcript / results UI |
| `app/api/transcribe/route.ts` | Page image → structured transcript (Gemini vision) |
| `app/api/extract-questions/route.ts` | Question-paper PDF → question list |
| `app/api/evaluate/route.ts` | Eval route (local dev; production uses Cloud Run) |
| `infra/eval-run/` | Cloud Run eval service (300s timeout, credit refund on fail) |
| `lib/criteria.ts` | GS + PSIR dimensions, Zod schemas for transcript/evaluation |
| `lib/prompts.ts` | System/user prompt builders |
| `lib/knowledge-base.ts` | Topper playbook + essay & PSIR lenses |
| `lib/structure.ts` | Structure benchmark, word counts, word limits |
| `lib/mistakes.ts` | Cross-test mistake bank (clustered recurring weaknesses) |
| `lib/eval-budget.ts` | Hard spend cap (Supabase RPC) |

## Roadmap

- Value-addition bank (aggregate suggested quotes/thinkers across tests, like
  the mistake bank).
- Syllabus coverage tracker (which PSIR areas practised, avg score per area).
- Model answer on demand per question.
- Re-attempt loop with score comparison.
- Embedding-based exemplar retrieval when the corpus grows.
