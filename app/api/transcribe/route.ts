import { NextRequest, NextResponse } from "next/server";
import { Type } from "@google/genai";
import { MODEL_TRANSCRIBE } from "@/lib/gemini";
import { generateStructured, CLAUDE_SONNET } from "@/lib/llm";
import { TRANSCRIBE_SYSTEM } from "@/lib/prompts";
import { StructuredPageSchema } from "@/lib/criteria";
import { requireUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const maxDuration = 60;

type ImageInput = { media_type: string; data: string };

const ALLOWED = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

// Box [ymin, xmin, ymax, xmax], each 0–1000.
const BOX = {
  type: Type.OBJECT,
  properties: {
    ymin: { type: Type.NUMBER },
    xmin: { type: Type.NUMBER },
    ymax: { type: Type.NUMBER },
    xmax: { type: Type.NUMBER },
  },
  required: ["ymin", "xmin", "ymax", "xmax"],
};

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
          kind: { type: Type.STRING, enum: ["heading", "body", "question-number", "note", "divider"] },
          underline: { type: Type.BOOLEAN },
          align: { type: Type.STRING, enum: ["left", "center", "right"] },
          section: { type: Type.STRING, enum: ["intro", "body", "conclusion"], nullable: true },
          box: { ...BOX, nullable: true },
          runs: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING },
                uncertain: { type: Type.BOOLEAN },
                underline: { type: Type.BOOLEAN },
                strike: { type: Type.BOOLEAN },
              },
              required: ["text", "uncertain", "underline", "strike"],
            },
          },
        },
        required: ["kind", "underline", "align", "section", "box", "runs"],
      },
    },
    diagrams: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          box: BOX,
          caption: { type: Type.STRING, nullable: true },
        },
        required: ["box", "caption"],
      },
    },
  },
  required: ["pageNumber", "questionNumber", "lines", "diagrams"],
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

    const raw = await generateStructured({
      system: TRANSCRIBE_SYSTEM,
      parts: [
        { image: { mediaType: image.media_type, data: image.data } },
        { text: `Transcribe this answer-sheet page. It is page ${pageNumber ?? 1}.` },
      ],
      geminiSchema: RESPONSE_SCHEMA,
      zodSchema: StructuredPageSchema,
      geminiModel: MODEL_TRANSCRIBE,
      claudeModel: CLAUDE_SONNET,
      maxOutputTokens: 12000,
    });
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
