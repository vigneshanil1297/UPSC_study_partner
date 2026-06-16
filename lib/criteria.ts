import { z } from "zod";

// Which paper is being evaluated. Drives which lens the prompt applies:
// "essay" = flowing-prose Essay paper (essay lens overrides diagram/bullet
// guidance); "gs" = GS analytical answer (full topper playbook, diagrams and
// headings are strengths).
export type EvalMode = "essay" | "gs";

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
