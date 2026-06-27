# Calibration fixtures

These measure whether the evaluator's scores are *correct*, not just
reproducible. Each fixture is an answer with a **known expected score band**; the
harness runs the real eval prompt and reports how far the model lands from the
band.

Run from the project root:

```
npx tsx scripts/calibrate.ts
```

Output: per-fixture ✓/✗ (in band?), the model's score, and a summary line —
`N/total in band` + mean absolute error vs the band midpoint. Uses the same LLM
backend as the app (local `claude` CLI by default; Gemini if `GEMINI_API_KEY` /
`LLM_PROVIDER=gemini`).

## Fixture format (`*.json`)

```jsonc
{
  "label": "short name (expect high/low)",
  "subject": "gs1" | "psir1" | "psir2",
  "mode": "gs" | "essay",
  "expected": { "minPercent": 65, "maxPercent": 90 }, // score band as % of max
  "note": "why this band",
  "questions": [{ "number": "1", "text": "…", "marks": 10 }],
  "answers": [{ "questionNumber": "1", "text": "multi-line answer text…" }]
}
```

The harness synthesizes a minimal transcript from `answers[].text` (one page per
answer, one line per text line), so you write plain text — no bounding boxes.
Spatial `structure_note` is therefore weak here; this harness calibrates
**content** scoring (demands, directive compliance, value-add), which is what
matters for marks.

## Growing the set

Add fixtures spanning the score range and the syllabus. The most valuable are
real answers with a **known real mark** (a graded test-series copy, a topper
answer ≈ top band, an average copy ≈ mid band). Seeds here:

- `strong-gs1-women-shg.json` — topper-grade, expect 65–90%.
- `weak-gs1-women-shg.json` — vague/example-free, expect 8–35%.

Keep calibration questions OUT of `data/exemplars/` (or use distinct topics) so a
fixture answer isn't retrieved as its own topper reference, which would inflate
its score.
