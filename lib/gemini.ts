import { GoogleGenAI } from "@google/genai";

// Free-tier model with vision + JSON structured output.
export const MODEL = "gemini-2.5-flash";

// Lazily construct the client so importing this module (e.g. during build)
// doesn't require the key — it's only needed when a request actually runs.
// Server-only: never import from a client component, or the key leaks.
// Get a free key at https://aistudio.google.com/apikey (no billing needed).
let client: GoogleGenAI | null = null;

export function getGenAI(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set. Add it to .env.local (or Vercel env vars).");
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}
