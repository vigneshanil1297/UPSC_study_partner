"use client";

import { useEffect, useMemo, useState } from "react";
import {
  SUBJECTS,
  isPsir,
  type Annotation,
  type EvalMode,
  type EvalResult,
  type Question,
  type StructuredPage,
  type Subject,
} from "@/lib/criteria";
import { renderPdfToImages, cropDiagramToPng, downscaleDataUrl, type ImageInput, type RenderedPage } from "@/lib/pdf";
import { computeStructure } from "@/lib/structure";
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
  deleteEvaluation,
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

// Parse an API response safely. Our routes return JSON, but Vercel can serve a
// plain-text/HTML error page ("An error occurred…") on a function timeout or
// platform error. Blindly calling res.json() on that throws "Unexpected token",
// masking the real failure — so read the text, try to parse, and fall back to a
// status-based message when it isn't JSON.
async function readJson(res: Response, fallback: string): Promise<any> {
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body (e.g. a gateway/timeout page) — surface a clean message.
    throw new Error(
      res.status === 504 || res.status === 502
        ? "Server timed out (free-tier limit). Try fewer pages or retry."
        : `${fallback} (HTTP ${res.status}).`,
    );
  }
  if (!res.ok) throw new Error(json?.error ?? `${fallback} (HTTP ${res.status}).`);
  return json;
}

// Local-dev escape hatch: with NEXT_PUBLIC_DEV_NO_AUTH=1 the Google sign-in
// wall is skipped so you can use the app without OAuth. The server mirrors this
// (lib/auth-server.ts) and both sides additionally require a non-production
// build, so this can never open up the deployed app.
const DEV_NO_AUTH = process.env.NEXT_PUBLIC_DEV_NO_AUTH === "1";

