"use client";

import { useState } from "react";
import { CRITERIA, type Evaluation, type EvalMode } from "@/lib/criteria";

type ImageInput = { media_type: string; data: string };

function fileToImageInput(file: File): Promise<ImageInput> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string; // data:<mime>;base64,<data>
      const data = result.split(",")[1] ?? "";
      resolve({ media_type: file.type, data });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function scoreColor(score: number, max: number) {
  const pct = score / max;
  if (pct >= 0.75) return "text-emerald-700";
  if (pct >= 0.5) return "text-amber-600";
  return "text-red-600";
}

export default function Home() {
  const [mode, setMode] = useState<EvalMode>("essay");
  const [topic, setTopic] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [transcript, setTranscript] = useState("");
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [busy, setBusy] = useState<"transcribe" | "evaluate" | null>(null);
  const [error, setError] = useState("");

  async function handleTranscribe() {
    setError("");
    if (!files.length) {
      setError("Add at least one image of the answer sheet.");
      return;
    }
    setBusy("transcribe");
    try {
      const images = await Promise.all(files.map(fileToImageInput));
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Transcription failed.");
      setTranscript(json.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transcription failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleEvaluate() {
    setError("");
    if (!transcript.trim()) {
      setError("Transcribe (or paste) the essay first.");
      return;
    }
    setBusy("evaluate");
    setEvaluation(null);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, essay: transcript, mode }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Evaluation failed.");
      setEvaluation(json.evaluation as Evaluation);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Evaluation failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="text-2xl font-bold">UPSC Mains Essay Evaluator</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Upload handwritten answer pages, review the transcript, then get critical, criterion-wise feedback.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 0. Mode toggle */}
      <section className="mt-8">
        <label className="block text-sm font-semibold">Evaluation mode</label>
        <div className="mt-1 inline-flex rounded-md border border-neutral-300 bg-white p-0.5">
          {(["essay", "gs"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded px-4 py-1.5 text-sm font-medium transition ${
                mode === m ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900"
              }`}
            >
              {m === "essay" ? "Essay paper" : "GS answer"}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          {mode === "essay"
            ? "Judged as flowing prose — narrative, thesis, multidimensional canvas."
            : "Judged as a GS analytical answer — structure, headings, diagrams, directive compliance."}
        </p>
      </section>

      {/* 1. Topic */}
      <section className="mt-6">
        <label className="block text-sm font-semibold">
          {mode === "essay" ? "Essay topic (optional)" : "Question (optional)"}
        </label>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={
            mode === "essay"
              ? "e.g. Forests are the best case studies for economic excellence"
              : "e.g. Evaluate the role of subsidiary alliance in expanding British control in India."
          }
          className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
        />
      </section>

      {/* 2. Upload + transcribe */}
      <section className="mt-6">
        <label className="block text-sm font-semibold">Answer sheet images (pages in order)</label>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="mt-1 block w-full text-sm"
        />
        {files.length > 0 && (
          <p className="mt-1 text-xs text-neutral-500">{files.length} page(s) selected</p>
        )}
        <button
          onClick={handleTranscribe}
          disabled={busy !== null}
          className="mt-3 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy === "transcribe" ? "Transcribing…" : "Transcribe"}
        </button>
      </section>

      {/* 3. Editable transcript */}
      <section className="mt-6">
        <label className="block text-sm font-semibold">Transcript (edit any mis-reads before evaluating)</label>
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          rows={12}
          placeholder="Transcribed essay appears here. You can also paste text directly."
          className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm"
        />
        <button
          onClick={handleEvaluate}
          disabled={busy !== null}
          className="mt-3 rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy === "evaluate" ? "Evaluating…" : mode === "essay" ? "Evaluate essay" : "Evaluate answer"}
        </button>
      </section>

      {/* 4. Results */}
      {evaluation && (
        <section className="mt-10">
          <div className="rounded-lg border border-neutral-300 bg-white p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-bold">Overall</h2>
              <span className={`text-2xl font-bold ${scoreColor(evaluation.overall_score, 100)}`}>
                {evaluation.overall_score}/100
              </span>
            </div>
            <p className="mt-2 text-sm italic text-neutral-700">{evaluation.one_line_verdict}</p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold text-emerald-700">Strengths</h3>
                <ul className="mt-1 list-disc pl-5 text-sm text-neutral-700">
                  {evaluation.top_strengths.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-red-600">Priorities</h3>
                <ul className="mt-1 list-disc pl-5 text-sm text-neutral-700">
                  {evaluation.top_priorities.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {CRITERIA.map((c) => {
              const r = evaluation.criteria[c.key];
              if (!r) return null;
              return (
                <div key={c.key} className="rounded-lg border border-neutral-200 bg-white p-4">
                  <div className="flex items-baseline justify-between">
                    <h3 className="font-semibold">{c.label}</h3>
                    <span className={`font-bold ${scoreColor(r.score, 10)}`}>{r.score}/10</span>
                  </div>
                  {r.evidence && (
                    <blockquote className="mt-2 border-l-2 border-neutral-300 pl-3 text-sm italic text-neutral-600">
                      “{r.evidence}”
                    </blockquote>
                  )}
                  <p className="mt-2 text-sm text-neutral-800">{r.critique}</p>
                  <p className="mt-1 text-sm text-emerald-800">
                    <span className="font-medium">Improve:</span> {r.improvement}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
