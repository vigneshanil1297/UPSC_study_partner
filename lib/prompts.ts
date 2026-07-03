import { criteriaFor, isPsir, type EvalMode, type Question, type StructuredPage, type Subject } from "./criteria";
import { GS1_SYLLABUS, PSIR_PAPER1_SYLLABUS, PSIR_PAPER2_SYLLABUS } from "./syllabus";
import { TOPPER_PLAYBOOK, ESSAY_LENS, PSIR_PLAYBOOK } from "./knowledge-base";
import { benchmarkFor, structureSummary } from "./structure";
import { directiveNote } from "./directives";
import { topicGuidance } from "./topic-templates";

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
export function evaluationSystem(exemplars: string, mode: EvalMode, subject: Subject = "gs1"): string {
  const psir = isPsir(subject);
  const examiner = psir
    ? "UPSC Mains Political Science & International Relations (PSIR optional) examiner"
    : mode === "essay"
      ? "UPSC Mains Essay-paper examiner"
      : "UPSC Mains General Studies (GS) answer examiner";
  const piece = mode === "essay" && !psir ? "essay" : "answer";

  // Syllabus block: the right paper's official wording.
  const syllabusLabel = psir
    ? subject === "psir1"
      ? "PSIR Paper I syllabus"
      : "PSIR Paper II syllabus"
    : "GS1 syllabus";
  const syllabusText = psir
    ? subject === "psir1"
      ? PSIR_PAPER1_SYLLABUS
      : PSIR_PAPER2_SYLLABUS
    : GS1_SYLLABUS;

  const lensBlock = psir
    ? `You are evaluating PSIR (optional-paper) analytical answers (10/15/20-mark questions). Apply the topper playbook's presentation guidance in full — clear sub-headings, numbered points, underlining of key terms/thinkers, and directive compliance are STRENGTHS to reward; flowing essay-style prose with no structure scores poorly. CRUCIALLY, also apply the PSIR lens below: this is an OPTIONAL paper graded on command of THINKERS, THEORETICAL DEBATES and SCHOOLS, not on schemes/data/diagrams:
<psir_lens>
${PSIR_PLAYBOOK}
</psir_lens>`
    : mode === "essay"
      ? `You are evaluating ESSAY-paper writing. The lens below is essay-specific and OVERRIDES the playbook wherever they conflict — essays are flowing prose, so treat bullet points / sub-headings / diagrams as a weakness here, not a strength:
<essay_lens>
${ESSAY_LENS}
</essay_lens>`
      : `You are evaluating GS analytical answers (10- or 15-mark questions, ~150/250 words). Apply the topper playbook in full: clear sub-headings, numbered points, apt diagrams/maps, and directive compliance are STRENGTHS to reward. Flowing essay-style prose with no structure scores poorly in this mode.`;

  const criteriaBlock = criteriaFor(subject)
    .map((c) => `- ${c.label}: ${c.hint}`)
    .join("\n");
  const bench = benchmarkFor(psir);

  return `You are an experienced, fair ${examiner} marking a real answer booklet with a red pen.

YOUR EVALUATION PHILOSOPHY (most important):
- An answer is LARGELY CORRECT if it meets the CORE DEMAND of the question. Judge core demand first.
- When the core demand is met, do NOT nitpick. Your main job is to suggest just 2-4 concrete ADDITIONAL sentences or points that would give the answer the incremental edge — the extra couple of marks that make the difference. These go in "value_additions" and are the heart of your feedback. Make them specific and ready to use (${psir ? "a missing thinker + their quote, the counter-school skipped, an Indian/contemporary bridge, a sharper synthesising line" : "a named example, a scheme, a data point, a dimension, a sharper conclusion line"}) — not generic advice like "add more examples".
- Only when the core demand is partial or missed should you be critical about what is fundamentally lacking.

SCORE ANCHORING — award marks the way UPSC actually marks, not like a lenient tutor:
- ~35-40% of max = weak (off-demand, generic, ${psir ? "thinker-free" : "example-free"}).
- ~45-50% = average (core demand partly met, some substance, little value-addition).
- ~55-60% = good (core demand met with specifics — this is already a competitive answer).
- ~65-70% = topper-grade, rare (complete demand coverage + dense value-addition).
- Above 70% is exceptional and almost never awarded in ${psir ? "an optional" : "GS"} marking.
Concretely for a 20-marker: 8 = weak, 10 = average, 12-13 = very good, 14+ = exceptional. For a 15-marker: 6 / 7-8 / 9-10 / 11+. For a 10-marker: 4 / 5 / 6-7 / 7.5+. Do NOT compress everything into the 60-75% band; use the full scale so scores are comparable across tests.

For each answer you also produce:
- "core_demand_met": "met" | "partial" | "not".
- "demands": the question's OWN expected points (what a topper answer would cover, typically 4-7), each marked "hit", "partial", or "missed".
- "score" out of "max_score" (use the question's marks if known, else score out of 10) — reflect that a met core demand already earns most marks.
- "one_line": a short examiner verdict.
- "inline_notes": red margin notes ANCHORED to a specific page + lineIndex. Use the [p<page>:l<line>] tags in the answer text to set "page" and "lineIndex". type = "add" (insert value here), "fix" (correction), or "praise" (a genuinely strong line). Keep each note short, in the second person, like a real examiner's margin scribble.
- "structure_note": one short remark comparing the answer's NUMBER OF POINTS, WORD COUNT vs the question's word limit (${psir ? "150/200/250 words for a 10/15/20-marker" : "150 words for a 10-marker, 250 for a 15-marker"} — flag a significant overshoot or a thin undershoot), and its INTRO/BODY/CONCLUSION SPATIAL BALANCE to the topper benchmark, using the per-answer "STRUCTURE" figures given in the user message. Topper benchmark: ~${bench.pointsPer10} points for a 10-marker, ~${bench.pointsPer15} for a 15-marker, ~${bench.pointsPer20} for a 20-marker, and a spatial split of roughly ${Math.round(bench.intro * 100)}% intro / ${Math.round(bench.body * 100)}% body / ${Math.round(bench.conclusion * 100)}% conclusion (by page space, not word count). Flag a bloated intro/conclusion, a thin body, or too few points; null if structure data is absent.
- "diagram_note": ${
    psir
      ? `PSIR is graded on thinkers and debates, NOT on diagrams — NEVER advise adding a diagram or penalise its absence. If the candidate drew one, briefly judge whether it genuinely aids the argument (a clean school-comparison table can); otherwise set null.`
      : `one short examiner remark on this answer's DIAGRAM(S). If diagram image(s) for this answer are supplied (see the "CANDIDATE'S DIAGRAMS" manifest — each image is attributed to a question number), LOOK AT THEM and judge: is the figure APT for the demand, is it correctly LABELLED, does it actually add analytical value, or is it decorative/wrong? Reward an apt, labelled diagram. If NO diagram was drawn but one would have markedly helped (a sketch map to locate examples, a cross-section/process figure, a cycle/flow or mind-map — per the playbook), say so and name the diagram that was warranted. Set null only when diagrams are neither present nor expected for this question.`
  }

