import { z } from "zod";

// Which paper is being evaluated. Drives which lens the prompt applies:
// "essay" = flowing-prose Essay paper (essay lens overrides diagram/bullet
// guidance); "gs" = GS analytical answer (full topper playbook, diagrams and
// headings are strengths).
export type EvalMode = "essay" | "gs";

// Which paper's syllabus + knowledge base to judge against. "gs1" = General
// Studies Paper I (essay or gs mode). "psir1"/"psir2" = the Political Science &
// International Relations OPTIONAL papers — always analytical (gs-style), judged
// against the PSIR syllabus + PSIR playbook on top of the topper playbook.
export type Subject = "gs1" | "psir1" | "psir2";

export const SUBJECTS: { key: Subject; label: string }[] = [
  { key: "gs1", label: "GS Paper I" },
  { key: "psir1", label: "PSIR Paper 1" },
  { key: "psir2", label: "PSIR Paper 2" },
];

export const isPsir = (s: Subject): boolean => s === "psir1" || s === "psir2";

// The evaluation dimensions for a UPSC Mains essay. Keep names + descriptions
// here in one place — they drive both the prompt and the output schema.
export const CRITERIA = [
  { key: "factual_accuracy", label: "Factual Accuracy", hint: "Are facts, dates, names, schemes, and data points correct? Flag any that look wrong or fabricated." },
  { key: "relevance", label: "Relevance to Topic", hint: "Does the essay stay on the demanded theme, or drift into adjacent but unasked areas?" },
  { key: "coherence", label: "Coherence", hint: "Do paragraphs connect logically? Are transitions smooth?" },
  { key: "evidence", label: "Anecdotes / Quotes / Data", hint: "Quality and aptness of examples, quotes, case studies, and statistics used as evidence." },
  { key: "structure", label: "Structure", hint: "Introduction hook, body organisation, paragraph balance, overall architecture." },
  { key: "conclusion", label: "Conclusion Quality", hint: "Does it synthesise rather than summarise? Forward-looking, balanced close?" },
  { key: "multidimensional", label: "Multidimensional Coverage", hint: "Coverage across dimensions (social, economic, political, ethical, environmental, historical, international)." },
  { key: "language", label: "Language & Expression", hint: "Clarity, vocabulary, grammar, sentence variety, tone appropriate for the essay paper." },
  { key: "balance", label: "Balance", hint: "Are multiple viewpoints fairly represented, or is it one-sided?" },
  { key: "argument_flow", label: "Argument Flow", hint: "Does the central argument build progressively toward the conclusion?" },
] as const;

export type CriterionKey = (typeof CRITERIA)[number]["key"];

const criterionResult = z.object({
  score: z.number().describe("Score from 1 (poor) to 10 (excellent)."),
  evidence: z.string().describe("A short direct quote from the essay supporting this assessment, or '' if none."),
  critique: z.string().describe("Critical, specific feedback — what is weak and why."),
  improvement: z.string().describe("One concrete, actionable way to improve on this dimension."),
});

// Build the schema object dynamically from CRITERIA so the two never drift.
const criteriaShape = Object.fromEntries(
  CRITERIA.map((c) => [c.key, criterionResult]),
) as Record<CriterionKey, typeof criterionResult>;

export const EvaluationSchema = z.object({
  overall_score: z.number().describe("Holistic score from 1 to 100."),
  one_line_verdict: z.string().describe("A single blunt sentence summarising the essay's standing."),
  criteria: z.object(criteriaShape),
  top_strengths: z.array(z.string()).describe("2-3 genuine strengths."),
  top_priorities: z.array(z.string()).describe("2-3 highest-impact fixes, most important first."),
});

export type Evaluation = z.infer<typeof EvaluationSchema>;

// ---------------------------------------------------------------------------
// Structured transcript model (layout-faithful answer-sheet rendering).
// A page is a list of lines; a line is a list of runs (word/phrase spans).
// `uncertain` runs are the OCR's low-confidence reads — highlighted on the page
// and editable inline by the user before evaluation.
// ---------------------------------------------------------------------------

// Bounding box in Gemini's native normalised convention: each value 0–1000,
// [ymin, xmin, ymax, xmax] relative to the page's top-left. Used to redraw lines
// and diagrams in their true position rather than stacked left-aligned.
export const BoxSchema = z.object({
  ymin: z.number(),
  xmin: z.number(),
  ymax: z.number(),
  xmax: z.number(),
});
export type Box = z.infer<typeof BoxSchema>;

export const RunSchema = z.object({
  text: z.string(),
  uncertain: z.boolean().describe("True if the OCR was unsure of this word/phrase."),
  // Defaulted so transcripts saved before per-run underlining still parse.
  underline: z.boolean().default(false).describe("True if this specific word/phrase is underlined on the page."),
  // Defaulted so older transcripts still parse.
  strike: z.boolean().default(false).describe("True if this word/phrase is struck out / crossed out on the page."),
});
export type Run = z.infer<typeof RunSchema>;