export default function Home() {
  const [subject, setSubject] = useState<Subject>("gs1");
  const [topic, setTopic] = useState("");
  // All three papers (GS Paper I, PSIR Paper 1/2) are evaluated as analytical
  // answer-writing. The Essay paper is a separate UPSC paper, handled elsewhere.
  const psir = isPsir(subject);
  const effectiveMode: EvalMode = "gs";
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
    setSubject(r.subject ?? "gs1");
    setQuestions(r.questions);
    setPages(r.pages);
    setResult(r.result);
    setTopic(r.topic);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function removeRecord(r: EvalRecord) {
    if (typeof window !== "undefined" && !window.confirm(`Delete "${r.topic || "(untitled)"}"?`)) {
      return;
    }
    setHistory((h) => h.filter((x) => x.id !== r.id));
    try {
      await deleteEvaluation(r.id);
    } catch {
      // Restore on failure so the list reflects reality.
      setHistory(await fetchHistory());
    }
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

  // Candidate structure stats (points + intro/body/conclusion spatial ratio)
  // per answer, keyed by question number, for the benchmark comparison (req 6).
  const structureByQ = useMemo(() => {
    const groups = new Map<string, StructuredPage[]>();
    for (const pg of pages) {
      const key = pg.questionNumber ?? "?";
      const arr = groups.get(key) ?? [];
      arr.push(pg);
      groups.set(key, arr);
    }
    const m = new Map<string, ReturnType<typeof computeStructure>>();
    for (const [k, pgs] of groups) m.set(k, computeStructure(pgs));
    return m;
  }, [pages]);

  async function transcribePage(image: ImageInput, pageNumber: number): Promise<StructuredPage> {
    const token = await getAccessToken();
    const res = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
      body: JSON.stringify({ image, pageNumber }),
    });
    const json = await readJson(res, "Transcription failed.");
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
      // 1. Render all answer PDFs to page images (with dims), numbered in order.
      setProgress("Rendering PDF pages…");
      const rendered: RenderedPage[] = [];
      for (const f of answerFiles) rendered.push(...(await renderPdfToImages(f)));

      // 2. Transcribe each page (structured), small concurrency. Then keep the
      //    page's true aspect ratio and crop any diagrams out of the scan,
      //    masking the paper so they paste in as clean figures (req 4, 5).
      let done = 0;
      const transcribed = await mapPool(rendered, 1, async (rp, i) => {
        const page = await transcribePage(rp.input, i + 1);
        page.aspect = rp.height / rp.width;
        await Promise.all(
          (page.diagrams ?? []).map(async (d) => {
            try {
              const png = await cropDiagramToPng(rp.input, d.box);
              if (png) d.png = png;
            } catch {
              // Leave png unset → a captioned placeholder renders instead.
            }
          }),
        );
        done++;
        setProgress(`Transcribed ${done}/${rendered.length} pages…`);
        return page;
      });
      setPages(transcribed);

      // 3. Optional: extract the question paper.
      if (questionFiles.length) {
        setProgress("Reading question paper…");
        const qImages: ImageInput[] = [];
        for (const f of questionFiles) {
          qImages.push(...(await renderPdfToImages(f)).map((rp) => rp.input));
        }
        const token = await getAccessToken();
        const res = await fetch("/api/extract-questions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
          body: JSON.stringify({ images: qImages }),
        });
        const json = await readJson(res, "Question extraction failed.");
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
          const runs = ln.runs.map((r, ri) => (ri === runIndex ? { ...r, text, uncertain: false } : r));
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

      // Strip the (large, base64) diagram PNGs out of the page payload — the
      // text/structure path doesn't need them, and they'd bloat the body. The
      // crops are sent separately, capped + downscaled, for visual evaluation.
      const leanPages = pages.map((p) => ({
        ...p,
        diagrams: p.diagrams.map((d) => ({ box: d.box, caption: d.caption })),
      }));

      // Collect the drawn diagrams (those that cropped successfully), cap the
      // count, and downscale each so the request stays under Vercel's body cap.
      const MAX_EVAL_DIAGRAMS = 6;
      const rawDiagrams = pages.flatMap((p) =>
        p.diagrams
          .filter((d) => d.png)
          .map((d) => ({ page: p.pageNumber, questionNumber: p.questionNumber, caption: d.caption, png: d.png! })),
      );
      const diagrams = await Promise.all(
        rawDiagrams.slice(0, MAX_EVAL_DIAGRAMS).map(async (d) => ({
          ...d,
          png: await downscaleDataUrl(d.png),
        })),
      );

      const token = await getAccessToken();
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ mode: effectiveMode, subject, questions: effectiveQuestions, pages: leanPages, diagrams }),
      });
      const json = await readJson(res, "Evaluation failed.");
      const evalResult = json.result as EvalResult;
      setResult(evalResult);
      if (historyEnabled && !DEV_NO_AUTH) {
        const title = effectiveQuestions[0]?.text ?? topic.trim();
        saveEvaluation({ mode: effectiveMode, subject, title, questions: effectiveQuestions, pages, result: evalResult })
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

  if (historyEnabled && !user && !DEV_NO_AUTH) {
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

  if (historyEnabled && user && authorized !== true && !DEV_NO_AUTH) {
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

      {/* Paper / subject selector */}
      <section className="mt-8">
        <label className="block text-sm font-semibold">Paper</label>
        <div className="mt-1 inline-flex rounded-md border border-neutral-300 bg-white p-0.5">
          {SUBJECTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSubject(s.key)}
              className={`rounded px-4 py-1.5 text-sm font-medium transition ${
                subject === s.key ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {psir && (
          <p className="mt-1 text-xs text-neutral-500">
            PSIR optional — answers marked against the PSIR syllabus & thinker/debate playbook.
          </p>
        )}
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
            className="mt-1 block w-full text-sm text-neutral-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-neutral-900 file:px-4 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-neutral-700"
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
            className="mt-1 block w-full text-sm text-neutral-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-neutral-900 file:px-4 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-neutral-700"
          />
          {questionFiles.length > 0 && (
            <p className="mt-1 text-xs text-neutral-500">{questionFiles.length} PDF(s)</p>
          )}
        </div>
      </section>

      {/* Topic fallback when no question paper is uploaded */}
      {questionFiles.length === 0 && (
        <section className="mt-4">
          <label className="block text-sm font-semibold">Question (optional)</label>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={
              psir
                ? "e.g. Critically examine Rawls's theory of justice and its communitarian critiques."
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
      {result && result.answers && (
        <section id="evaluations" className="mt-10">
          <h2 className="text-lg font-bold">Evaluation</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Red notes appear in the margins above; the focus below is what to add for extra marks.
          </p>
          <div className="mt-3 space-y-4">
            {result.answers.map((ev, i) => (
              <DemandChecklist
                key={i}
                ev={ev}
                structure={ev.questionNumber ? structureByQ.get(ev.questionNumber) : undefined}
              />
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
              <li key={r.id} className="flex items-center hover:bg-neutral-50">
                <button
                  onClick={() => viewRecord(r)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-neutral-800">
                      {r.topic || "(untitled)"}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {isPsir(r.subject ?? "gs1")
                        ? SUBJECTS.find((s) => s.key === r.subject)?.label
                        : r.mode === "essay"
                          ? "Essay"
                          : "GS"}{" "}
                      · {new Date(r.created_at).toLocaleString()}
                    </span>
                  </span>
                  <span className="shrink-0 font-bold text-neutral-800">{r.overall_score}/100</span>
                </button>
                <button
                  onClick={() => removeRecord(r)}
                  aria-label="Delete evaluation"
                  title="Delete"
                  className="shrink-0 px-3 py-3 text-neutral-400 hover:text-red-600"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
