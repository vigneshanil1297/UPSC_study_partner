import type { EvalResult, Subject } from "./criteria";
import type { EvalRecord } from "./supabase";

// ---------------------------------------------------------------------------
// Mistake bank — a user-wide, cumulative record of every mistake flagged across
// all saved evaluations. It is *derived*, not stored: each mistake is read back
// out of an evaluation's saved `result` (the red "fix" margin notes and the
// question demands the answer missed). Because it is computed over the whole
// saved history, it is naturally append-only — a new test just adds its eval
// row, and the bank grows. No per-test regeneration, no separate table.
//
// Near-duplicate mistakes across different tests are clustered together so a
// recurring weakness surfaces as one entry tagged with every test+date it
// showed up on (req: "if a mistake is repeated… point that out").
// ---------------------------------------------------------------------------

// "fix" = a red correction note (something written that was wrong/weak);
// "missed" = an expected demand of the question the answer never addressed.
export type MistakeSource = "fix" | "missed";

// One time a mistake appeared, tagged with the test it came from.
export type MistakeOccurrence = {
  text: string;
  source: MistakeSource;
  evalId: string;
  title: string;        // the test's topic/title — the "which test" label
  subject: Subject;
  date: string;         // ISO timestamp of that evaluation
  questionNumber: string | null;
};

// A group of near-identical mistakes. `count > 1` ⇒ a repeated weakness.
export type MistakeCluster = {
  label: string;               // representative wording (the longest occurrence)
  source: MistakeSource;
  occurrences: MistakeOccurrence[];
  lastSeen: string;            // most recent occurrence date, for sorting
};

// The slice of a saved evaluation the bank actually reads.
export type BankSource = Pick<EvalRecord, "id" | "created_at" | "subject" | "topic" | "result">;

// Pull the raw mistakes out of one saved evaluation's result.
function occurrencesFromRecord(r: BankSource): MistakeOccurrence[] {
  const out: MistakeOccurrence[] = [];
  const result = r.result as EvalResult | undefined;
  for (const ans of result?.answers ?? []) {
    const qn = ans.questionNumber ?? null;
    for (const n of ans.inline_notes ?? []) {
      if (n.type === "fix" && n.text.trim()) {
        out.push({
          text: n.text.trim(),
          source: "fix",
          evalId: r.id,
          title: r.topic,
          subject: r.subject ?? "gs1",
          date: r.created_at,
          questionNumber: qn,
        });
      }
    }
    for (const d of ans.demands ?? []) {
      if (d.status === "missed" && d.point.trim()) {
        out.push({
          text: d.point.trim(),
          source: "missed",
          evalId: r.id,
          title: r.topic,
          subject: r.subject ?? "gs1",
          date: r.created_at,
          questionNumber: qn,
        });
      }
    }
  }
  return out;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "is", "are", "was", "were", "be", "been", "being", "this", "that", "these",
  "those", "it", "its", "as", "at", "by", "from", "you", "your", "not", "no",
  "more", "less", "should", "would", "could", "than", "then", "into", "about",
  "which", "what", "how", "why", "has", "have", "had", "does", "do", "did",
]);

// Reduce a mistake to a comparable token set: lowercase, strip punctuation,
// drop stopwords and 1–2 char noise. Stable enough that "didn't link to NEP
// 2020" and "no link to NEP 2020" overlap heavily.
function tokenize(text: string): Set<string> {
  const toks = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  return new Set(toks);
}

// Jaccard overlap of two token sets (0 = disjoint, 1 = identical).
function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// Two mistakes are "the same range" when their wording overlaps past the
// threshold. 0.45 catches reworded repeats without merging unrelated points.
const SIMILARITY_THRESHOLD = 0.45;

// Build the clustered bank from saved evaluation records. Greedy single-link:
// each occurrence joins the first existing cluster (of the same source) it is
// similar enough to, else starts a new one.
export function buildMistakeBank(records: BankSource[]): MistakeCluster[] {
  const occ = records.flatMap(occurrencesFromRecord);

  type Working = { source: MistakeSource; tokens: Set<string>; occs: MistakeOccurrence[] };
  const clusters: Working[] = [];

  for (const o of occ) {
    const toks = tokenize(o.text);
    let best: Working | null = null;
    let bestSim = 0;
    for (const c of clusters) {
      if (c.source !== o.source) continue;
      const sim = similarity(toks, c.tokens);
      if (sim > bestSim) {
        bestSim = sim;
        best = c;
      }
    }
    if (best && bestSim >= SIMILARITY_THRESHOLD) {
      best.occs.push(o);
      for (const t of toks) best.tokens.add(t); // widen the cluster vocabulary
    } else {
      clusters.push({ source: o.source, tokens: new Set(toks), occs: [o] });
    }
  }

  return clusters
    .map((c) => {
      const occs = [...c.occs].sort((a, b) => +new Date(b.date) - +new Date(a.date));
      // Representative wording = the longest phrasing (usually the most specific).
      const label = occs.reduce((a, b) => (b.text.length > a.text.length ? b : a)).text;
      return { label, source: c.source, occurrences: occs, lastSeen: occs[0].date };
    })
    // Repeated mistakes first (most occurrences), then most-recent first.
    .sort(
      (a, b) =>
        b.occurrences.length - a.occurrences.length ||
        +new Date(b.lastSeen) - +new Date(a.lastSeen),
    );
}
