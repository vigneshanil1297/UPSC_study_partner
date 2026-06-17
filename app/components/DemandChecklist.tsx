"use client";

import type { AnswerEvaluation } from "@/lib/criteria";

const coreLabel: Record<AnswerEvaluation["core_demand_met"], { text: string; cls: string }> = {
  met: { text: "Core demand met", cls: "bg-emerald-100 text-emerald-800" },
  partial: { text: "Core demand partly met", cls: "bg-amber-100 text-amber-800" },
  not: { text: "Core demand not met", cls: "bg-red-100 text-red-700" },
};

const statusMark = {
  hit: { icon: "✓", cls: "text-emerald-700" },
  partial: { icon: "~", cls: "text-amber-600" },
  missed: { icon: "✗", cls: "text-red-600" },
} as const;

// Per-answer summary shown beneath the answer-sheet: core-demand verdict, the
// question's own expected points (hit/partial/missed) with a score, and — the
// focus of the feedback — the 2-4 points worth adding for incremental marks.
export default function DemandChecklist({ ev }: { ev: AnswerEvaluation }) {
  const core = coreLabel[ev.core_demand_met];
  return (
    <div className="mt-3 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {ev.questionNumber && (
            <span className="text-sm font-bold text-neutral-700">Q{ev.questionNumber}</span>
          )}
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${core.cls}`}>{core.text}</span>
        </div>
        <span className="text-lg font-bold text-neutral-800">
          {ev.score}
          <span className="text-sm font-normal text-neutral-500">/{ev.max_score}</span>
        </span>
      </div>

      <p className="mt-2 text-sm italic text-neutral-600">{ev.one_line}</p>

      {ev.value_additions.length > 0 && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-red-700">
            Add these for extra marks
          </h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-red-800">
            {ev.value_additions.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        </div>
      )}

      {ev.demands.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Expected points
          </h4>
          <ul className="mt-1 space-y-0.5 text-sm">
            {ev.demands.map((d, i) => {
              const m = statusMark[d.status];
              return (
                <li key={i} className="flex gap-2">
                  <span className={`font-bold ${m.cls}`}>{m.icon}</span>
                  <span className="text-neutral-700">{d.point}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
