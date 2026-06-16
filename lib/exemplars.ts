import { readFile, readdir } from "fs/promises";
import path from "path";
import type { EvalMode } from "./criteria";

const EXEMPLAR_DIR = path.join(process.cwd(), "data", "exemplars");
const MAX_EXEMPLARS = 3;

type Exemplar = { file: string; topic: string; mode: EvalMode | "any"; body: string };

// Tiny stop-word list so topic matching keys on content words, not glue.
const STOP = new Set(
  "the a an of to in on for and or is are be as by with at from that this it its their our we you not but".split(" "),
);

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

async function readExemplars(): Promise<Exemplar[]> {
  let files: string[];
  try {
    files = await readdir(EXEMPLAR_DIR);
  } catch {
    return []; // dir missing → no exemplars yet, evaluator still works.
  }

  const out: Exemplar[] = [];
  for (const f of files) {
    if (!/\.(txt|md)$/i.test(f)) continue;
    const body = (await readFile(path.join(EXEMPLAR_DIR, f), "utf8")).trim();
    if (!body) continue;
    // Optional metadata in the file: a "# Topic: ..." heading and a
    // "mode: essay|gs" tag (anywhere, e.g. in a comment) to scope the sample.
    const topicMatch = body.match(/^#\s*Topic:\s*(.+)$/im);
    const modeMatch = body.match(/mode:\s*(essay|gs)\b/i);
    out.push({
      file: f,
      topic: topicMatch?.[1]?.trim() ?? f,
      mode: (modeMatch?.[1]?.toLowerCase() as EvalMode) ?? "any",
      body,
    });
  }
  return out;
}

// Load topper reference essays as in-prompt few-shot anchors for "what good
// looks like". Now topic-aware: prefers samples matching the current mode and
// ranks the rest by keyword overlap with the topic, returning the top few so
// the prompt stays grounded and within budget. If the corpus outgrows this,
// swap for embedding + retrieval (e.g. Supabase pgvector).
export async function loadExemplars(topic = "", mode?: EvalMode): Promise<string> {
  const all = await readExemplars();
  if (!all.length) return "";

  // Prefer exemplars tagged for this mode (plus untagged "any"); fall back to
  // everything if none match so we never return empty when samples exist.
  const modeFiltered = mode ? all.filter((e) => e.mode === mode || e.mode === "any") : all;
  const pool = modeFiltered.length ? modeFiltered : all;

  let chosen = pool;
  const query = tokenize(topic);
  if (query.size) {
    chosen = [...pool]
      .map((e) => ({ e, score: overlap(query, tokenize(`${e.topic} ${e.body}`)) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.e);
  }

  return chosen
    .slice(0, MAX_EXEMPLARS)
    .map((e) => `### Topper reference: ${e.file}\n${e.body}`)
    .join("\n\n---\n\n");
}
