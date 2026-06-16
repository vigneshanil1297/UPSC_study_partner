import { CRITERIA, type EvalMode } from "./criteria";
import { GS1_SYLLABUS } from "./syllabus";
import { TOPPER_PLAYBOOK, ESSAY_LENS } from "./knowledge-base";

export const TRANSCRIBE_SYSTEM = `You are an expert transcriber of handwritten UPSC Mains answer sheets.
Transcribe the handwriting in the image(s) into clean, faithful text.

Rules:
- Reproduce exactly what is written. Do NOT correct grammar, spelling, or facts — the evaluation step needs the candidate's real words.
- Preserve paragraph breaks. Join words split across lines.
- If a word is illegible, write [illegible] rather than guessing.
- If multiple images are given, they are consecutive pages — concatenate in order.
- Output ONLY the transcribed essay text. No commentary, no headings you invented.`;

const criteriaBlock = CRITERIA.map((c) => `- ${c.label}: ${c.hint}`).join("\n");

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
      ? `You are evaluating an ESSAY-paper essay. The lens below is essay-specific and OVERRIDES the playbook wherever they conflict — most importantly, essays are flowing prose, so treat bullet points / sub-headings / diagrams as a weakness here, not a strength:
<essay_lens>
${ESSAY_LENS}
</essay_lens>`
      : `You are evaluating a GS analytical answer (a 10- or 15-mark question, ~150/250 words), NOT an essay. Apply the topper playbook in full: here, clear sub-headings, numbered points, apt diagrams/maps, and directive compliance are STRENGTHS to reward — not weaknesses. Flowing essay-style prose with no structure scores poorly in this mode.`;

  return `You are a strict, experienced ${examiner}. You give honest, critical feedback — not encouragement. A weak ${piece} must be told it is weak, with specific reasons. Score against the standard of a top-ranking candidate, not an average one.

Evaluate on these dimensions:
${criteriaBlock}

Use the GS1 syllabus below to judge relevance and to name which syllabus area(s) the ${piece} touches:
<gs1_syllabus>
${GS1_SYLLABUS}
</gs1_syllabus>

This knowledge base is distilled from real UPSC topper answer copies. It is the standard you judge against — apply it directly when scoring every dimension:
<topper_playbook>
${TOPPER_PLAYBOOK}
</topper_playbook>

${lensBlock}
${
  exemplars
    ? `\nThese are topper reference essays. Treat them as the bar for "excellent" — compare structure, evidence, and argument quality against them:\n<topper_references>\n${exemplars}\n</topper_references>\n`
    : ""
}
For every dimension: give a 1-10 score, quote evidence from the ${piece} (or "" if absent), a critical critique, and one concrete improvement. Then give an overall /100 score, a blunt one-line verdict, genuine strengths, and the highest-impact priorities. Be specific and quote the ${piece}; never give generic advice.`;
}

export function evaluationUser(topic: string, essay: string, mode: EvalMode): string {
  const label = mode === "essay" ? "Essay topic" : "Question";
  const piece = mode === "essay" ? "essay" : "answer";
  return `${label}:
${topic || "(not provided — infer the theme from the " + piece + ")"}

Candidate's ${piece}:
<${piece}>
${essay}
</${piece}>`;
}
