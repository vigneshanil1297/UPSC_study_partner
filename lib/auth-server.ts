import { createClient } from "@supabase/supabase-js";

// Server-side auth guard for the API routes that spend the Gemini key. The
// caller sends their Supabase session JWT as a Bearer token; we verify it with
// Supabase and confirm the email is on the allowlist. This is the real misuse
// protection — the sign-in wall on the UI is only the first layer.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const ALLOWED = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export type AuthedUser = { id: string; email: string };

// Local-dev escape hatch: skip Google sign-in entirely. Gated on a non-prod
// build AND an explicit flag, so the deployed app is never affected even if the
// env var leaks. Mirrors NEXT_PUBLIC_DEV_NO_AUTH on the client (app/page.tsx).
const DEV_NO_AUTH =
  process.env.NODE_ENV !== "production" &&
  (process.env.NEXT_PUBLIC_DEV_NO_AUTH === "1" || process.env.DEV_NO_AUTH === "1");

// Returns the authenticated, allowlisted user, or null to reject. Fails closed:
// if Supabase env or the allowlist is missing, no one gets in.
export async function requireUser(req: Request): Promise<AuthedUser | null> {
  if (DEV_NO_AUTH) return { id: "dev-user", email: "dev@localhost" };
  if (!url || !key || ALLOWED.length === 0) return null;

  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;

  const supabase = createClient(url, key);
  const { data, error } = await supabase.auth.getUser(token);
  const email = data.user?.email?.toLowerCase();
  if (error || !email || !ALLOWED.includes(email)) return null;

  return { id: data.user!.id, email };
}
