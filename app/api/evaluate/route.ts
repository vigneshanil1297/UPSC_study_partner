import { NextRequest, NextResponse } from "next/server";
import { MODEL_EVALUATE } from "@/lib/gemini";
import { generateStructured, CLAUDE_OPUS } from "@/lib/llm";
import {
  EvalResultSchema,
  StructuredPageSchema,
  QuestionSchema,
  isPsir,
  type EvalMode,
  type Subject,
} from "@/lib/criteria";
import { EVAL_RESPONSE_SCHEMA } from "@/lib/eval-schema";
import { evaluationSystem, evaluationUser } from "@/lib/prompts";
import { loadExemplars } from "@/lib/exemplars";
import { requireUser } from "@/lib/auth-server";
import { z } from "zod";

export const runtime = "nodejs";
// Vercel Hobby plan caps function duration at 60s; 120 is silently ignored
// there. Match the real limit so behavior is honest.
export const maxDuration = 60;

// Diagram crops to evaluate visually. The client caps the count and downscales
// each PNG so the request stays under Vercel's body limit. `png` is a data URL.
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

// Split a data URL ("data:image/png;base64,AAAA") into an LlmPart image, or null
// if it isn't a well-formed base64 data URL.
function dataUrlToImagePart(png: string): { image: { mediaType: string; data: string } } | null {
  const m = png.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!m) return null;
  return { image: { mediaType: m[1], data: m[2] } };
}

export async function POST(req: NextRequest) {
  try {
    if (!(await requireUser(req))) {
      return NextResponse.json({ error: "Not authorized." }, { status: 401 });
    }
    const body = RequestSchema.safeParse(await req.json());
    if (!body.success || !body.data.pages.length) {
      return NextResponse.json({ error: "No answer pages provided." }, { status: 400 });
    }
    const { mode, subject = "gs1", questions = [], pages, diagrams = [] } = body.data;
    const subj: Subject = subject;
    // PSIR is always analytical (gs-style); only GS1 honours the essay/gs toggle.
    const evalMode: EvalMode = isPsir(subj) ? "gs" : mode === "gs" ? "gs" : "essay";

    // Use the first question's text (or all) as the topic hint for exemplar retrieval.
    const topicHint = questions.map((q) => q.text).join(" ");
    const exemplars = await loadExemplars(topicHint, evalMode, subj);

    // Diagram crops the candidate drew, to be judged visually. Keep only those
    // that parse as image data URLs; build a parallel manifest so the model can
    // attribute each image (read in order) to its question + caption.
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
      // Low temperature so the same answer scores reproducibly run-to-run.
      temperature: 0.2,
    });
    const parsed = EvalResultSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return NextResponse.json({ error: "Model returned malformed evaluation. Try again." }, { status: 502 });
    }

    return NextResponse.json({ result: parsed.data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Evaluation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
