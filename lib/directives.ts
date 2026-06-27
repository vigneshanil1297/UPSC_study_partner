// ---------------------------------------------------------------------------
// Directive-word rubrics.
//
// UPSC questions rarely repeat verbatim, but their DIRECTIVE word ("discuss",
// "critically examine", "to what extent"…) recurs every year and dictates the
// shape a complete answer must take. A fixed rubric per directive is therefore
// reusable across unseen questions and never goes stale. The evaluator injects
// the matched rubric so "did the answer obey the directive" is checked against
// an explicit, deterministic checklist rather than re-derived each call.
// ---------------------------------------------------------------------------

export type DirectiveRubric = {
  // The canonical directive name surfaced in the prompt.
  directive: string;
  // The elements a complete answer to this directive MUST contain.
  requires: string[];
};

// Ordered most-specific first: "critically examine" must win over "examine",
// "to what extent" over a bare verb, etc. First regex that hits wins.
const RUBRICS: { match: RegExp; rubric: DirectiveRubric }[] = [
  {
    match: /critically\s+(examine|analyse|analyze|evaluate|comment|discuss)/i,
    rubric: {
      directive: "Critically examine / evaluate",
      requires: [
        "investigate BOTH the merits/case-for AND the limitations/case-against, each with evidence",
        "deliver an explicit, defended judgement at the end — do NOT fence-sit",
      ],
    },
  },
  {
    match: /\b(to\s+what\s+extent|do\s+you\s+agree|how\s+far)\b/i,
    rubric: {
      directive: "To what extent / Do you agree",
      requires: [
        "take a clear position on the DEGREE of truth of the statement",
        "argue both the supporting and the qualifying side before settling how far you agree",
      ],
    },
  },
  {
    match: /\bevaluate\b/i,
    rubric: {
      directive: "Evaluate",
      requires: [
        "appraise effectiveness/worth by weighing merits against demerits",
        "reach a balanced overall assessment",
      ],
    },
  },
  {
    match: /\b(analyse|analyze)\b/i,
    rubric: {
      directive: "Analyse",
      requires: [
        "break the issue into its component parts",
        "show how the parts relate / treat each distinct position separately rather than describing in bulk",
      ],
    },
  },
  {
    match: /\bexamine\b/i,
    rubric: {
      directive: "Examine",
      requires: [
        "investigate in detail and establish the claim with evidence",
        "probe the underlying assumptions / qualify where it does not hold",
      ],
    },
  },
  {
    match: /\bdiscuss\b/i,
    rubric: {
      directive: "Discuss",
      requires: [
        "present MULTIPLE facets / viewpoints of the issue",
        "examine each rather than merely listing — deliberate towards a reasoned close",
      ],
    },
  },
  {
    match: /\bsubstantiate\b/i,
    rubric: {
      directive: "Substantiate",
      requires: [
        "support the given statement with concrete, specific evidence (named examples, data, cases)",
        "test whether the statement holds across cases",
      ],
    },
  },
  {
    match: /\b(elucidate|explain|clarify|bring\s+out)\b/i,
    rubric: {
      directive: "Elucidate / Explain",
      requires: [
        "make the concept/relationship clear with its mechanism or logic",
        "ground it with apt examples",
      ],
    },
  },
  {
    match: /\bcomment\b/i,
    rubric: {
      directive: "Comment",
      requires: [
        "form a reasoned opinion on the issue",
        "back the opinion briefly with evidence on both sides",
      ],
    },
  },
  {
    match: /\btrace\b/i,
    rubric: {
      directive: "Trace",
      requires: [
        "present the evolution/development stage by stage in order",
        "connect the stages causally rather than as a disjointed list",
      ],
    },
  },
  {
    match: /\b(account\s+for|why\s+(did|do|is|was|has))\b/i,
    rubric: {
      directive: "Account for / Why",
      requires: [
        "give the reasons/causes behind the phenomenon",
        "rank or relate the causes rather than listing flatly",
      ],
    },
  },
];

// Detect the directive a question uses and return its rubric, or null if none
// of the known directive words appear.
export function detectDirective(questionText: string): DirectiveRubric | null {
  for (const { match, rubric } of RUBRICS) {
    if (match.test(questionText)) return rubric;
  }
  return null;
}

// Render a one-block directive note for a single question, or "" if no
// directive is detected.
export function directiveNote(questionText: string): string {
  const r = detectDirective(questionText);
  if (!r) return "";
  return `[Directive "${r.directive}" — a complete answer MUST: ${r.requires
    .map((x, i) => `(${i + 1}) ${x}`)
    .join("; ")}. Penalise if the answer ignores this.]`;
}
