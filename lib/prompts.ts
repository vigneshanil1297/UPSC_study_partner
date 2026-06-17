import { CRITERIA, type EvalMode, type Question, type StructuredPage } from "./criteria";
import { GS1_SYLLABUS } from "./syllabus";
import { TOPPER_PLAYBOOK, ESSAY_LENS } from "./knowledge-base";

// ---------------------------------------------------------------------------
// Transcription — one PDF page at a time, structured + layout-faithful.
// The model returns a StructuredPage (lines → runs) so the UI can re-draw the
// page as a digital answer-sheet, with low-confidence words flagged for the
// user to correct inline before evaluation.
// ---------------------------------------------------------------------------
export const TRANSCRIBE_SYSTEM = `You are an expert transcriber of scanned handwritten UPSC Mains answer sheets. You return STRUCTURED JSON that faithfully mirrors the page's layout, never free prose.

For the single page image given, output one page object:
- "lines": the page's lines in top-to-bottom order. Each line has:
  - "kind": one of "heading" (a written heading/sub-heading), "question-number" (a line that is just an answer's question number/label like "Q1." or "Ans 5(a)"), "note" (a margin jotting, arrow text, or aside), otherwise "body".
  - "underline": true if the writer underlined that line (toppers underline keywords/headings).
  - "runs": the line split into word/short-phrase spans. Each run has "text" and "uncertain".
- "questionNumber": if this page starts or continues a specific answer, the question number it belongs to (e.g. "1", "5(a)"); otherwise null. Infer from written "Q1"/"Ans. 5" markers.

Rules:
- Reproduce EXACTLY what is written. Do NOT correct grammar, spelling, or facts — the evaluator needs the candidate's real words.
- Set "uncertain": true on any run you are not confident you read correctly (ambiguous handwriting, smudges, guessed letters). Be honest — these are surfaced to the user to fix. Confident words get false.
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

  return `QUESTION PAPER:
${qBlock}

CANDIDATE'S ANSWER BOOKLET (lines tagged [p<page>:l<line>] — anchor inline_notes to these):
${renderPagesForEval(pages)}

Produce one evaluation object per answered question, correlating answers to questions by question number where possible. Treat the whole thing as ${mode === "essay" ? "an essay" : "GS answers"}.`;
}
