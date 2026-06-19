"use client";

import type { AnswerEvaluation } from "@/lib/criteria";
import { STRUCTURE_BENCHMARK, type StructureStats } from "@/lib/structure";

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
// A 3-segment bar showing an intro/body/conclusion spatial split.
function RatioBar({ intro, body, conclusion }: { intro: number; body: number; conclusion: number }) {
  const seg = (w: number, cls: string, label: string) =>
    w > 0.001 ? (
      <div className={cls} style={{ width: `${w * 100}%` }} title={`${label} ${Math.round(w * 100)}%`} />
    ) : null;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded">
      {seg(intro, "bg-sky-400", "Intro")}
      {seg(body, "bg-emerald-500", "Body")}
      {seg(conclusion, "bg-amber-400", "Conclusion")}
    </div>
  );
}

export default function DemandChecklist({
  ev,
  structure,
}: {
  ev: AnswerEvaluation;
  structure?: StructureStats;
}) {
  const core = coreLabel[ev.core_demand_met];
  const b = STRUCTURE_BENCHMARK;
  const targetPoints = ev.max_score >= 15 ? b.pointsPer15 : b.pointsPer10;
  const showStructure = structure && structure.intro + structure.body + structure.conclusion > 0;
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

      {(showStructure || ev.structure_note) && (
        <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Structure vs topper benchmark
          </h4>
          {showStructure && structure && (
            <div className="mt-2 space-y-2">
              <p className="text-sm text-neutral-700">
                <span className="font-medium">{structure.points} points</span> — topper avg ~{targetPoints} for a{" "}
                {ev.max_score >= 15 ? "15" : "10"}-marker.
              </p>
              <div>
                <div className="mb-0.5 flex justify-between text-[11px] text-neutral-500">
                  <span>Your spacing (intro/body/conclusion)</span>
                  <span>
                    {Math.round(structure.intro * 100)}/{Math.round(structure.body * 100)}/
                    {Math.round(structure.conclusion * 100)}%
                  </span>
                </div>
                <RatioBar intro={structure.intro} body={structure.body} conclusion={structure.conclusion} />
              </div>
              <div>
                <div className="mb-0.5 flex justify-between text-[11px] text-neutral-500">
                  <span>Topper benchmark</span>
                  <span>
                    {Math.round(b.intro * 100)}/{Math.round(b.body * 100)}/{Math.round(b.conclusion * 100)}%
                  </span>
                </div>
                <RatioBar intro={b.intro} body={b.body} conclusion={b.conclusion} />
              </div>
            </div>
          )}
          {ev.structure_note && <p className="mt-2 text-sm italic text-neutral-600">{ev.structure_note}</p>}
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