export const LineSchema = z.object({
  kind: z
    .enum(["heading", "body", "question-number", "note", "divider"])
    .describe("Structural role of the line. 'divider' = a horizontal rule the writer drew across the page (no text)."),
  underline: z.boolean().describe("True if the whole line is underlined."),
  // The fields below are defaulted so older box-less transcripts still parse.
  align: z.enum(["left", "center", "right"]).default("left").describe("Horizontal alignment of the line on the page."),
  section: z
    .enum(["intro", "body", "conclusion"])
    .nullable()
    .default(null)
    .describe("Which part of the answer this line belongs to, or null if not part of a structured answer."),
  box: BoxSchema.nullable().default(null).describe("Position of the line on the page (0–1000), or null if unknown."),
  runs: z.array(RunSchema),
});
export type Line = z.infer<typeof LineSchema>;

// A drawn region (flowchart, graph, map, sketch, decision tree, etc.) that is
// pasted as an image rather than transcribed. `png` is filled in client-side
// after cropping the region out of the rendered page and masking the paper.
export const DiagramSchema = z.object({
  box: BoxSchema.describe("Position of the diagram on the page (0–1000)."),
  caption: z.string().nullable().describe("Short label of what the drawing depicts, if discernible."),
  png: z.string().optional().describe("Client-filled: base64 PNG data URL of the cropped, background-masked drawing."),
});
export type Diagram = z.infer<typeof DiagramSchema>;

export const StructuredPageSchema = z.object({
  pageNumber: z.number(),
  questionNumber: z
    .string()
    .nullable()
    .describe("The answer's question number if this page starts/continues one (e.g. '1', '5(a)'), else null."),
  aspect: z.number().optional().describe("Client-filled: page height / width, for faithful page proportions."),
  // The writing area inside the printed answer-sheet frame (excludes spiral
  // binding, the printed UPSC header band, the red left-margin furniture, and
  // page edges). All line/diagram boxes are remapped into this rectangle at
  // render time so text aligns to the sheet's borders regardless of camera
  // angle, skew, or visible binding. Null → boxes used as-is.
  contentBox: BoxSchema.nullable().default(null).describe("Bounding box (0–1000) of the writing area inside the printed answer-sheet frame, excluding binding, header, margin furniture, and page edges."),
  lines: z.array(LineSchema),
  // Defaulted so transcripts saved before diagram detection still parse.
  diagrams: z.array(DiagramSchema).default([]).describe("Drawn figures on the page, to paste as images."),
});
export type StructuredPage = z.infer<typeof StructuredPageSchema>;

export type Transcript = { pages: StructuredPage[] };

// A question lifted from the (optional) question-paper PDF.
export const QuestionSchema = z.object({
  number: z.string().describe("Question number as printed, e.g. '1', '5(a)'."),
  text: z.string(),
  marks: z.number().nullable().describe("Marks for the question if printed, else null."),
});
export type Question = z.infer<typeof QuestionSchema>;

// ---------------------------------------------------------------------------
// Evaluation model — value-add first (req 7). The examiner's red notes are
// anchored to a page + line so they render inline beside the relevant spot.
// ---------------------------------------------------------------------------

export const AnnotationSchema = z.object({
  page: z.number().describe("1-based page number the note refers to."),
  lineIndex: z.number().describe("0-based index of the line within that page."),
  type: z.enum(["add", "fix", "praise"]).describe("add = value to insert; fix = correction; praise = strong point."),
  text: z.string().describe("The examiner's note, written in the second person."),
});
export type Annotation = z.infer<typeof AnnotationSchema>;

export const DemandSchema = z.object({
  point: z.string().describe("One expected point/dimension the question demands."),
  status: z.enum(["hit", "partial", "missed"]),
});
export type Demand = z.infer<typeof DemandSchema>;

export const AnswerEvaluationSchema = z.object({
  questionNumber: z.string().nullable(),
  core_demand_met: z
    .enum(["met", "partial", "not"])
    .describe("Has the answer met the core demand of the question?"),
  score: z.number().describe("Marks awarded out of the question's max (or out of 10 if unknown)."),
  max_score: z.number().describe("Maximum marks for this question."),
  one_line: z.string().describe("One-line examiner verdict."),
  demands: z.array(DemandSchema).describe("The question's own expected points and whether the answer hit them."),
  value_additions: z
    .array(z.string())
    .describe("2-4 concrete extra sentences/points that would add incremental marks. The main output."),
  structure_note: z
    .string()
    .nullable()
    .describe("One examiner remark on how the answer's number of points and intro/body/conclusion spatial balance compares to the topper benchmark."),
  inline_notes: z.array(AnnotationSchema).describe("Red margin notes anchored to page+line."),
});
export type AnswerEvaluation = z.infer<typeof AnswerEvaluationSchema>;

export const EvalResultSchema = z.object({
  answers: z.array(AnswerEvaluationSchema),
});
export type EvalResult = z.infer<typeof EvalResultSchema>;
