import { NextRequest, NextResponse } from "next/server";
import { originFromRequest } from "@/lib/calendar";
import { googleConfigured, googleConsentUrl, plainPage, verifyUser } from "@/lib/google";
import { getUserById } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The link Buffer hands out: checks it is really this person's, then sends them to Google's consent screen. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const userId = q.get("u") || "";
  const sig = q.get("s") || "";
  if (!googleConfigured()) return plainPage("google calendar is not set up on this Buffer yet.", 503);
  if (!userId || !verifyUser(userId, sig)) return plainPage("that link is not valid.", 400);
  if (!(await getUserById(userId))) return plainPage("i don't know that person any more. say hi to Buffer again first.", 404);
  return NextResponse.redirect(googleConsentUrl(originFromRequest(req), userId));
}
