/**
 * Calibration harness.
 *
 * Determinism (low temperature, fixed rubrics) makes scoring REPRODUCIBLE; it
 * does not prove it is CORRECT. This harness measures correctness: it runs the
 * real evaluation prompt over a set of fixtures whose expected score band is
 * known (a topper answer should land high; a deliberately weak stub should land
 * low) and reports how far the model's score is from the expected band.
 *
 * Run:  npx tsx scripts/calibrate.ts
 *
 * Uses the same LLM backend as the app (lib/llm): the local `claude` CLI by
 * default in dev, or Gemini if GEMINI_API_KEY is set / LLM_PROVIDER=gemini.
 * Add fixtures in data/calibration/*.json (see the seed files + README).
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { EvalResultSchema, type StructuredPage, type Question, type Subject, type EvalMode } from "../lib/criteria";
import { EVAL_RESPONSE_SCHEMA } from "../lib/eval-schema";
import { evaluationSystem, evaluationUser } from "../lib/prompts";
import { loadExemplars } from "../lib/exemplars";
import { generateStructured, CLAUDE_OPUS, llmProvider } from "../lib/llm";
import { MODEL_EVALUATE } from "../lib/gemini";

type Fixture = {
  label: string;
  subject: Subject;
  mode: EvalMode;
  expected: { minPercent: number; maxPercent: number };
  note?: string;
  questions: Question[];
  answers: { questionNumber: string; text: string }[];
};

const CAL_DIR = join(process.cwd(), "data", "calibration");

// Turn a plain multi-line answer string into a minimal StructuredPage the
// evaluator accepts. One page per answer; each non-empty line becomes a line
// (heading if it ends with ':'), each whitespace-split token a run. Enough for
// scoring/demands; spatial structure_note will be weak (no boxes), which is
// fine for calibrating CONTENT scoring.
function synthPages(answers: Fixture["answers"]): StructuredPage[] {
  return answers.map((a, idx) => ({
    pageNumber: idx + 1,
    questionNumber: a.questionNumber,
    contentBox: null,
    diagrams: [],
    lines: a.text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => ({
        kind: (l.endsWith(":") ? "heading" : "body") as "heading" | "body",
        underline: false,
        align: "left" as const,
        section: null,
        box: null,
        runs: l.split(/\s+/).map((w) => ({ text: w, uncertain: false, underline: false, strike: false })),
      })),
  }));
}

async function loadFixtures(): Promise<Fixture[]> {
  let files: string[];
  try {
    files = await readdir(CAL_DIR);
  } catch {
    return [];
  }
  const out: Fixture[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    out.push(JSON.parse(await readFile(join(CAL_DIR, f), "utf8")) as Fixture);
  }
  return out;
}

async function runOne(fx: Fixture): Promise<{ got: number; perAnswer: string[] }> {
  const pages = synthPages(fx.answers);
  const topicHint = fx.questions.map((q) => q.text).join(" ");
  const exemplars = await loadExemplars(topicHint, fx.mode, fx.subject);

  const raw = await generateStructured({
    system: evaluationSystem(exemplars, fx.mode, fx.subject),
    parts: [{ text: evaluationUser(fx.questions, pages, fx.mode, fx.subject) }],
    geminiSchema: EVAL_RESPONSE_SCHEMA,
    zodSchema: EvalResultSchema,
    geminiModel: MODEL_EVALUATE,
    claudeModel: CLAUDE_OPUS,
    maxOutputTokens: 16000,
    temperature: 0.2,
  });
  const parsed = EvalResultSchema.parse(JSON.parse(raw));

  const percents = parsed.answers.map((a) => (a.max_score > 0 ? (a.score / a.max_score) * 100 : 0));
  const mean = percents.reduce((s, p) => s + p, 0) / (percents.length || 1);
  const perAnswer = parsed.answers.map(
    (a) => `Q${String(a.questionNumber ?? "?").replace(/^Q/i, "")}: ${a.score}/${a.max_score} (${a.core_demand_met})`,
  );
  return { got: mean, perAnswer };
}

async function main() {
  const fixtures = await loadFixtures();
  if (!fixtures.length) {
    console.log(`No fixtures in ${CAL_DIR}. Add *.json fixtures (see README) and re-run.`);
    return;
  }
  console.log(`Calibration — provider: ${llmProvider()} — ${fixtures.length} fixture(s)\n`);

  let absErrSum = 0;
  let withinCount = 0;
  for (const fx of fixtures) {
    const { minPercent, maxPercent } = fx.expected;
    const mid = (minPercent + maxPercent) / 2;
    try {
      const { got, perAnswer } = await runOne(fx);
      const within = got >= minPercent && got <= maxPercent;
      const absErr = within ? 0 : Math.min(Math.abs(got - minPercent), Math.abs(got - maxPercent));
      absErrSum += Math.abs(got - mid);
      if (within) withinCount++;
      console.log(
        `${within ? "✓" : "✗"} ${fx.label}\n` +
          `   expected ${minPercent}-${maxPercent}%  got ${got.toFixed(0)}%  ` +
          `${within ? "(in band)" : `(off band by ${absErr.toFixed(0)}%)`}\n` +
          `   ${perAnswer.join("  |  ")}\n`,
      );
    } catch (err) {
      console.log(`! ${fx.label} — eval failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  console.log(
    `Summary: ${withinCount}/${fixtures.length} in band; ` +
      `mean abs error vs band-midpoint = ${(absErrSum / fixtures.length).toFixed(1)}%`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
