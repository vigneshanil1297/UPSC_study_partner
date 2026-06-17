import { NextRequest, NextResponse } from "next/server";
import { Type } from "@google/genai";
import { getGenAI, MODEL } from "@/lib/gemini";
import {
  EvalResultSchema,
  StructuredPageSchema,
  QuestionSchema,
  type EvalMode,
} from "@/lib/criteria";
import { evaluationSystem, evaluationUser } from "@/lib/prompts";
import { loadExemplars } from "@/lib/exemplars";
import { requireUser } from "@/lib/auth-server";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 120;

// Gemini response schema (OpenAPI subset). One AnswerEvaluation per answered
// question; inline_notes anchored to page + lineIndex.
const answerSchema = {
  type: Type.OBJECT,
  properties: {
    questionNumber: { type: Type.STRING, nullable: true },
    core_demand_met: { type: Type.STRING, enum: ["met", "partial", "not"] },
    score: { type: Type.NUMBER },
    max_score: { type: Type.NUMBER },
    one_line: { type: Type.STRING },
    demands: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          point: { type: Type.STRING },
          status: { type: Type.STRING, enum: ["hit", "partial", "missed"] },
        },
        required: ["point", "status"],
      },
    },
    value_additions: { type: Type.ARRAY, items: { type: Type.STRING } },
    inline_notes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          page: { type: Type.NUMBER },
          lineIndex: { type: Type.NUMBER },
          type: { type: Type.STRING, enum: ["add", "fix", "praise"] },
          text: { type: Type.STRING },
        },
        required: ["page", "lineIndex", "type", "text"],
      },
    },
  },
  required: [
    "questionNumber",
    "core_demand_met",
    "score",
    "max_score",
    "one_line",
    "demands",
    "value_additions",
    "inline_notes",
  ],
};

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: { answers: { type: Type.ARRAY, items: answerSchema } },
  required: ["answers"],
};

const RequestSchema = z.object({
  mode: z.enum(["essay", "gs"]).optional(),
  questions: z.array(QuestionSchema).optional(),
  pages: z.array(StructuredPageSchema),
});

export async function POST(req: NextRequest) {
  try {
    if (!(await requireUser(req))) {
      return NextResponse.json({ error: "Not authorized." }, { status: 401 });
    }
    const body = RequestSchema.safeParse(await req.json());
    if (!body.success || !body.data.pages.length) {
      return NextResponse.json({ error: "No answer pages provided." }, { status: 400 });
    }
    const { mode, questions = [], pages } = body.data;
    const evalMode: EvalMode = mode === "gs" ? "gs" : "essay";

    // Use the first question's text (or all) as the topic hint for exemplar retrieval.
    const topicHint = questions.map((q) => q.text).join(" ");
    const exemplars = await loadExemplars(topicHint, evalMode);

    const res = await getGenAI().models.generateContent({
      model: MODEL,
      contents: [{ text: evaluationUser(questions, pages, evalMode) }],
      config: {
        systemInstruction: evaluationSystem(exemplars, evalMode),
        maxOutputTokens: 16000,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const raw = res.text;
    if (!raw) {
      return NextResponse.json({ error: "Empty response from model. Try again." }, { status: 502 });
    }
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
