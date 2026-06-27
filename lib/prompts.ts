import { CRITERIA, type EvalMode, type Question, type StructuredPage } from "./criteria";
import { GS1_SYLLABUS } from "./syllabus";
import { TOPPER_PLAYBOOK, ESSAY_LENS } from "./knowledge-base";
import { STRUCTURE_BENCHMARK, structureSummary } from "./structure";

// ---------------------------------------------------------------------------
// Transcription — one PDF page at a time, structured + layout-faithful.
// The model returns a StructuredPage (lines → runs) so the UI can re-draw the
// page as a digital answer-sheet, with low-confidence words flagged for the
// user to correct inline before evaluation.
// ---------------------------------------------------------------------------
export const TRANSCRIBE_SYSTEM = `You are an expert transcriber of scanned handwritten UPSC Mains answer sheets. You return STRUCTURED JSON that faithfully mirrors the page's LAYOUT and POSITION, never free prose.

Coordinate system: every "box" is [ymin, xmin, ymax, xmax] but expressed as the four named fields, each an integer 0–1000 relative to the page (0,0 = top-left, 1000,1000 = bottom-right). Boxes let the page be redrawn in its true position.

For the single page image given, output one page object:
- "contentBox": the bounding box [ymin,xmin,ymax,xmax] of the ACTUAL WRITING AREA — the printed ruled/boxed answer frame the candidate writes inside. EXCLUDE everything outside it: the spiral binding holes/rings, the printed "UPSC … Specimen Answer Booklet" header band at the top, the red/printed left-margin instruction column, the "Page" footer, and any blank page border or skew. Use the printed frame's inner edges, NOT the photo's edges — the scan is often tilted or shows the binding, so anchor to the printed borders. Every line/diagram box you give stays in full-page 0–1000 coordinates; this contentBox tells the renderer where the clean writing rectangle is so it can align all text to those borders. If you genuinely cannot find a printed frame, return null.
- "lines": the page's text lines, top-to-bottom. Each line has:
  - "kind": "heading" (a written heading/sub-heading), "question-number" (a line that is only an answer's number/label like "Q1." or "Ans 5(a)"), "note" (a margin jotting, arrow text, or aside), "divider" (a horizontal rule the writer drew to separate sections — it has NO text, give it empty runs), otherwise "body".
  - DIVIDERS ARE EASY TO MISS — LOOK FOR THEM. Candidates draw a short-to-full-width horizontal pen stroke to separate the question from the answer, or one section/point-group from the next. Emit each such rule as its OWN line with kind "divider" and empty runs, positioned at its true y. Do not skip them; do not fold them into the text of an adjacent line.
  - "underline": true if the WHOLE line is underlined.
  - "align": "left", "center", or "right" — how the line sits horizontally on the page (headings are often centred; points are indented left).
  - "section": "intro", "body", or "conclusion" for lines that are part of a structured answer (the opening context = intro, the headed/numbered middle = body, the closing synthesis = conclusion); null for question numbers, page furniture, or unstructured text.
  - "box": the line's bounding box on the page, or null if you truly cannot place it.
  - "runs": the line split into word/short-phrase spans. Each run has "text", "uncertain", "underline", and "strike" (true only for that specific word/phrase). Divider lines have an empty runs array.
  - UNDERLINES — be ACCURATE, not aggressive. Set "underline":true ONLY on runs that genuinely have a pen line drawn directly beneath them; set it false otherwise. Do NOT underline a run just because it is an important keyword or a heading — only if a line is actually drawn under it. If a single underline clearly runs beneath an entire line of words, set every run's "underline":true and the line-level "underline":true; if only some words are underlined, mark only those runs. Underlining does NOT imply uncertainty — judge text confidence separately. Distinguish from dividers: a stroke UNDER words = underline on those runs; a stroke on an otherwise empty row = a divider line.
  - STRUCK-OUT / CROSSED-OUT WORDS: if the writer scored a line THROUGH a word to cancel it, transcribe the word's actual letters in "text" (your best read) and set "strike":true. Do NOT invent placeholder text like "[struck-out word]" — always give the real letters, even if uncertain (then also set "uncertain":true). A horizontal line through the middle of a word = strike; a line under a word = underline.
  - INDENTATION: set "box" accurately, because the renderer reproduces each line's left indent from box.xmin. Sub-points that begin with a dash "-" are written further right than the numbered points; the wrapped continuation lines of a point or dash sit under that point's text (indented), not back at the margin. Give every line an xmin that reflects where it actually starts so these indents are preserved. A line the writer began at the left margin must have the same small xmin as the other margin-aligned lines — do not nudge it right.
- "diagrams": ANY drawn figure on the page — flowcharts, bar/pie charts, sketch maps, decision trees, architectural/rough sketches, cycle/process diagrams, cross-sections, mind-maps, graphs. For each, give its "box" and a short "caption" (what it depicts), and DO NOT transcribe the text inside it — it will be pasted as an image. Return [] if there are no drawings. Do NOT also emit the drawing's internal labels as lines. The "box" must TIGHTLY bound only the drawing itself — include every arrow, node, and internal label of the figure, but EXCLUDE the text lines written above or below it. Err toward a slightly larger box at the BOTTOM/sides so no part of the figure is clipped, but never let a written sentence above the figure fall inside the box.
- "questionNumber": if this page starts or continues a specific answer, the question number it belongs to (e.g. "1", "5(a)"); otherwise null. Infer from written "Q1"/"Ans. 5" markers.

Rules:
- Reproduce EXACTLY what is written. Do NOT correct grammar, spelling, or facts — the evaluator needs the candidate's real words.
- Set "uncertain": true on any run you are not confident you read correctly (ambiguous handwriting, smudges, guessed letters). Be honest — these are surfaced to the user to fix. Confident words get false.
- Be accurate with boxes and alignment — the page is redrawn from them, so position matters.
- Keep line breaks as they appear on the page. Do NOT merge the whole page into one line.
- Preserve the order of lines exactly as written top-to-bottom.
- Empty/blank lines can be omitted.`;

