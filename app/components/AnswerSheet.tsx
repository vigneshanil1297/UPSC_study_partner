"use client";

import type { Annotation, StructuredPage } from "@/lib/criteria";

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

// One transcribed PDF page redrawn as a ruled answer-sheet in a handwritten
// font, with low-confidence words highlighted+editable and the examiner's red
// notes shown inline beneath the line they refer to.
export default function AnswerSheet({ page, notes = [], onCorrect }: Props) {
  const notesByLine = new Map<number, Annotation[]>();
  for (const n of notes) {
    const arr = notesByLine.get(n.lineIndex) ?? [];
    arr.push(n);
    notesByLine.set(n.lineIndex, arr);
  }

  return (
    <div className="sheet font-hand text-neutral-800">
      {page.lines.map((line, li) => {
        const lineNotes = notesByLine.get(li) ?? [];
        return (
          <div key={li}>
            <div
              className={`sheet-line ${line.kind === "heading" ? "font-bold" : ""} ${
                line.underline ? "underline" : ""
              } ${line.kind === "question-number" ? "text-blue-800" : ""}`}
            >
              {line.runs.map((run, ri) => (
                <span key={ri}>
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
              ))}
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
