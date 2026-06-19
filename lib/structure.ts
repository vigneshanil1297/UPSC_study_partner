import type { Line, StructuredPage } from "./criteria";

// ---------------------------------------------------------------------------
// Structure benchmark (req 6).
//
// Derived from the topper copies in `toppers papers/` (Shakti Dubey AIR-1,
// Aditya Srivastava AIR-1, Akansh Dhull AIR-3, Raj Krishna AIR-8, Animesh
// Pradhan, VisionIAS Akansh/Zinnia). Two things were measured per answer:
//
// 1. POINT COUNT — distinct body points (numbered/bulleted sub-points and
//    boxed/underlined sub-headings). Topper 10-markers run ~4-6 discrete points;
//    15-markers ~6-9. Average ≈ 5 (10m) / 8 (15m).
//
// 2. SPATIAL RATIO — the share of the page area (NOT word count) given to
//    introduction vs body vs conclusion. Toppers spend a tight ~3-4 lines on a
//    pointed intro and a similar quantified conclusion, with the bulk of the
//    page on the headed/numbered body. Saturated ratio ≈ 15 : 70 : 15.
// ---------------------------------------------------------------------------
export const STRUCTURE_BENCHMARK = {
  pointsPer10: 5,
  pointsPer15: 8,
  // Fraction of page space (intro, body, conclusion) — sums to 1.
  intro: 0.15,
  body: 0.7,
  conclusion: 0.15,
} as const;

export type StructureStats = {
  points: number;
  intro: number; // spatial fractions, sum ≈ 1 (0 if not derivable)
  body: number;
  conclusion: number;
  hasLayout: boolean; // false when boxes/sections are absent (old transcripts)
};

const POINT_START = /^\s*(\d+[.)]|[ivxlcdm]+[.)]|[-•*▪◦‣·]|\([a-z0-9]+\))/i;

// A line "starts a point" if it's a heading, or a body line beginning with a
// number/bullet/letter marker. Used to count an answer's discrete points.
function startsPoint(line: Line): boolean {
  if (line.kind === "divider" || line.kind === "question-number" || line.kind === "note") return false;
  if (line.kind === "heading") return true;
  const first = line.runs[0]?.text ?? "";
  return POINT_START.test(first);
}

function lineHeight(line: Line): number {
  if (!line.box) return 0;
  return Math.max(0, line.box.ymax - line.box.ymin);
}

// Compute an answer's point count and intro/body/conclusion spatial ratio from
// the (possibly multi-page) set of pages that make up one answer. Spatial share
// is measured by summed line-box height per section, falling back to line counts
// when boxes are missing.
export function computeStructure(pages: StructuredPage[]): StructureStats {
  const lines = pages.flatMap((p) => p.lines);
  const hasBoxes = lines.some((l) => l.box);
  const hasSections = lines.some((l) => l.section);

  let points = 0;
  const space = { intro: 0, body: 0, conclusion: 0 };
  for (const line of lines) {
    if (startsPoint(line)) points++;
    const sec = line.section;
    if (!sec) continue;
    space[sec] += hasBoxes ? lineHeight(line) : 1;
  }

  const total = space.intro + space.body + space.conclusion;
  if (!hasSections || total === 0) {
    return { points, intro: 0, body: 0, conclusion: 0, hasLayout: hasBoxes };
  }
  return {
    points,
    intro: space.intro / total,
    body: space.body / total,
    conclusion: space.conclusion / total,
    hasLayout: hasBoxes,
  };
}

// One-line plain-text summary for the evaluation prompt, comparing an answer to
// the benchmark. Returns "" when there is no layout data to compare.
export function structureSummary(pages: StructuredPage[]): string {
  const s = computeStructure(pages);
  if (s.intro + s.body + s.conclusion === 0) return "";
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const b = STRUCTURE_BENCHMARK;
  return (
    `points: ${s.points} (topper avg ~${b.pointsPer10}/10m, ~${b.pointsPer15}/15m); ` +
    `spatial intro/body/conclusion ${pct(s.intro)}/${pct(s.body)}/${pct(s.conclusion)} ` +
    `vs topper benchmark ${pct(b.intro)}/${pct(b.body)}/${pct(b.conclusion)}`
  );
}
