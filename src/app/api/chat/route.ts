import { NextRequest, NextResponse } from "next/server";
import { getUserById, mergeIncomingUser, upsertUser } from "@/lib/store";
import { processTurn } from "@/lib/bot";
import { proactive } from "@/lib/proactive";
import type { UserRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    text?: string;
    user?: UserRecord;
    userId?: string;
  };
  const user = body.user
    ? await mergeIncomingUser(body.user)
    : body.userId
      ? await getUserById(body.userId)
      : undefined;
  if (!user) {
    return NextResponse.json({ error: "No user session." }, { status: 401 });
  }
  const text = (body.text || "").trim();
  if (!text) {
    return NextResponse.json({ error: "Empty message." }, { status: 400 });
  }
  const result = await processTurn(user, text);
  const saved = await upsertUser(result.user);
  return NextResponse.json({ user: saved, replies: result.replies });
}

/** The client polls with its whole copy of the user, so a fresh serverless instance still knows them. */
export async function PUT(req: NextRequest) {
  const body = (await req.json()) as { user?: UserRecord; poll?: boolean };
  if (!body.user) return NextResponse.json({ error: "Missing user" }, { status: 400 });
  const saved = await mergeIncomingUser(body.user);
  if (!body.poll) return NextResponse.json({ user: saved });
  return NextResponse.json(await proactive(saved));
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const user = await getUserById(userId);
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(await proactive(user));
}
