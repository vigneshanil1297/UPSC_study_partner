import { readFile, readdir } from "fs/promises";
import path from "path";

const EXEMPLAR_DIR = path.join(process.cwd(), "data", "exemplars");

// Load topper reference essays (.txt / .md) to use as in-prompt few-shot
// anchors for "what good looks like". For a few samples this is plenty — no
// vector DB needed. If the corpus outgrows the prompt budget, swap this for
// embedding + retrieval (e.g. Supabase pgvector) keyed on essay topic.
export async function loadExemplars(): Promise<string> {
  let files: string[];
  try {
    files = await readdir(EXEMPLAR_DIR);
  } catch {
    return ""; // dir missing → no exemplars yet, evaluator still works.
  }

  const texts: string[] = [];
  for (const f of files) {
    if (!/\.(txt|md)$/i.test(f)) continue;
    const body = await readFile(path.join(EXEMPLAR_DIR, f), "utf8");
    if (body.trim()) texts.push(`### Topper reference: ${f}\n${body.trim()}`);
  }
  return texts.join("\n\n---\n\n");
}
