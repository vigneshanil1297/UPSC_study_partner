import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ZodType } from "zod";
import * as z from "zod";
import { getGenAI, withRetry } from "./gemini";

// Provider-agnostic structured generation. Two backends:
//
//   - "gemini": the production path. Calls the Gemini free-tier API (needs
//     GEMINI_API_KEY) with a responseSchema for structured JSON.
//   - "claude": the local-dev path. Shells out to the `claude` CLI (Claude
//     Code) so dev runs burn the local Claude subscription instead of Gemini
//     API quota. Images are written to temp files and read via the CLI's Read
//     tool; structured output is enforced with `--json-schema`.
//
// Selection: LLM_PROVIDER=claude|gemini forces a backend. With neither set the
// default is "claude" in dev when GEMINI_API_KEY is absent, otherwise "gemini".

export type LlmPart = { text: string } | { image: { mediaType: string; data: string } };

type GenerateArgs = {
  system: string;
  parts: LlmPart[];
  // Gemini OpenAPI-subset schema (Type.*), used by the gemini backend.
  geminiSchema: unknown;
  // The zod schema the route validates against — reused to derive a JSON
  // Schema for the claude backend, so the shape lives in one place.
  zodSchema: ZodType;
  geminiModel: string;
  // Model for the claude backend (e.g. CLAUDE_SONNET / CLAUDE_OPUS). The global
  // CLAUDE_MODEL env var, if set, overrides this for every route.
  claudeModel: string;
  maxOutputTokens: number;
};

// Per-route claude models. Transcription/extraction run on sonnet (fast, good
// enough for OCR-style structured reads); the single evaluation call uses opus
// for the higher-value reasoning.
export const CLAUDE_SONNET = "claude-sonnet-4-6";
export const CLAUDE_OPUS = "claude-opus-4-8";

export function llmProvider(): "claude" | "gemini" {
  const p = process.env.LLM_PROVIDER?.toLowerCase();
  if (p === "claude" || p === "gemini") return p;
  if (process.env.NODE_ENV !== "production" && !process.env.GEMINI_API_KEY) return "claude";
  return "gemini";
}

// Returns the model output as a raw JSON string (the caller parses + validates).
export async function generateStructured(args: GenerateArgs): Promise<string> {
  return llmProvider() === "claude" ? viaClaude(args) : viaGemini(args);
}

async function viaGemini(a: GenerateArgs): Promise<string> {
  const contents = a.parts.map((p) =>
    "text" in p
      ? { text: p.text }
      : { inlineData: { mimeType: p.image.mediaType, data: p.image.data } },
  );
  const res = await withRetry(() =>
    getGenAI().models.generateContent({
      model: a.geminiModel,
      contents,
      config: {
        systemInstruction: a.system,
        maxOutputTokens: a.maxOutputTokens,
        responseMimeType: "application/json",
        responseSchema: a.geminiSchema,
      },
    }),
  );
  const raw = res.text;
  if (!raw) throw new Error("Empty response from model. Try again.");
  return raw;
}

const CLAUDE_TIMEOUT_MS = 110_000;

async function viaClaude(a: GenerateArgs): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cse-llm-"));
  try {
    // Images can't go on the CLI; write them out and have Claude Read them.
    const imageFiles: string[] = [];
    const textBlocks: string[] = [];
    for (const part of a.parts) {
      if ("text" in part) {
        textBlocks.push(part.text);
        continue;
      }
      const ext = part.image.mediaType.split("/")[1] ?? "png";
      const fp = join(dir, `img-${imageFiles.length}.${ext}`);
      await writeFile(fp, Buffer.from(part.image.data, "base64"));
      imageFiles.push(fp);
    }

    const imageInstruction = imageFiles.length
      ? `First use the Read tool to view these image file(s) in order:\n` +
        imageFiles.map((f, i) => `  ${i + 1}. ${f}`).join("\n") +
        `\n\n`
      : "";

    const prompt =
      `${a.system}\n\n${imageInstruction}${textBlocks.join("\n\n")}\n\n` +
      `Respond with ONLY the JSON object required by the provided schema — no prose, no code fences.`;

    // The `$schema` dialect marker silently disables the CLI's structured-output
    // enforcement, so strip it — without it the model reliably populates
    // `structured_output` against the schema.
    const jsonSchema = z.toJSONSchema(a.zodSchema) as Record<string, unknown>;
    delete jsonSchema["$schema"];
    const cliArgs = [
      "-p",
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(jsonSchema),
      "--permission-mode",
      "acceptEdits",
    ];
    if (imageFiles.length) cliArgs.push("--allowedTools", "Read");
    const model = process.env.CLAUDE_MODEL || a.claudeModel;
    if (model) cliArgs.push("--model", model);

    const stdout = await runClaude(cliArgs, prompt);
    let wrapper: { is_error?: boolean; result?: unknown; structured_output?: unknown };
    try {
      wrapper = JSON.parse(stdout);
    } catch {
      throw new Error("claude CLI returned non-JSON output.");
    }
    if (wrapper.is_error) {
      throw new Error(typeof wrapper.result === "string" ? wrapper.result : "claude CLI error.");
    }
    // Prefer the schema-enforced structured output. It's reliably present for
    // text-only calls, but when the Read tool runs (image inputs) the CLI often
    // skips enforcement and returns the JSON in `result` instead — sometimes
    // wrapped in a ```json fence — so fall back to extracting it from there.
    if (wrapper.structured_output !== undefined) {
      return JSON.stringify(wrapper.structured_output);
    }
    if (typeof wrapper.result === "string" && wrapper.result.trim()) {
      return extractJson(wrapper.result);
    }
    throw new Error("Empty response from claude CLI. Try again.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Pull a bare JSON object out of a model reply that may be fenced or prefixed
// with prose. Falls back to the first `{` … last `}` span.
function extractJson(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  if (!t.startsWith("{")) {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) t = t.slice(start, end + 1);
  }
  return t;
}

function runClaude(args: string[], stdinText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("claude CLI timed out."));
    }, CLAUDE_TIMEOUT_MS);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn claude CLI: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`claude CLI exited ${code}: ${stderr || stdout}`));
    });

    child.stdin.write(stdinText);
    child.stdin.end();
  });
}
