import { NextRequest, NextResponse } from "next/server";
import { getUserById, mergeIncomingUser, upsertUser } from "@/lib/store";
import { dailyDigest, dueReminders, processTurn } from "@/lib/bot";
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

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as { user?: UserRecord };
  if (!body.user) return NextResponse.json({ error: "Missing user" }, { status: 400 });
  const saved = await mergeIncomingUser(body.user);
  return NextResponse.json({ user: saved });
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const user = await getUserById(userId);
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
  const extra = dueReminders(user);
  const digest = dailyDigest(user);
  if (digest.message) extra.unshift(digest.message);
  if (extra.length) {
    const extraIds = new Set(user.remindedEventIds);
    for (const e of user.events) {
      if (extra.some((m) => m.text.includes(`*${e.title}*`))) {
        extraIds.add(e.id);
        extraIds.add(`pre:${e.id}`);
      }
    }
    const saved = await upsertUser({
      ...user,
      ...(digest.patch ?? {}),
      messages: [...user.messages, ...extra],
      remindedEventIds: [...extraIds],
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ user: saved, reminders: extra });
  }
  return NextResponse.json({ user, reminders: [] });
}
