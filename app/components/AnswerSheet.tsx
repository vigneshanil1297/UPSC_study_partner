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

// 0–1000 → CSS %.
const pct = (v: number) => `${v / 10}%`;

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
        const u = run.underline ? "underline" : "";
        return (
          <span key={ri} className={u}>
            {run.uncertain ? (
              <span
                className="run-uncertain"
                contentEditable
                suppressContentEditableWarning
                title="Uncertain reading — click to correct"
                onBlur={(e) => {
                  const text = e.currentTarget.textContent ?? "";
                  if (text !== run.text) onCorrect(li, ri, text);
                }}
              >
                {run.text}
              </span>
            ) : (
              run.text
            )}{" "}
          </span>
        );
      })}
    </>
  );
}

// One standard font size for EVERY transcribed line, in container-query height
// units (1cqh = 1% of page height) so it scales with the page but stays uniform
// line-to-line — no per-line shrinking. A line longer than its box wraps within
// the page (see RIGHT_LIMIT) instead of shrinking or spilling off the edge.
const LINE_FONT = "2.6cqh";

// Right edge (0–1000) past which line text must not extend. Each line's width is
// stretched from its left to here so cursive text — wider than the server's box
// estimate — wraps at the page margin rather than spilling off the page.
const RIGHT_LIMIT = 965;

// --- Positioned (layout-faithful) rendering -------------------------------
function PositionedPage({ page, notes = [], onCorrect }: Props) {
  const notesByLine = new Map<number, Annotation[]>();
  for (const n of notes) {
    const arr = notesByLine.get(n.lineIndex) ?? [];
    arr.push(n);
    notesByLine.set(n.lineIndex, arr);
  }
  const aspect = page.aspect && page.aspect > 0 ? page.aspect : 1.414;

  return (
    <div className="sheet-page" style={{ aspectRatio: String(1 / aspect) }}>
      {/* Pasted diagrams (req 5) */}
      {page.diagrams.map((d, i) => {
        const style = {
          left: pct(d.box.xmin),
          top: pct(d.box.ymin),
          width: pct(d.box.xmax - d.box.xmin),
          height: pct(d.box.ymax - d.box.ymin),
        };
        return d.png ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`d${i}`} src={d.png} alt={d.caption ?? "diagram"} className="sheet-diagram" style={style} />
        ) : (
          <div key={`d${i}`} className="sheet-diagram-missing" style={style}>
            {d.caption ?? "diagram"}
          </div>
        );
      })}

      {page.lines.map((line, li) => {
        if (!line.box) return null;
        if (line.kind === "divider") {
          return (
            <div
              key={li}
              className="sheet-divider"
              style={{
                left: pct(line.box.xmin),
                top: pct((line.box.ymin + line.box.ymax) / 2),
                width: pct(Math.max(20, line.box.xmax - line.box.xmin)),
              }}
            />
          );
        }
        const lineNotes = notesByLine.get(li) ?? [];
        // Left-aligned lines stretch to the page margin so over-long cursive
        // wraps there instead of spilling off-page; centred lines keep their own
        // box width so they stay centred.
        const boxW = Math.max(2, line.box.xmax - line.box.xmin);
        const width =
          line.align === "center"
            ? boxW
            : Math.max(boxW, RIGHT_LIMIT - line.box.xmin);
        return (
          <div key={li}>
            <div
              className={`sheet-line-abs ${line.kind === "heading" ? "font-bold" : ""} ${
                line.underline ? "underline" : ""
              } ${line.kind === "question-number" ? "text-blue-800" : ""}`}
              style={{
                left: pct(line.box.xmin),
                top: pct(line.box.ymin),
                width: pct(width),
                fontSize: LINE_FONT,
                textAlign: line.align,
              }}
            >
              <Runs line={line} li={li} onCorrect={onCorrect} />
            </div>
            {lineNotes.map((n, ni) => (
              <div
                key={ni}
                className={`note-abs ${noteColor[n.type]}`}
                style={{ top: pct(line.box!.ymin), left: pct(Math.min(720, line.box!.xmax + 5)) }}
              >
                ✎ {n.text}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// --- Fallback flow rendering (old transcripts with no boxes) ----------------
function FlowPage({ page, notes = [], onCorrect }: Props) {
  const notesByLine = new Map<number, Annotation[]>();
  for (const n of notes) {
    const arr = notesByLine.get(n.lineIndex) ?? [];
    arr.push(n);
    notesByLine.set(n.lineIndex, arr);
  }
  return (
    <div className="sheet font-hand text-neutral-800">
      {page.lines.map((line, li) => {
        if (line.kind === "divider") return <hr key={li} className="sheet-divider-flow" />;
        const lineNotes = notesByLine.get(li) ?? [];
        return (
          <div key={li}>
            <div
              className={`sheet-line ${line.kind === "heading" ? "font-bold" : ""} ${
                line.underline ? "underline" : ""
              } ${line.kind === "question-number" ? "text-blue-800" : ""}`}
              style={{ textAlign: line.align }}
            >
              <Runs line={line} li={li} onCorrect={onCorrect} />
            </div>
            {lineNotes.map((n, ni) => (
              <div key={ni} className={`note-hand ${noteColor[n.type]} pl-2`}>
                ✎ {n.text}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// One transcribed PDF page redrawn as an answer-sheet. When the transcript
// carries per-line boxes + page aspect it is drawn layout-faithfully (true
// positions, alignment, underlines, dividers, pasted diagrams, page frame);
// older box-less transcripts fall back to the ruled flow layout.
export default function AnswerSheet(props: Props) {
  const positioned = props.page.aspect != null && props.page.lines.some((l) => l.box);
  return positioned ? (
    <div className="sheet-frame font-hand text-neutral-800">
      <PositionedPage {...props} />
    </div>
  ) : (
    <FlowPage {...props} />
  );
}
