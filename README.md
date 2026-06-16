# UPSC Mains Essay Evaluator

Browser tool to parse handwritten essay answers (from uploaded images) and get
critical, criterion-wise feedback against the GS1 syllabus and topper exemplars.
Built with Next.js + Google Gemini (free tier), deploys to Vercel.

## How it works

```
Upload page images → Gemini vision transcribes handwriting → you review/edit
→ Gemini evaluates the text → structured per-criterion feedback (scores +
critique + improvements)
```

The two-step split (transcribe, then evaluate) lets you fix handwriting
mis-reads before scoring. The Gemini API key lives only in server routes
(`app/api/*`) — it is never exposed to the browser.

**Cost:** uses Gemini's free tier (`gemini-2.5-flash`). A free key from
[aistudio.google.com/apikey](https://aistudio.google.com/apikey) needs **no
billing**. Free-tier rate limits are generous for one person's study use; if you
hit them, requests are throttled, not charged.

## Evaluation dimensions

Factual accuracy · relevance · coherence · anecdotes/quotes/data · structure ·
conclusion quality · multidimensional coverage · language · balance · argument
flow — each scored 1–10 with evidence, critique, and a concrete fix, plus an
overall /100 verdict. Defined in `lib/criteria.ts`.

## Setup

```bash
npm install
cp .env.local.example .env.local   # add your free GEMINI_API_KEY
npm run dev
```

Open http://localhost:3000.

## Knowledge base

- **Syllabus:** `lib/syllabus.ts` (plain text, injected into the prompt).
- **Topper exemplars:** drop `.txt`/`.md` files into `data/exemplars/`. They are
  injected as "what good looks like" anchors. See that folder's README. Outgrow
  the prompt budget → switch to embedding retrieval.

## Deploy (Vercel)

1. Push to GitHub.
2. Import the repo in Vercel.
3. Set `GEMINI_API_KEY` in Project → Settings → Environment Variables.
4. Deploy.

## Project layout

| Path | Purpose |
|---|---|
| `app/page.tsx` | Upload / transcript / results UI |
| `app/api/transcribe/route.ts` | Image → text (Gemini vision) |
| `app/api/evaluate/route.ts` | Text → structured evaluation (Gemini JSON mode) |
| `lib/criteria.ts` | Criteria + Zod schema (validates model output) |
| `lib/prompts.ts` | System/user prompt builders |
| `lib/syllabus.ts` | GS1 syllabus reference |
| `lib/exemplars.ts` | Loads topper reference essays |
| `lib/gemini.ts` | Server-only Gemini client + model id |

## Notes

- Evaluation uses Gemini structured-output (`responseSchema`); the JSON is then
  re-validated against the Zod schema in `lib/criteria.ts` before display.
- Model is set in `lib/gemini.ts` (`MODEL`). Swap to another Gemini model there
  if you want a different quality/quota tradeoff.

## Roadmap

- Saved history of evaluations (Vercel Postgres / Supabase).
- Embedding-based exemplar retrieval when the corpus grows.
- Topic-aware exemplar selection.
- Other GS papers / answer-writing (not just essays).
