import { NextRequest, NextResponse } from "next/server";
import { Type } from "@google/genai";
import { getGenAI, MODEL } from "@/lib/gemini";
import { CRITERIA, EvaluationSchema, type EvalMode } from "@/lib/criteria";
import { evaluationSystem, evaluationUser } from "@/lib/prompts";
import { loadExemplars } from "@/lib/exemplars";
import { requireUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const maxDuration = 120;

// Gemini response schema (OpenAPI subset). Built from CRITERIA so it can't
// drift from the Zod schema we validate against afterwards.
const criterionSchema = {
  type: Type.OBJECT,
  properties: {
    score: { type: Type.NUMBER },
    evidence: { type: Type.STRING },
    critique: { type: Type.STRING },
    improvement: { type: Type.STRING },
  },
  required: ["score", "evidence", "critique", "improvement"],
};

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    overall_score: { type: Type.NUMBER },
    one_line_verdict: { type: Type.STRING },
    criteria: {
      type: Type.OBJECT,
      properties: Object.fromEntries(CRITERIA.map((c) => [c.key, criterionSchema])),
      required: CRITERIA.map((c) => c.key),
    },
    top_strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
    top_priorities: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["overall_score", "one_line_verdict", "criteria", "top_strengths", "top_priorities"],
};

export async function POST(req: NextRequest) {
  try {
    if (!(await requireUser(req))) {
      return NextResponse.json({ error: "Not authorized." }, { status: 401 });
    }
    const { topic, essay, mode } = (await req.json()) as {
      topic?: string;
      essay?: string;
      mode?: EvalMode;
    };
    if (!essay?.trim()) {
      return NextResponse.json({ error: "No text provided." }, { status: 400 });
    }
    const evalMode: EvalMode = mode === "gs" ? "gs" : "essay";

    const exemplars = await loadExemplars(topic ?? "", evalMode);

    const res = await getGenAI().models.generateContent({
      model: MODEL,
      contents: [{ text: evaluationUser(topic ?? "", essay, evalMode) }],
      config: {
        systemInstruction: evaluationSystem(exemplars, evalMode),
        maxOutputTokens: 16000,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const raw = res.text;
    if (!raw) {
      return NextResponse.json(
        { error: "Empty response from model. Try again." },
        { status: 502 },
      );
    }

    // Validate the model's JSON against our Zod schema before trusting it.
    const parsed = EvaluationSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Model returned malformed evaluation. Try again." },
        { status: 502 },
      );
    }

    return NextResponse.json({ evaluation: parsed.data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Evaluation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
