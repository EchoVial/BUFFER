import { NextRequest, NextResponse } from "next/server";
import { createUser, getAppSettings, getUserById, getUserByName, upsertUser } from "@/lib/store";
import { greeting } from "@/lib/bot";

const COOKIE = "balance_user";

export async function GET(req: NextRequest) {
  const id = req.cookies.get(COOKIE)?.value;
  if (!id) return NextResponse.json({ user: null, settings: getAppSettings() });
  const user = getUserById(id);
  if (!user) {
    const res = NextResponse.json({ user: null, settings: getAppSettings() });
    res.cookies.set(COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }
  return NextResponse.json({ user, settings: getAppSettings() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { name?: string; timezone?: string };
  const name = (body.name || "").trim();
  if (name.length < 2) {
    return NextResponse.json({ error: "Tell me your name (at least 2 letters)." }, { status: 400 });
  }
  const settings = getAppSettings();
  let user = getUserByName(name);
  if (!user) {
    if (!settings.allowAutoCreateUsers) {
      return NextResponse.json(
        { error: "That name isn't on the list. Ask whoever runs this to add you in Admin." },
        { status: 403 },
      );
    }
    user = createUser(name, {
      settings: body.timezone ? { timezone: body.timezone } : undefined,
    });
  } else if (body.timezone) {
    user = upsertUser({
      ...user,
      settings: { ...user.settings, timezone: body.timezone },
    });
  }
  if (!user.messages.length) {
    user = {
      ...user,
      messages: [
        {
          id: `msg_name_${user.id}`,
          role: "user",
          text: user.name,
          createdAt: user.createdAt,
          status: "read",
        },
        ...greeting(user.name),
      ],
    };
  }
  user = upsertUser(user);
  const res = NextResponse.json({ user, settings });
  res.cookies.set(COOKIE, user.id, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
