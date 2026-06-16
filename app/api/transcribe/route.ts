import { NextRequest, NextResponse } from "next/server";
import { getGenAI, MODEL } from "@/lib/gemini";
import { TRANSCRIBE_SYSTEM } from "@/lib/prompts";
import { requireUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const maxDuration = 60;

type ImageInput = { media_type: string; data: string };

const ALLOWED = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export async function POST(req: NextRequest) {
  try {
    if (!(await requireUser(req))) {
      return NextResponse.json({ error: "Not authorized." }, { status: 401 });
    }
    const { images } = (await req.json()) as { images?: ImageInput[] };
    if (!images?.length) {
      return NextResponse.json({ error: "No images provided." }, { status: 400 });
    }
    for (const img of images) {
      if (!ALLOWED.has(img.media_type)) {
        return NextResponse.json(
          { error: `Unsupported image type: ${img.media_type}` },
          { status: 400 },
        );
      }
    }

    const parts = [
      ...images.map((img) => ({
        inlineData: { mimeType: img.media_type, data: img.data },
      })),
      { text: "Transcribe these answer-sheet page(s) in order." },
    ];

    const res = await getGenAI().models.generateContent({
      model: MODEL,
      contents: parts,
      config: {
        systemInstruction: TRANSCRIBE_SYSTEM,
        maxOutputTokens: 8000,
      },
    });

    return NextResponse.json({ text: (res.text ?? "").trim() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
