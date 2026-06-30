// Cloud Run eval service. The single high-value gemini-3.1-pro evaluation call
// can take ~4 minutes to write its full inline marking — far past Vercel Hobby's
// hard 60s function cap, which was killing every run (504 -> "Server timed out")
// while still burning a daily credit. This service hosts ONLY that one endpoint
// on Cloud Run (300s request timeout), so the browser calls it directly instead
// of /api/evaluate. Everything else (transcription, question extraction) stays
// on Vercel — those are fast flash-lite calls that fit 60s fine.
//
// It is a faithful port of app/api/evaluate/route.ts: same auth guard, same
// up-front credit consume, same prompt/exemplar assembly, same schema. The two
// new things are CORS (the browser now makes a cross-origin call) and a
// refund-on-failure so a timeout/model-error doesn't eat the user's daily 3.
import express, { type Request as ExReq, type Response as ExRes } from "express";
import { MODEL_EVALUATE } from "../../lib/gemini";
import { generateStructured, CLAUDE_OPUS } from "../../lib/llm";
import {
  EvalResultSchema,
  StructuredPageSchema,
  QuestionSchema,
  isPsir,
  type EvalMode,
  type Subject,
} from "../../lib/criteria";
import { EVAL_RESPONSE_SCHEMA } from "../../lib/eval-schema";
import { evaluationSystem, evaluationUser } from "../../lib/prompts";
import { loadExemplars } from "../../lib/exemplars";
import { requireUser } from "../../lib/auth-server";
import { consumeCredit, refundCredit } from "../../lib/eval-budget";
import { z } from "zod";

// --- request schema (identical to the Vercel route) -------------------------
const DiagramImageSchema = z.object({
  page: z.number(),
  questionNumber: z.string().nullable(),
  caption: z.string().nullable(),
  png: z.string(),
});

const RequestSchema = z.object({
  mode: z.enum(["essay", "gs"]).optional(),
  subject: z.enum(["gs1", "psir1", "psir2"]).optional(),
  questions: z.array(QuestionSchema).optional(),
  pages: z.array(StructuredPageSchema),
  diagrams: z.array(DiagramImageSchema).optional(),
});

function dataUrlToImagePart(png: string): { image: { mediaType: string; data: string } } | null {
  const m = png.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!m) return null;
  return { image: { mediaType: m[1], data: m[2] } };
}

// requireUser() reads a WHATWG Request's headers.get(); adapt the Express req so
// the exact same auth code runs unchanged.
function asFetchRequest(req: ExReq): Request {
  return {
    headers: { get: (name: string) => req.header(name) ?? null },
  } as unknown as Request;
}

// CORS: the browser calls this from the Vercel origin (set ALLOWED_ORIGIN to the
// site URL, e.g. https://upsc-study-partner.vercel.app). Allow that origin, the
// Authorization + Content-Type headers it sends, and answer the preflight.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";
function applyCors(res: ExRes) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

const app = express();
// Diagram crops ride along as base64 data URLs; the default 100kb body cap is
// far too small. The client already downscales them, but allow headroom.
app.use(express.json({ limit: "12mb" }));

// Liveness probe for Cloud Run.
app.get("/", (_req, res) => res.status(200).send("eval-run ok"));

app.options("/evaluate", (_req, res) => {
  applyCors(res);
  res.status(204).end();
});

app.post("/evaluate", async (req: ExReq, res: ExRes) => {
  applyCors(res);
  // Tracks whether we charged a credit, so the catch/early-return paths can
  // refund exactly once on a post-charge failure.
  let charged = false;
  try {
    if (!(await requireUser(asFetchRequest(req)))) {
      return res.status(401).json({ error: "Not authorized." });
    }
    const body = RequestSchema.safeParse(req.body);
    if (!body.success || !body.data.pages.length) {
      return res.status(400).json({ error: "No answer pages provided." });
    }

    // Hard spend cap: atomically consume one credit before any paid work.
    const credit = await consumeCredit("eval");
    if (!credit.ok) {
      const msg =
        credit.reason === "daily_exhausted"
          ? `Daily evaluation limit reached (${credit.daily_max}/day). Try again tomorrow.`
          : credit.reason === "total_exhausted"
            ? `Evaluation budget exhausted (${credit.total_used}/${credit.total_budget} calls used).`
            : `Evaluation temporarily unavailable (${credit.reason}).`;
      return res.status(429).json({ error: msg });
    }
    charged = true;

    const { mode, subject = "gs1", questions = [], pages, diagrams = [] } = body.data;
    const subj: Subject = subject;
    const evalMode: EvalMode = isPsir(subj) ? "gs" : mode === "gs" ? "gs" : "essay";

    const topicHint = questions.map((q) => q.text).join(" ");
    const exemplars = await loadExemplars(topicHint, evalMode, subj);

    const diagramParts = diagrams
      .map((d) => ({ d, part: dataUrlToImagePart(d.png) }))
      .filter((x): x is { d: typeof x.d; part: NonNullable<typeof x.part> } => x.part !== null);
    const diagramManifest = diagramParts.length
      ? `\n\nCANDIDATE'S DIAGRAMS (${diagramParts.length} image(s) follow, in this order — judge each and set the relevant answer's "diagram_note"):\n` +
        diagramParts
          .map(
            ({ d }, i) =>
              `  Image ${i + 1}: answer Q${d.questionNumber ?? "?"}, page ${d.page}${d.caption ? ` — captioned "${d.caption}"` : ""}`,
          )
          .join("\n")
      : "";

    const raw = await generateStructured({
      system: evaluationSystem(exemplars, evalMode, subj),
      parts: [
        { text: evaluationUser(questions, pages, evalMode, subj) + diagramManifest },
        ...diagramParts.map(({ part }) => part),
      ],
      geminiSchema: EVAL_RESPONSE_SCHEMA,
      zodSchema: EvalResultSchema,
      geminiModel: MODEL_EVALUATE,
      claudeModel: CLAUDE_OPUS,
      maxOutputTokens: 16000,
      temperature: 0.2,
    });
    const parsed = EvalResultSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      // Charged but no usable result — give the credit back, then report.
      await refundCredit("eval");
      return res.status(502).json({ error: "Model returned malformed evaluation. Try again." });
    }

    return res.status(200).json({ result: parsed.data });
  } catch (err) {
    // Any failure after the charge (model 5xx, timeout inside the budget, bad
    // JSON) refunds the credit so the user isn't billed a daily slot for it.
    if (charged) await refundCredit("eval");
    const message = err instanceof Error ? err.message : "Evaluation failed.";
    return res.status(500).json({ error: message });
  }
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => {
  console.log(`eval-run listening on :${port}`);
});
