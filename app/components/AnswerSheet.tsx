"use client";

import type { Annotation, Box, Line, StructuredPage } from "@/lib/criteria";

type Props = {
  page: StructuredPage;
  notes?: Annotation[];
  // "lined" = each transcribed line on its own row, breaking exactly where the
  // page breaks (never overlaps). "faithful" = lines at their true box x/y.
  layout?: "lined" | "faithful";
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

// Minimum vertical gap (0–1000 units) between consecutive lines' tops. The
// uniform line font is ~LINE_FONT (2.6% of page height ≈ 26 units), so anything
// closer than this means two lines would render on top of each other. We push
// later lines down to enforce it — this is what stops words stacking above one
// another when the model returns near-identical y's for adjacent lines.
const MIN_LINE_GAP = 30;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Remap a page-coordinate box into the writing-area rectangle. Each axis is
// rescaled so the contentBox spans the full 0–1000 sheet, which aligns all text
// to the printed borders and cancels camera skew / binding / margin furniture.
// No contentBox → identity.
function makeNormalize(cb: Box | null | undefined) {
  if (!cb) return (b: Box) => b;
  const dx = cb.xmax - cb.xmin || 1;
  const dy = cb.ymax - cb.ymin || 1;
  const nx = (x: number) => clamp(((x - cb.xmin) / dx) * 1000, 0, 1000);
  const ny = (y: number) => clamp(((y - cb.ymin) / dy) * 1000, 0, 1000);
  return (b: Box): Box => ({ xmin: nx(b.xmin), xmax: nx(b.xmax), ymin: ny(b.ymin), ymax: ny(b.ymax) });
}

// --- Positioned (layout-faithful) rendering -------------------------------
function PositionedPage({ page, notes = [], onCorrect }: Props) {
  const notesByLine = new Map<number, Annotation[]>();
  for (const n of notes) {
    const arr = notesByLine.get(n.lineIndex) ?? [];
    arr.push(n);
    notesByLine.set(n.lineIndex, arr);
  }
  const cb = page.contentBox;
  const normalize = makeNormalize(cb);
  // The drawn sheet should have the writing-area's proportions, not the whole
  // photo's — height/width of the contentBox in real pixels.
  const pageAspect = page.aspect && page.aspect > 0 ? page.aspect : 1.414;
  const aspect =
    cb && cb.xmax > cb.xmin && cb.ymax > cb.ymin
      ? pageAspect * ((cb.ymax - cb.ymin) / (cb.xmax - cb.xmin))
      : pageAspect;

  // Pre-pass: normalize every line box into the border rectangle, then walk
  // top-to-bottom enforcing a gap so adjacent lines never overlap. The gap for
  // a line is MIN_LINE_GAP times its estimated wrapped-row count: a long cursive
  // line that wraps to 2 visual rows reserves 2 rows of vertical space, so the
  // next line is pushed below the wrap instead of rendering on top of it.
  const lineBoxes: (Box | null)[] = [];
  let lastBottom = -Infinity;
  for (const line of page.lines) {
    if (!line.box) {
      lineBoxes.push(null);
      continue;
    }
    const b = normalize(line.box);
    // Rendered glyph height ≈ LINE_FONT (2.6% of page height). Width of one
    // page-height unit in render px is `aspect` units of page width, so chars
    // that fit across the line ≈ lineWidthFrac / (charEm * fontFrac * aspect).
    const widthUnits =
      line.align === "center"
        ? Math.max(2, b.xmax - b.xmin)
        : Math.max(b.xmax - b.xmin, RIGHT_LIMIT - b.xmin);
    const chars = line.runs.reduce((n, r) => n + r.text.length + 1, 0);
    // Glyph advance ≈ 0.55em at LINE_FONT; one char ≈ 0.55 * 26 * aspect units
    // wide. Bias slightly toward fewer chars/row (more rows) so the reserved
    // gap is never short → no overlap.
    const charsPerRow = Math.max(1, widthUnits / (14 * aspect));
    const rows = line.kind === "divider" ? 1 : Math.max(1, Math.ceil(chars / charsPerRow));
    const gap = MIN_LINE_GAP * rows;
    if (b.ymin < lastBottom) {
      const shift = lastBottom - b.ymin;
      b.ymin += shift;
      b.ymax += shift;
    }
    lastBottom = b.ymin + gap;
    lineBoxes.push(b);
  }

  return (
    <div className="sheet-page" style={{ aspectRatio: String(1 / aspect) }}>
      {/* Pasted diagrams (req 5) */}
      {page.diagrams.map((d, i) => {
        const b = normalize(d.box);
        const style = {
          left: pct(b.xmin),
          top: pct(b.ymin),
          width: pct(b.xmax - b.xmin),
          height: pct(b.ymax - b.ymin),
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
        const box = lineBoxes[li];
        if (!box) return null;
        if (line.kind === "divider") {
          return (
            <div
              key={li}
              className="sheet-divider"
              style={{
                left: pct(box.xmin),
                top: pct((box.ymin + box.ymax) / 2),
                width: pct(Math.max(20, box.xmax - box.xmin)),
              }}
            />
          );
        }
        const lineNotes = notesByLine.get(li) ?? [];
        // Left-aligned lines stretch to the page margin so over-long cursive
        // wraps there instead of spilling off-page; centred lines keep their own
        // box width so they stay centred.
        const boxW = Math.max(2, box.xmax - box.xmin);
        const width =
          line.align === "center"
            ? boxW
            : Math.max(boxW, RIGHT_LIMIT - box.xmin);
        return (
          <div key={li}>
            <div
              className={`sheet-line-abs ${line.kind === "heading" ? "font-bold" : ""} ${
                line.underline ? "underline" : ""
              } ${line.kind === "question-number" ? "text-blue-800" : ""}`}
              style={{
                left: pct(box.xmin),
                top: pct(box.ymin),
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
                style={{ top: pct(box.ymin), left: pct(Math.min(720, box.xmax + 5)) }}
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

// --- Lined (accurate line-break) rendering ----------------------------------
// Each transcribed line is one flow row that breaks exactly where the page
// breaks. Rows stack top-to-bottom in document flow, so a long line that wraps
// pushes the next row down instead of rendering on top of it — overlap is
// impossible. Diagrams are interleaved at their vertical position. The ruled
// answer-booklet frame (border + red margin + ruling) is drawn around it.
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
        <img key={`d${idx}-${i}`} src={d.png} alt={d.caption ?? "diagram"} className="sheet-lined-diagram" />
      ) : (
        <div key={`d${idx}-${i}`} className="sheet-lined-diagram-missing">
          {d.caption ?? "diagram"}
        </div>
      ),
    );

  return (
    <div className="sheet-lined font-hand text-neutral-800">
      {renderDiagrams(-1)}
      {page.lines.map((line, li) => {
        if (line.kind === "divider")
          return (
            <div key={li}>
              <hr className="sheet-divider-flow" />
              {renderDiagrams(li)}
            </div>
          );
        const lineNotes = notesByLine.get(li) ?? [];
        const indent = line.align === "center" ? "text-center" : line.align === "right" ? "text-right" : "";
        return (
          <div key={li}>
            <div
              className={`sheet-line-lined ${line.kind === "heading" ? "font-bold" : ""} ${
                line.underline ? "underline" : ""
              } ${line.kind === "question-number" ? "text-blue-800" : ""} ${indent}`}
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
  );
}

// One transcribed PDF page redrawn as an answer-sheet. When the transcript
// carries per-line boxes + page aspect it is drawn layout-faithfully (true
// positions, alignment, underlines, dividers, pasted diagrams, page frame);
// older box-less transcripts fall back to the ruled flow layout.
export default function AnswerSheet(props: Props) {
  const hasBoxes = props.page.aspect != null && props.page.lines.some((l) => l.box);
  // Faithful needs boxes; default and box-less transcripts use lined flow.
  const positioned = hasBoxes && (props.layout ?? "lined") === "faithful";
  return (
    <div className="sheet-frame font-hand text-neutral-800">
      {positioned ? <PositionedPage {...props} /> : <FlowPage {...props} />}
    </div>
  );
}
