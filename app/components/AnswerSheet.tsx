"use client";

import type { Annotation, Line, StructuredPage } from "@/lib/criteria";

type Props = {
  page: StructuredPage;
  notes?: Annotation[];
  // Replace a run's text (and clear its uncertain flag) after the user edits it.
  onCorrect: (lineIndex: number, runIndex: number, text: string) => void;
};

const noteColor: Record<Annotation["type"], string> = {
  add: "text-red-600",
  fix: "text-red-700 font-medium",
  praise: "text-emerald-700",
};

// Render text, wrapping abbreviation / multi-capital clusters (PM-AWAS, UPSC,
// NABARD) in a block-print hand — joined cursive renders runs of capitals
// badly. A cluster = a token whose letters/digits include 2+ uppercase letters
// (joiners . - & allowed); pure-digit tokens like "2047" are left in cursive.
function renderCaps(text: string, keyBase: string): React.ReactNode {
  const re = /[A-Za-z0-9]+(?:[.&-][A-Za-z0-9]+)*/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    const tok = m[0];
    const caps = (tok.match(/[A-Z]/g) ?? []).length;
    if (caps >= 2) {
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push(
        <span key={`${keyBase}-${i++}`} className="run-caps">
          {tok}
        </span>,
      );
      last = m.index + tok.length;
    }
  }
  if (out.length === 0) return text;
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// The editable/plain run spans of a line, with per-word underline + uncertainty.
function Runs({
  line,
  li,
  onCorrect,
}: {
  line: Line;
  li: number;
  onCorrect: Props["onCorrect"];
}) {
  return (
    <>
      {line.runs.map((run, ri) => {
        const text = cleanText(run.text);
        if (!text) return null;
        const cls = `${run.underline ? "underline" : ""} ${run.strike ? "run-strike" : ""}`;
        const body = renderCaps(text, `${li}-${ri}`);
        return (
          <span key={ri} className={cls}>
            {run.uncertain ? (
              <span
                className="run-uncertain"
                contentEditable
                suppressContentEditableWarning
                title="Uncertain reading — click to correct"
                onBlur={(e) => {
                  const t = e.currentTarget.textContent ?? "";
                  if (t !== run.text) onCorrect(li, ri, t);
                }}
              >
                {body}
              </span>
            ) : (
              body
            )}{" "}
          </span>
        );
      })}
    </>
  );
}

// Drop model placeholder junk like "[struck-out word]" / "[crossed out]" — the
// real letters are transcribed in the run text and marked with `strike`.
function cleanText(text: string): string {
  return text.replace(/\[[^\]]*\b(struck|strike|crossed)[^\]]*\]/gi, "").replace(/\s{2,}/g, " ");
}

const lineText = (line: Line) => line.runs.map((r) => r.text).join(" ").trim();

// A fresh numbered/lettered point: "1)", "2.", "(a)".
const startsListItem = (line: Line) =>
  line.kind === "body" && /^\s*\(?[0-9a-zA-Z][).]/.test(line.runs[0]?.text ?? "");

// A dash/bullet sub-point: "- ...", "• ...", "–/— ...".
const startsDash = (line: Line) =>
  line.kind === "body" && /^\s*[-–—•]/.test(line.runs[0]?.text ?? "");

