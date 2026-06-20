"use client";

import { useLayoutEffect, useRef } from "react";
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

// One standard font size for all transcribed lines, in container-query height
// units (1cqh = 1% of page height) so it scales with the page but stays uniform
// line-to-line. fitLinesToWidth() shrinks only the rare line that would overflow.
const LINE_FONT = "2.6cqh";

// Shrink each positioned line's font until its text fits inside its box width.
// lineFont() sizes from box *height* only, and lines use white-space:nowrap, so
// long lines (whose true cursive width the server can't know) overflow the page
// right edge. We measure in the browser after the web-font loads and on resize,
// scaling font-size down by the overflow ratio (never up past the height-based
// base). Each line's height-based base is stashed in data-base-font.
function fitLinesToWidth(container: HTMLElement) {
  const lines = container.querySelectorAll<HTMLElement>(".sheet-line-abs");
  for (const el of lines) {
    const base = el.dataset.baseFont ?? el.style.fontSize;
    el.dataset.baseFont = base;
    el.style.fontSize = base;
    const overflow = el.scrollWidth - el.clientWidth;
    if (overflow <= 1 || el.clientWidth === 0) continue;
    const baseVal = parseFloat(base);
    const unit = base.replace(/[\d.]/g, "");
    const ratio = el.clientWidth / el.scrollWidth;
    el.style.fontSize = `${(baseVal * ratio).toFixed(2)}${unit}`;
  }
}

// --- Positioned (layout-faithful) rendering -------------------------------
function PositionedPage({ page, notes = [], onCorrect }: Props) {
  const notesByLine = new Map<number, Annotation[]>();
  for (const n of notes) {
    const arr = notesByLine.get(n.lineIndex) ?? [];
    arr.push(n);
    notesByLine.set(n.lineIndex, arr);
  }
  const aspect = page.aspect && page.aspect > 0 ? page.aspect : 1.414;

  const pageRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const fit = () => fitLinesToWidth(el);
    fit();
    // Re-fit once the cursive web-font swaps in (changes text width).
    document.fonts?.ready.then(fit);
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [page]);

  return (
    <div ref={pageRef} className="sheet-page" style={{ aspectRatio: String(1 / aspect) }}>
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
        return (
          <div key={li}>
            <div
              className={`sheet-line-abs ${line.kind === "heading" ? "font-bold" : ""} ${
                line.underline ? "underline" : ""
              } ${line.kind === "question-number" ? "text-blue-800" : ""}`}
              style={{
                left: pct(line.box.xmin),
                top: pct(line.box.ymin),
                width: pct(Math.max(2, line.box.xmax - line.box.xmin)),
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
