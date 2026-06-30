"use client";

import { useMemo, useState } from "react";
import { SUBJECTS, type Subject } from "@/lib/criteria";
import { buildMistakeBank, type BankSource, type MistakeCluster } from "@/lib/mistakes";

const sourceTag: Record<MistakeCluster["source"], { text: string; cls: string }> = {
  fix: { text: "Correction", cls: "bg-red-100 text-red-700" },
  missed: { text: "Missed point", cls: "bg-amber-100 text-amber-800" },
};

const subjectLabel = (s: Subject) => SUBJECTS.find((x) => x.key === s)?.label ?? s;

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// User-wide, cumulative log of every mistake flagged across all saved tests,
// with reworded repeats clustered so a recurring weakness shows up once —
// flagged "Repeated ×N" and stamped with each test + date it appeared on.
export default function MistakeBank({ sources }: { sources: BankSource[] }) {
  const clusters = useMemo(() => buildMistakeBank(sources), [sources]);
  const [expanded, setExpanded] = useState<number | null>(null);

  if (clusters.length === 0) return null;

  const repeated = clusters.filter((c) => c.occurrences.length > 1).length;

  return (
    <section className="mt-12 border-t border-neutral-200 pt-8">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold">Mistake bank</h2>
        <span className="text-xs text-neutral-500">
          {clusters.length} distinct{repeated > 0 ? ` · ${repeated} recurring` : ""}
        </span>
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        Every mistake across all your evaluated tests, kept in one running record. Repeats are merged
        and flagged — tap one to see which tests it showed up on.
      </p>

      <ul className="mt-4 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
        {clusters.map((c, i) => {
          const n = c.occurrences.length;
          const tag = sourceTag[c.source];
          const open = expanded === i;
          return (
            <li key={i}>
              <button
                onClick={() => setExpanded(open ? null : i)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-neutral-50"
              >
                <span className={`mt-0.5 shrink-0 rounded px-2 py-0.5 text-[11px] font-medium ${tag.cls}`}>
                  {tag.text}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-neutral-800">{c.label}</span>
                  <span className="mt-0.5 block text-xs text-neutral-500">
                    Last seen {dateLabel(c.lastSeen)}
                    {n > 1 ? ` · across ${n} tests` : ""}
                  </span>
                </span>
                {n > 1 && (
                  <span className="mt-0.5 shrink-0 rounded bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">
                    Repeated ×{n}
                  </span>
                )}
              </button>

              {open && (
                <ul className="space-y-1 border-t border-neutral-100 bg-neutral-50 px-4 py-2 pl-6">
                  {c.occurrences.map((o, j) => (
                    <li key={j} className="text-xs text-neutral-600">
                      <span className="font-medium text-neutral-700">{dateLabel(o.date)}</span>
                      {" · "}
                      {subjectLabel(o.subject)}
                      {o.questionNumber ? ` · Q${o.questionNumber}` : ""}
                      {" — "}
                      <span className="italic">{o.title || "(untitled test)"}</span>
                      {/* The exact wording on that test, in case it was reworded. */}
                      {o.text !== c.label && <span className="block pl-4 text-neutral-500">“{o.text}”</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
