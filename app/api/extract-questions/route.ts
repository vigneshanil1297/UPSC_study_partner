import { NextRequest, NextResponse } from "next/server";
import { Type } from "@google/genai";
import { MODEL_EXTRACT } from "@/lib/gemini";
import { generateStructured, CLAUDE_SONNET } from "@/lib/llm";
import { EXTRACT_QUESTIONS_SYSTEM } from "@/lib/prompts";
import { QuestionSchema } from "@/lib/criteria";
import { requireUser } from "@/lib/auth-server";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

type ImageInput = { media_type: string; data: string };

const ALLOWED = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          number: { type: Type.STRING },
          text: { type: Type.STRING },
          marks: { type: Type.NUMBER, nullable: true },
        },
        required: ["number", "text", "marks"],
      },
    },
  },
  required: ["questions"],
};

export async function POST(req: NextRequest) {
  try {
    if (!(await requireUser(req))) {
      return NextResponse.json({ error: "Not authorized." }, { status: 401 });
    }
    const { images } = (await req.json()) as { images?: ImageInput[] };
    if (!images?.length) {
      return NextResponse.json({ error: "No question-paper images provided." }, { status: 400 });
    }
    for (const img of images) {
      if (!ALLOWED.has(img.media_type)) {
        return NextResponse.json({ error: `Unsupported image type: ${img.media_type}` }, { status: 400 });
      }
    }

    const QuestionsSchema = z.object({ questions: z.array(QuestionSchema) });
    const raw = await generateStructured({
      system: EXTRACT_QUESTIONS_SYSTEM,
      parts: [
        ...images.map((img) => ({ image: { mediaType: img.media_type, data: img.data } })),
        { text: "Extract the question list from these question-paper page(s)." },
      ],
      geminiSchema: RESPONSE_SCHEMA,
      zodSchema: QuestionsSchema,
      geminiModel: MODEL_EXTRACT,
      claudeModel: CLAUDE_SONNET,
      maxOutputTokens: 8000,
    });
    const parsed = QuestionsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return NextResponse.json({ error: "Model returned malformed questions. Try again." }, { status: 502 });
    }

    return NextResponse.json({ questions: parsed.data.questions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Question extraction failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