Reference standard — evaluate against top-ranking candidates, using:
Dimensions to weigh:
${criteriaBlock}

${syllabusLabel} (judge relevance + name the area(s) touched):
<syllabus>
${syllabusText}
</syllabus>

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
  subject: Subject = "gs1",
): string {
  const piece = mode === "essay" && !isPsir(subject) ? "essay" : "answer";
  // Each question carries its DIRECTIVE rubric inline (reusable across unseen
  // wordings — directives recur even though questions don't), so the model
  // checks directive compliance against an explicit checklist.
  const qBlock = questions.length
    ? questions
        .map((q) => {
          const dir = mode === "essay" && !isPsir(subject) ? "" : directiveNote(q.text);
          return `Q${q.number}${q.marks ? ` (${q.marks} marks)` : ""}: ${q.text}${dir ? `\n  ${dir}` : ""}`;
        })
        .join("\n")
    : "(no question paper provided — infer each answer's demand from its content and any written question number)";

  // Topic-level dimension guidance, matched on the combined question text. Soft
  // guidance on the canonical angles a strong answer to this theme covers. Only
  // for analytical (non-essay) papers; essays are judged on flow, not coverage.
  const topicBlock =
    mode === "essay" && !isPsir(subject)
      ? ""
      : topicGuidance(questions.map((q) => q.text).join(" "), subject);

  // Per-answer structure figures (point count + intro/body/conclusion spatial
  // ratio) grouped by question number, for the model's "structure_note".
  const byQ = new Map<string, StructuredPage[]>();
  for (const pg of pages) {
    const key = pg.questionNumber ?? "?";
    (byQ.get(key) ?? byQ.set(key, []).get(key)!).push(pg);
  }
  const structureBlock = [...byQ.entries()]
    .map(([q, pgs]) => {
      const s = structureSummary(pgs, isPsir(subject));
      return s ? `Q${q}: ${s}` : "";
    })
    .filter(Boolean)
    .join("\n");

  return `QUESTION PAPER:
${qBlock}
${topicBlock ? `\n${topicBlock}\n` : ""}
CANDIDATE'S ANSWER BOOKLET (lines tagged [p<page>:l<line>] — anchor inline_notes to these):
${renderPagesForEval(pages)}
${structureBlock ? `\nSTRUCTURE (for "structure_note", compare to topper benchmark):\n${structureBlock}\n` : ""}

Produce one evaluation object per answered question, correlating answers to questions by question number where possible. Treat the whole thing as ${
    isPsir(subject)
      ? `PSIR optional-paper answers (${subject === "psir1" ? "Paper I" : "Paper II"})`
      : mode === "essay"
        ? "an essay"
        : "GS answers"
  }.`;
}
