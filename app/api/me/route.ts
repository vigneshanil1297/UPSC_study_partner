import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";

export const runtime = "nodejs";

// Lets the client confirm the signed-in user is on the allowlist without
// shipping the email list to the browser. Returns the email if authorized,
// 401 otherwise — the UI uses this to gate access after Google sign-in.
export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  return NextResponse.json({ email: user.email });
}
