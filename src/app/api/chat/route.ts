import { NextRequest, NextResponse } from "next/server";
import { getUserById, mergeIncomingUser, upsertUser } from "@/lib/store";
import { dueReminders, processTurn } from "@/lib/bot";
import type { UserRecord } from "@/lib/types";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    text?: string;
    user?: UserRecord;
    userId?: string;
  };
  const user =
    body.user ? mergeIncomingUser(body.user) : body.userId ? getUserById(body.userId) : undefined;
  if (!user) {
    return NextResponse.json({ error: "No user session." }, { status: 401 });
  }
  const text = (body.text || "").trim();
  if (!text) {
    return NextResponse.json({ error: "Empty message." }, { status: 400 });
  }
  const result = processTurn(user, text);
  const saved = upsertUser(result.user);
  return NextResponse.json({ user: saved, replies: result.replies });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as { user?: UserRecord };
  if (!body.user) return NextResponse.json({ error: "Missing user" }, { status: 400 });
  const saved = mergeIncomingUser(body.user);
  return NextResponse.json({ user: saved });
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const user = getUserById(userId);
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
  const extra = dueReminders(user);
  if (extra.length) {
    const saved = upsertUser({
      ...user,
      messages: [...user.messages, ...extra],
      remindedEventIds: [
        ...user.remindedEventIds,
        ...user.events
          .filter((e) => extra.some((m) => m.text.includes(`"${e.title}"`)))
          .map((e) => e.id),
      ],
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ user: saved, reminders: extra });
  }
  return NextResponse.json({ user, reminders: [] });
}