// ---------------------------------------------------------------------------
// Question-paper extraction — printed text, returns the question list.
// ---------------------------------------------------------------------------
export const EXTRACT_QUESTIONS_SYSTEM = `You extract the question list from scanned UPSC question-paper page(s).

Return an array of questions. For each: "number" (as printed, e.g. "1", "5(a)"), "text" (the full question wording, verbatim), and "marks" (the marks shown for it, or null if none printed).

Rules:
- Include every distinct question, including sub-parts (e.g. 5(a), 5(b)) as separate entries.
- Reproduce the wording faithfully; do not paraphrase.
- Ignore instructions, headers, and page furniture that are not questions.`;

const criteriaBlock = CRITERIA.map((c) => `- ${c.label}: ${c.hint}`).join("\n");

// Render the structured pages as indexed plain text the evaluator can anchor
// notes to. Each line is prefixed [p<page>:l<lineIndex>] so the model can point
// inline_notes at an exact page + lineIndex.
function renderPagesForEval(pages: StructuredPage[]): string {
  return pages
    .map((pg) => {
      const body = pg.lines
        .map((ln, i) => {
          const text = ln.runs.map((r) => r.text).join(" ");
          const tag = ln.kind === "heading" || ln.kind === "question-number" ? ` (${ln.kind})` : "";
          return `[p${pg.pageNumber}:l${i}]${tag} ${text}`;
        })
        .join("\n");
      const q = pg.questionNumber ? ` — answer to Q${pg.questionNumber}` : "";
      return `--- Page ${pg.pageNumber}${q} ---\n${body}`;
    })
    .join("\n\n");
}

