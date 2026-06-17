import { NextRequest, NextResponse } from "next/server";
import { Type } from "@google/genai";
import { getGenAI, MODEL } from "@/lib/gemini";
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

    const res = await getGenAI().models.generateContent({
      model: MODEL,
      contents: [
        ...images.map((img) => ({ inlineData: { mimeType: img.media_type, data: img.data } })),
        { text: "Extract the question list from these question-paper page(s)." },
      ],
      config: {
        systemInstruction: EXTRACT_QUESTIONS_SYSTEM,
        maxOutputTokens: 8000,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const raw = res.text;
    if (!raw) {
      return NextResponse.json({ error: "Empty response from model. Try again." }, { status: 502 });
    }
    const parsed = z.object({ questions: z.array(QuestionSchema) }).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return NextResponse.json({ error: "Model returned malformed questions. Try again." }, { status: 502 });
    }

    return NextResponse.json({ questions: parsed.data.questions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Question extraction failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
