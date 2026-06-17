import { NextRequest, NextResponse } from "next/server";
import { Type } from "@google/genai";
import { getGenAI, MODEL_TRANSCRIBE, withRetry } from "@/lib/gemini";
import { TRANSCRIBE_SYSTEM } from "@/lib/prompts";
import { StructuredPageSchema } from "@/lib/criteria";
import { requireUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const maxDuration = 60;

type ImageInput = { media_type: string; data: string };

const ALLOWED = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

// Structured single-page transcription schema (OpenAPI subset for Gemini).
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    pageNumber: { type: Type.NUMBER },
    questionNumber: { type: Type.STRING, nullable: true },
    lines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          kind: { type: Type.STRING, enum: ["heading", "body", "question-number", "note"] },
          underline: { type: Type.BOOLEAN },
          runs: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING },
                uncertain: { type: Type.BOOLEAN },
              },
              required: ["text", "uncertain"],
            },
          },
        },
        required: ["kind", "underline", "runs"],
      },
    },
  },
  required: ["pageNumber", "questionNumber", "lines"],
};

export async function POST(req: NextRequest) {
  try {
    if (!(await requireUser(req))) {
      return NextResponse.json({ error: "Not authorized." }, { status: 401 });
    }
    const { image, pageNumber } = (await req.json()) as {
      image?: ImageInput;
      pageNumber?: number;
    };
    if (!image?.data) {
      return NextResponse.json({ error: "No page image provided." }, { status: 400 });
    }
    if (!ALLOWED.has(image.media_type)) {
      return NextResponse.json(
        { error: `Unsupported image type: ${image.media_type}` },
        { status: 400 },
      );
    }

    const res = await withRetry(() => getGenAI().models.generateContent({
      model: MODEL_TRANSCRIBE,
      contents: [
        { inlineData: { mimeType: image.media_type, data: image.data } },
        { text: `Transcribe this answer-sheet page. It is page ${pageNumber ?? 1}.` },
      ],
      config: {
        systemInstruction: TRANSCRIBE_SYSTEM,
        maxOutputTokens: 8000,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }));

    const raw = res.text;
    if (!raw) {
      return NextResponse.json({ error: "Empty response from model. Try again." }, { status: 502 });
    }
    // Force the page number the client assigned (model can miscount).
    const json = { ...JSON.parse(raw), pageNumber: pageNumber ?? 1 };
    const parsed = StructuredPageSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Model returned malformed page. Try again." }, { status: 502 });
    }

    return NextResponse.json({ page: parsed.data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