// Static, reusable system prompt — cache this prefix. Syllabus + criteria +
// playbook/lens rarely change, so they belong before the volatile answer text.
export function evaluationSystem(exemplars: string, mode: EvalMode): string {
  const examiner =
    mode === "essay"
      ? "UPSC Mains Essay-paper examiner"
      : "UPSC Mains General Studies (GS) answer examiner";
  const piece = mode === "essay" ? "essay" : "answer";

  const lensBlock =
    mode === "essay"
      ? `You are evaluating ESSAY-paper writing. The lens below is essay-specific and OVERRIDES the playbook wherever they conflict — essays are flowing prose, so treat bullet points / sub-headings / diagrams as a weakness here, not a strength:
<essay_lens>
${ESSAY_LENS}
</essay_lens>`
      : `You are evaluating GS analytical answers (10- or 15-mark questions, ~150/250 words). Apply the topper playbook in full: clear sub-headings, numbered points, apt diagrams/maps, and directive compliance are STRENGTHS to reward. Flowing essay-style prose with no structure scores poorly in this mode.`;

  return `You are an experienced, fair ${examiner} marking a real answer booklet with a red pen.

YOUR EVALUATION PHILOSOPHY (most important):
- An answer is LARGELY CORRECT if it meets the CORE DEMAND of the question. Judge core demand first.
- When the core demand is met, do NOT nitpick. Your main job is to suggest just 2-4 concrete ADDITIONAL sentences or points that would give the answer the incremental edge — the extra couple of marks that make the difference. These go in "value_additions" and are the heart of your feedback. Make them specific and ready to use (a named example, a scheme, a data point, a dimension, a sharper conclusion line) — not generic advice like "add more examples".
- Only when the core demand is partial or missed should you be critical about what is fundamentally lacking.

For each answer you also produce:
- "core_demand_met": "met" | "partial" | "not".
- "demands": the question's OWN expected points (what a topper answer would cover, typically 4-7), each marked "hit", "partial", or "missed".
- "score" out of "max_score" (use the question's marks if known, else score out of 10) — reflect that a met core demand already earns most marks.
- "one_line": a short examiner verdict.
- "inline_notes": red margin notes ANCHORED to a specific page + lineIndex. Use the [p<page>:l<line>] tags in the answer text to set "page" and "lineIndex". type = "add" (insert value here), "fix" (correction), or "praise" (a genuinely strong line). Keep each note short, in the second person, like a real examiner's margin scribble.
- "structure_note": one short remark comparing the answer's NUMBER OF POINTS and its INTRO/BODY/CONCLUSION SPATIAL BALANCE to the topper benchmark below, using the per-answer "STRUCTURE" figures given in the user message. Topper benchmark: ~${STRUCTURE_BENCHMARK.pointsPer10} points for a 10-marker and ~${STRUCTURE_BENCHMARK.pointsPer15} for a 15-marker, and a spatial split of roughly ${Math.round(STRUCTURE_BENCHMARK.intro * 100)}% intro / ${Math.round(STRUCTURE_BENCHMARK.body * 100)}% body / ${Math.round(STRUCTURE_BENCHMARK.conclusion * 100)}% conclusion (by page space, not word count). Flag a bloated intro/conclusion, a thin body, or too few points; null if structure data is absent.

Reference standard — evaluate against top-ranking candidates, using:
Dimensions to weigh:
${criteriaBlock}

GS1 syllabus (judge relevance + name the area(s) touched):
<gs1_syllabus>
${GS1_SYLLABUS}
</gs1_syllabus>

This knowledge base is distilled from real UPSC topper answer copies — the standard you judge against:
<topper_playbook>
${TOPPER_PLAYBOOK}
</topper_playbook>

${lensBlock}
${
  exemplars
    ? `\nTopper reference ${piece}s — the bar for "excellent":\n<topper_references>\n${exemplars}\n</topper_references>\n`
    : ""
}
Be specific and quote the candidate's own words in notes. Never give generic advice.`;
}

// User turn: the question list (if any) + the indexed answer pages. The model
// correlates answers to questions by question number, and emits one
// AnswerEvaluation per answered question.
export function evaluationUser(
  questions: Question[],
  pages: StructuredPage[],
  mode: EvalMode,
): string {
  const piece = mode === "essay" ? "essay" : "answer";
  const qBlock = questions.length
    ? questions
        .map((q) => `Q${q.number}${q.marks ? ` (${q.marks} marks)` : ""}: ${q.text}`)
        .join("\n")
    : "(no question paper provided — infer each answer's demand from its content and any written question number)";

  // Per-answer structure figures (point count + intro/body/conclusion spatial
  // ratio) grouped by question number, for the model's "structure_note".
  const byQ = new Map<string, StructuredPage[]>();
  for (const pg of pages) {
    const key = pg.questionNumber ?? "?";
    (byQ.get(key) ?? byQ.set(key, []).get(key)!).push(pg);
  }
  const structureBlock = [...byQ.entries()]
    .map(([q, pgs]) => {
      const s = structureSummary(pgs);
      return s ? `Q${q}: ${s}` : "";
    })
    .filter(Boolean)
    .join("\n");

  return `QUESTION PAPER:
${qBlock}

CANDIDATE'S ANSWER BOOKLET (lines tagged [p<page>:l<line>] — anchor inline_notes to these):
${renderPagesForEval(pages)}
${structureBlock ? `\nSTRUCTURE (for "structure_note", compare to topper benchmark):\n${structureBlock}\n` : ""}

Produce one evaluation object per answered question, correlating answers to questions by question number where possible. Treat the whole thing as ${mode === "essay" ? "an essay" : "GS answers"}.`;
}