// Previous content ended a sentence — used to avoid inserting a paragraph gap in
// the MIDDLE of a wrapped sentence when the model's y-coordinates are noisy.
const endsSentence = (line: Line | undefined) => !!line && /[.?!:।]["')\]]?\s*$/.test(lineText(line));

// --- Clean printed-booklet rendering ----------------------------------------
// Reflows the transcript into a typed UPSC answer-booklet: a bordered sheet
// with a "UPSC" header band, a narrow left margin column carrying the circled
// question number, and a content column in a clean printed font. Consecutive
// body lines merge into paragraphs; numbered points break into spaced
// hanging-indent blocks; dividers become full-width rules. Line breaks,
// underlines and uncertain words are preserved. Diagrams interleave at their
// vertical position.
function FlowPage({ page, notes = [], onCorrect }: Props) {
  const notesByLine = new Map<number, Annotation[]>();
  for (const n of notes) {
    const arr = notesByLine.get(n.lineIndex) ?? [];
    arr.push(n);
    notesByLine.set(n.lineIndex, arr);
  }

  // Place each diagram after the line index it vertically follows, so diagrams
  // land roughly where they sit on the page rather than all at the end.
  const diagramsAfter = new Map<number, typeof page.diagrams>();
  for (const d of page.diagrams) {
    let idx = -1;
    for (let i = 0; i < page.lines.length; i++) {
      const b = page.lines[i].box;
      if (b && b.ymin <= d.box.ymin) idx = i;
    }
    const arr = diagramsAfter.get(idx) ?? [];
    arr.push(d);
    diagramsAfter.set(idx, arr);
  }

  const renderDiagrams = (idx: number) =>
    (diagramsAfter.get(idx) ?? []).map((d, i) =>
      d.png ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={`d${idx}-${i}`} src={d.png} alt={d.caption ?? "diagram"} className="booklet-diagram" />
      ) : (
        <div key={`d${idx}-${i}`} className="booklet-diagram-missing">
          {d.caption ?? "diagram"}
        </div>
      ),
    );

  // The circled number for the margin column: the page's questionNumber, else
  // the first question-number line's digits. Question-number lines are then
  // dropped from the content (they live in the margin instead).
  const qnumLine = page.lines.find((l) => l.kind === "question-number");
  const qnumText = (qnumLine?.runs.map((r) => r.text).join(" ") ?? "").replace(/[^0-9a-zA-Z().]/g, "");
  const qnum = page.questionNumber ?? (qnumText || null);

  const textLines = page.lines
    .map((l, i) => ({ l, i }))
    .filter((x) => x.l.box && x.l.kind !== "divider");

  // Vertical spacing: a real BLANK-LINE gap in the source = a paragraph break.
  // The writer also indents wrapped continuation lines, so indent alone can't
  // tell a new paragraph from a continuation — we use the y-gap. To stay robust
  // against noisy model coordinates we require the gap to be clearly larger than
  // the median AND the previous line to have ended a sentence (or the new line
  // to start a point/dash/heading), so we never split mid-sentence.
  const deltas: number[] = [];
  for (let k = 1; k < textLines.length; k++) {
    const d = textLines[k].l.box!.ymin - textLines[k - 1].l.box!.ymin;
    if (d > 0) deltas.push(d);
  }
  const sorted = [...deltas].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const paraBreak = new Set<number>();
  for (let k = 1; k < textLines.length; k++) {
    const cur = textLines[k];
    const d = cur.l.box!.ymin - textLines[k - 1].l.box!.ymin;
    const bigGap = median > 0 && d > median * 1.7;
    const structural = startsListItem(cur.l) || startsDash(cur.l) || cur.l.kind === "heading";
    if (bigGap && (structural || endsSentence(textLines[k - 1].l))) paraBreak.add(cur.i);
  }

  // Horizontal indent is reproduced from each line's own box.xmin relative to
  // the column's left edge — this faithfully recreates the page's dash sub-
  // points and the indented continuation lines beneath a point. Quantised into
  // discrete steps so small coordinate jitter doesn't make aligned lines wobble.
  const lefts = page.lines
    .filter((l) => l.box && l.align !== "center" && l.align !== "right" && l.kind !== "divider")
    .map((l) => l.box!.xmin);
  const leftEdge = lefts.length ? Math.min(...lefts) : 0;
  const STEP = 32; // 0–1000 page units per indent level
  const indentEm = (line: Line): number => {
    if (!line.box || line.align === "center" || line.align === "right") return 0;
    const off = line.box.xmin - leftEdge;
    if (off < STEP * 0.6) return 0; // at the margin
    return Math.min(4, Math.round(off / STEP)) * 1.4; // 1.4em per level, capped
  };

  // 3-column grid (margin | content | right margin) shared by the header and
  // body rows so the vertical rules run continuously top-to-bottom; the outer
  // border + bottom edge come from .booklet itself.
  return (
    <div className="booklet text-neutral-900">
      {/* Header row */}
      <div className="booklet-cell booklet-c1 booklet-hrow" />
      <div className="booklet-cell booklet-c2 booklet-hrow booklet-title">
        <span className="booklet-title-text">UPSC</span>
      </div>
      <div className="booklet-cell booklet-c3 booklet-hrow" />

      {/* Body row */}
      <div className="booklet-cell booklet-c1 booklet-margin">
        {qnum && <span className="booklet-qnum">{qnum}</span>}
      </div>
      <div className="booklet-cell booklet-c2 booklet-content font-hand">
        {renderDiagrams(-1)}
        {page.lines.map((line, li) => {
          if (line.kind === "question-number") return renderDiagrams(li);
          if (line.kind === "divider")
            return (
              <div key={li}>
                <hr className="booklet-divider" />
                {renderDiagrams(li)}
              </div>
            );
          const lineNotes = notesByLine.get(li) ?? [];
          const align =
            line.align === "center" ? "text-center" : line.align === "right" ? "text-right" : "";
          // Spacing: a fresh block before a numbered point, a dash sub-point, a
          // heading, or a real blank-line paragraph break.
          const spaced =
            startsListItem(line) || startsDash(line) || line.kind === "heading" || paraBreak.has(li)
              ? "booklet-block"
              : "";
          const pad = align === "" ? indentEm(line) : 0;
          return (
            <div key={li}>
              <div
                className={`booklet-line ${spaced} ${
                  line.kind === "heading" ? "font-semibold" : ""
                } ${line.underline ? "underline" : ""} ${align}`}
                style={pad ? { paddingLeft: `${pad}em` } : undefined}
              >
                <Runs line={line} li={li} onCorrect={onCorrect} />
              </div>
              {lineNotes.map((n, ni) => (
                <div key={ni} className={`note-hand ${noteColor[n.type]} pl-2`}>
                  ✎ {n.text}
                </div>
              ))}
              {renderDiagrams(li)}
            </div>
          );
        })}
      </div>
      <div className="booklet-cell booklet-c3" />
    </div>
  );
}

// One transcribed PDF page redrawn as a clean printed answer-booklet.
export default function AnswerSheet(props: Props) {
  return (
    <div className="sheet-frame text-neutral-800">
      <FlowPage {...props} />
    </div>
  );
}
