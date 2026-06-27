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

  // Horizontal indent is NOT taken from per-line box.xmin: on cursive script the
  // model's bounding boxes jitter (tall/capital first letters widen xmin), so
  // xmin-based indent scattered spurious indents across visually-aligned lines.
  // Indent is now structural only — a fixed hanging indent for dash sub-points.

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
        {(() => {
          // Reflow: consecutive body lines flow into one paragraph block. The
          // model splits text at handwriting line positions; emitting one div per
          // source line mirrored that wrap (choppy short lines). We instead merge
          // wrapped continuation lines and only break at real structure: a numbered
          // point, a dash sub-point, a heading, a centered/right line, or a real
          // blank-line paragraph gap (paraBreak). Each source line stays an inline
          // span so its own underline/heading weight and per-run editing survive.
          const out: React.ReactNode[] = [];
          let cur:
            | {
                key: number;
                spaced: boolean;
                align: string;
                pad: number;
                lines: React.ReactNode[];
                extras: React.ReactNode[];
              }
            | null = null;
          let forceBreakNext = false;

          const flush = () => {
            if (!cur) return;
            const c = cur;
            out.push(
              <div key={`b${c.key}`}>
                <div
                  className={`booklet-line ${c.spaced ? "booklet-block" : ""} ${c.align}`}
                  style={c.pad ? { paddingLeft: `${c.pad}em` } : undefined}
                >
                  {c.lines}
                </div>
                {c.extras}
              </div>,
            );
            cur = null;
          };

          page.lines.forEach((line, li) => {
            if (line.kind === "question-number") {
              flush();
              const d = renderDiagrams(li);
              if (d.length) out.push(<div key={`q${li}`}>{d}</div>);
              forceBreakNext = true;
              return;
            }
            if (line.kind === "divider") {
              flush();
              out.push(
                <div key={`hr${li}`}>
                  <hr className="booklet-divider" />
                  {renderDiagrams(li)}
                </div>,
              );
              forceBreakNext = true;
              return;
            }

            const isHeading = line.kind === "heading";
            const align =
              line.align === "center" ? "text-center" : line.align === "right" ? "text-right" : "";
            const standalone = isHeading || align !== "";
            const newBlock =
              !cur ||
              forceBreakNext ||
              standalone ||
              startsListItem(line) ||
              startsDash(line) ||
              paraBreak.has(li);

            if (newBlock) {
              flush();
              cur = {
                key: li,
                spaced:
                  startsListItem(line) || startsDash(line) || isHeading || paraBreak.has(li),
                align,
                pad: startsDash(line) ? 1.4 : 0,
                lines: [],
                extras: [],
              };
            }

            cur!.lines.push(
              <span
                key={`l${li}`}
                className={`${isHeading ? "font-semibold" : ""} ${
                  line.underline ? "underline" : ""
                }`}
              >
                <Runs line={line} li={li} onCorrect={onCorrect} />
              </span>,
            );

            const lineNotes = notesByLine.get(li) ?? [];
            lineNotes.forEach((n, ni) =>
              cur!.extras.push(
                <div key={`n${li}-${ni}`} className={`note-hand ${noteColor[n.type]} pl-2`}>
                  ✎ {n.text}
                </div>,
              ),
            );
            const d = renderDiagrams(li);
            if (d.length) cur!.extras.push(<div key={`d${li}`}>{d}</div>);

            // A heading/centered line is single-line: force the next line fresh.
            forceBreakNext = standalone;
          });
          flush();
          return out;
        })()}
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
