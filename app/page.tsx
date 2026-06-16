"use client";

import { useEffect, useState } from "react";
import { CRITERIA, type Evaluation, type EvalMode } from "@/lib/criteria";
import {
  supabase,
  historyEnabled,
  fetchHistory,
  saveEvaluation,
  recordToEvaluation,
  signInWithGoogle,
  signOut,
  getAccessToken,
  type EvalRecord,
} from "@/lib/supabase";

type ImageInput = { media_type: string; data: string };

// Vercel serverless caps the request body at ~4.5MB regardless of
// next.config bodySizeLimit, so phone photos must be shrunk client-side before
// upload. Downscale to a max dimension and re-encode as JPEG — Gemini reads the
// handwriting fine at this resolution and the payload stays well under the cap.
const MAX_DIM = 1600;
const JPEG_QUALITY = 0.82;

function compressImage(file: File): Promise<ImageInput> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas not supported in this browser."));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      resolve({ media_type: "image/jpeg", data: dataUrl.split(",")[1] ?? "" });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read one of the images."));
    };
    img.src = url;
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
  const [history, setHistory] = useState<EvalRecord[]>([]);
  const [user, setUser] = useState<{ email: string } | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  // Track the Google sign-in session. When Supabase isn't configured, skip auth
  // entirely (local dev fallback) so the app still runs.
  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ? { email: data.session.user.email ?? "" } : null);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ? { email: session.user.email ?? "" } : null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Once signed in, confirm the email is on the server allowlist (via /api/me,
  // so the list never reaches the browser). Only then load history.
  useEffect(() => {
    if (!historyEnabled || !user) {
      setAuthorized(null);
      setHistory([]);
      return;
    }
    let cancelled = false;
    getAccessToken()
      .then((token) =>
        fetch("/api/me", { headers: { Authorization: `Bearer ${token ?? ""}` } }),
      )
      .then((res) => {
        if (cancelled) return;
        setAuthorized(res.ok);
        if (res.ok) refreshHistory();
      })
      .catch(() => !cancelled && setAuthorized(false));
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function refreshHistory() {
    try {
      setHistory(await fetchHistory());
    } catch {
      // History is best-effort; never block evaluating on it.
    }
  }

  async function handleTranscribe() {
    setError("");
    if (!files.length) {
      setError("Add at least one image of the answer sheet.");
      return;
    }
    setBusy("transcribe");
    try {
      const images = await Promise.all(files.map(compressImage));
      const token = await getAccessToken();
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
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
      const token = await getAccessToken();
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ topic, essay: transcript, mode }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Evaluation failed.");
      const ev = json.evaluation as Evaluation;
      setEvaluation(ev);
      if (historyEnabled) {
        saveEvaluation({ mode, topic, transcript, evaluation: ev })
          .then(refreshHistory)
          .catch(() => {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Evaluation failed.");
    } finally {
      setBusy(null);
    }
  }

  function viewRecord(r: EvalRecord) {
    setMode(r.mode);
    setTopic(r.topic);
    setTranscript(r.transcript);
    setEvaluation(recordToEvaluation(r));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (!authReady) {
    return <main className="mx-auto max-w-3xl px-5 py-10 text-sm text-neutral-500">Loading…</main>;
  }

  // Sign-in wall (only when Supabase auth is configured). Server API routes also
  // enforce the email allowlist, so this is the first layer, not the only one.
  if (historyEnabled && !user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-5 text-center">
        <h1 className="text-2xl font-bold">UPSC Mains Essay Evaluator</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Sign in to continue. Access is limited to authorized users.
        </p>
        <button
          onClick={() => signInWithGoogle()}
          className="mt-6 rounded-md border border-neutral-300 bg-white px-5 py-2.5 text-sm font-medium hover:bg-neutral-50"
        >
          Sign in with Google
        </button>
      </main>
    );
  }

  // Signed in but allowlist check pending / failed.
  if (historyEnabled && user && authorized !== true) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-5 text-center">
        {authorized === null ? (
          <p className="text-sm text-neutral-500">Checking access…</p>
        ) : (
          <>
            <h1 className="text-2xl font-bold">Access denied</h1>
            <p className="mt-2 text-sm text-neutral-600">
              <span className="font-medium">{user.email}</span> is not authorized to use this app.
            </p>
            <button
              onClick={() => signOut()}
              className="mt-6 rounded-md border border-neutral-300 bg-white px-5 py-2.5 text-sm font-medium hover:bg-neutral-50"
            >
              Sign out
            </button>
          </>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      {user && (
        <div className="mb-4 flex items-center justify-end gap-3 text-xs text-neutral-500">
          <span className="truncate">{user.email}</span>
          <button onClick={() => signOut()} className="font-medium text-neutral-700 hover:underline">
            Sign out
          </button>
        </div>
      )}
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

      {/* 5. History */}
      {historyEnabled && history.length > 0 && (
        <section className="mt-12 border-t border-neutral-200 pt-8">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-bold">Past evaluations</h2>
            <span className="text-xs text-neutral-500">{history.length} saved</span>
          </div>

          {/* Score trend — most recent on the right. */}
          <div className="mt-4 flex items-end gap-1.5" aria-label="Overall score trend">
            {[...history].reverse().map((r) => (
              <div
                key={r.id}
                title={`${r.overall_score}/100 — ${new Date(r.created_at).toLocaleDateString()}`}
                className="w-3 rounded-t bg-emerald-600/80"
                style={{ height: `${Math.max(4, r.overall_score)}px` }}
              />
            ))}
          </div>

          <ul className="mt-4 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
            {history.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => viewRecord(r)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-neutral-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-neutral-800">
                      {r.topic || "(untitled)"}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {r.mode === "essay" ? "Essay" : "GS"} · {new Date(r.created_at).toLocaleString()}
                    </span>
                  </span>
                  <span className={`shrink-0 font-bold ${scoreColor(r.overall_score, 100)}`}>
                    {r.overall_score}/100
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
