"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  Annotation,
  EvalMode,
  EvalResult,
  Question,
  StructuredPage,
} from "@/lib/criteria";
import { renderPdfToImages, type ImageInput } from "@/lib/pdf";
import AnswerSheet from "@/app/components/AnswerSheet";
import DemandChecklist from "@/app/components/DemandChecklist";
import {
  supabase,
  historyEnabled,
  signInWithGoogle,
  signOut,
  getAccessToken,
  fetchHistory,
  saveEvaluation,
  type EvalRecord,
} from "@/lib/supabase";

// Run async tasks with a small concurrency cap — keeps us under Gemini's
// free-tier rate limit while still transcribing pages in parallel.
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export default function Home() {
  const [mode, setMode] = useState<EvalMode>("essay");
  const [topic, setTopic] = useState("");
  const [answerFiles, setAnswerFiles] = useState<File[]>([]);
  const [questionFiles, setQuestionFiles] = useState<File[]>([]);

  const [pages, setPages] = useState<StructuredPage[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [result, setResult] = useState<EvalResult | null>(null);

  const [busy, setBusy] = useState<"transcribe" | "evaluate" | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const [history, setHistory] = useState<EvalRecord[]>([]);
  const [user, setUser] = useState<{ email: string } | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authorized, setAuthorized] = useState<boolean | null>(null);

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

  useEffect(() => {
    if (!historyEnabled || !user) {
      setAuthorized(null);
      return;
    }
    let cancelled = false;
    getAccessToken()
      .then((token) => fetch("/api/me", { headers: { Authorization: `Bearer ${token ?? ""}` } }))
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

  // Restore a past run into the editor/viewer.
  function viewRecord(r: EvalRecord) {
    setMode(r.mode);
    setQuestions(r.questions);
    setPages(r.pages);
    setResult(r.result);
    setTopic(r.topic);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Notes grouped by page, so each AnswerSheet only gets its own annotations.
  const notesByPage = useMemo(() => {
    const m = new Map<number, Annotation[]>();
    for (const a of result?.answers ?? []) {
      for (const n of a.inline_notes) {
        const arr = m.get(n.page) ?? [];
        arr.push(n);
        m.set(n.page, arr);
      }
    }
    return m;
  }, [result]);

  async function transcribePage(image: ImageInput, pageNumber: number): Promise<StructuredPage> {
    const token = await getAccessToken();
    const res = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
      body: JSON.stringify({ image, pageNumber }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Transcription failed.");
    return json.page as StructuredPage;
  }

  async function handleTranscribe() {
    setError("");
    setResult(null);
    if (!answerFiles.length) {
      setError("Add the answer-booklet PDF.");
      return;
    }
    setBusy("transcribe");
    try {
      // 1. Render all answer PDFs to page images, numbered globally in order.
      setProgress("Rendering PDF pages…");
      const images: ImageInput[] = [];
      for (const f of answerFiles) images.push(...(await renderPdfToImages(f)));

      // 2. Transcribe each page (structured), small concurrency.
      let done = 0;
      const transcribed = await mapPool(images, 3, async (img, i) => {
        const page = await transcribePage(img, i + 1);
        done++;
        setProgress(`Transcribed ${done}/${images.length} pages…`);
        return page;
      });
      setPages(transcribed);

      // 3. Optional: extract the question paper.
      if (questionFiles.length) {
        setProgress("Reading question paper…");
        const qImages: ImageInput[] = [];
        for (const f of questionFiles) qImages.push(...(await renderPdfToImages(f)));
        const token = await getAccessToken();
        const res = await fetch("/api/extract-questions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
          body: JSON.stringify({ images: qImages }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Question extraction failed.");
        setQuestions(json.questions as Question[]);
      } else {
        setQuestions([]);
      }
      setProgress("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transcription failed.");
    } finally {
      setBusy(null);
    }
  }

  // Apply an inline correction to a run: replace its text, clear uncertainty.
  function correctRun(pageNumber: number, lineIndex: number, runIndex: number, text: string) {
    setPages((prev) =>
      prev.map((pg) => {
        if (pg.pageNumber !== pageNumber) return pg;
        const lines = pg.lines.map((ln, li) => {
          if (li !== lineIndex) return ln;
          const runs = ln.runs.map((r, ri) => (ri === runIndex ? { text, uncertain: false } : r));
          return { ...ln, runs };
        });
        return { ...pg, lines };
      }),
    );
  }

  async function handleEvaluate() {
    setError("");
    if (!pages.length) {
      setError("Transcribe the answer booklet first.");
      return;
    }
    setBusy("evaluate");
    setResult(null);
    try {
      // No question paper but a topic typed → treat it as the single question.
      const effectiveQuestions =
        questions.length || !topic.trim()
          ? questions
          : [{ number: "1", text: topic.trim(), marks: null }];

      const token = await getAccessToken();
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ mode, questions: effectiveQuestions, pages }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Evaluation failed.");
      const evalResult = json.result as EvalResult;
      setResult(evalResult);
      if (historyEnabled) {
        const title = effectiveQuestions[0]?.text ?? topic.trim();
        saveEvaluation({ mode, title, questions: effectiveQuestions, pages, result: evalResult })
          .then(refreshHistory)
          .catch(() => {});
      }
      if (typeof window !== "undefined") {
        document.getElementById("evaluations")?.scrollIntoView({ behavior: "smooth" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Evaluation failed.");
    } finally {
      setBusy(null);
    }
  }

  if (!authReady) {
    return <main className="mx-auto max-w-3xl px-5 py-10 text-sm text-neutral-500">Loading…</main>;
  }

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
        Upload the answer-booklet PDF (and optionally the question paper). It transcribes into a
        digital answer-sheet you can correct, then marks it inline like an examiner.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Mode toggle */}
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
      </section>

      {/* Uploads */}
      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-semibold">Answer booklet (PDF)</label>
          <input
            type="file"
            accept="application/pdf"
            multiple
            onChange={(e) => setAnswerFiles(Array.from(e.target.files ?? []))}
            className="mt-1 block w-full text-sm"
          />
          {answerFiles.length > 0 && (
            <p className="mt-1 text-xs text-neutral-500">{answerFiles.length} PDF(s)</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-semibold">Question paper (PDF, optional)</label>
          <input
            type="file"
            accept="application/pdf"
            multiple
            onChange={(e) => setQuestionFiles(Array.from(e.target.files ?? []))}
            className="mt-1 block w-full text-sm"
          />
          {questionFiles.length > 0 && (
            <p className="mt-1 text-xs text-neutral-500">{questionFiles.length} PDF(s)</p>
          )}
        </div>
      </section>

      {/* Topic fallback when no question paper is uploaded */}
      {questionFiles.length === 0 && (
        <section className="mt-4">
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
      )}

      <button
        onClick={handleTranscribe}
        disabled={busy !== null}
        className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy === "transcribe" ? "Transcribing…" : "Transcribe"}
      </button>
      {progress && <span className="ml-3 text-xs text-neutral-500">{progress}</span>}

      {/* Extracted questions */}
      {questions.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold">Questions detected ({questions.length})</h2>
          <ul className="mt-2 space-y-1 rounded-md border border-neutral-200 bg-white p-3 text-sm">
            {questions.map((q) => (
              <li key={q.number}>
                <span className="font-medium">Q{q.number}</span>
                {q.marks ? <span className="text-neutral-400"> ({q.marks})</span> : null} — {q.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Digital answer-sheet pages */}
      {pages.length > 0 && (
        <section className="mt-8">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-bold">Answer sheet</h2>
            <span className="text-xs text-neutral-500">
              Highlighted words are uncertain — click to correct before evaluating.
            </span>
          </div>
          <div className="mt-3 space-y-6">
            {pages.map((page) => (
              <AnswerSheet
                key={page.pageNumber}
                page={page}
                notes={notesByPage.get(page.pageNumber)}
                onCorrect={(li, ri, text) => correctRun(page.pageNumber, li, ri, text)}
              />
            ))}
          </div>

          <button
            onClick={handleEvaluate}
            disabled={busy !== null}
            className="mt-5 rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === "evaluate" ? "Evaluating…" : "Evaluate"}
          </button>
        </section>
      )}

      {/* Per-answer evaluation */}
      {result && (
        <section id="evaluations" className="mt-10">
          <h2 className="text-lg font-bold">Evaluation</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Red notes appear in the margins above; the focus below is what to add for extra marks.
          </p>
          <div className="mt-3 space-y-4">
            {result.answers.map((ev, i) => (
              <DemandChecklist key={i} ev={ev} />
            ))}
          </div>
        </section>
      )}

      {/* History */}
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
                  <span className="shrink-0 font-bold text-neutral-800">{r.overall_score}/100</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
