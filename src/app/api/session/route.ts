import { NextRequest, NextResponse } from "next/server";
import { createUser, deleteUser, getAppSettings, getUserById, getUserByName, persistBackend, upsertUser } from "@/lib/store";
import { beginChat } from "@/lib/bot";
import { extractName } from "@/lib/names";

export const dynamic = "force-dynamic";

const COOKIE = "balance_user";

export async function GET(req: NextRequest) {
  const settings = await getAppSettings();
  const id = req.cookies.get(COOKIE)?.value;
  if (!id) return NextResponse.json({ user: null, settings, storage: persistBackend() });
  const user = await getUserById(id);
  if (!user) {
    const res = NextResponse.json({ user: null, settings });
    res.cookies.set(COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }
  return NextResponse.json({ user, settings, storage: persistBackend() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { name?: string; timezone?: string };
  const typed = (body.name || "").trim();
  const name = extractName(typed);
  if (name.length < 2) {
    return NextResponse.json({ error: "Tell me your name (at least 2 letters)." }, { status: 400 });
  }
  const settings = await getAppSettings();
  let user = await getUserByName(name);
  if (!user) {
    if (!settings.allowAutoCreateUsers) {
      return NextResponse.json(
        { error: "That name isn't on the list. Ask whoever runs this to add you." },
        { status: 403 },
      );
    }
    user = await createUser(name, {
      settings: body.timezone ? { timezone: body.timezone } : undefined,
    });
  } else if (body.timezone) {
    user = await upsertUser({
      ...user,
      settings: { ...user.settings, timezone: body.timezone },
    });
  }
  if (!user.messages.length) {
    user = beginChat({
      ...user,
      messages: [
        {
          id: `msg_name_${user.id}`,
          role: "user",
          text: typed,
          createdAt: user.createdAt,
          status: "read",
        },
      ],
    });
  }
  user = await upsertUser(user);
  const res = NextResponse.json({ user, settings, storage: persistBackend() });
  res.cookies.set(COOKIE, user.id, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  return res;
}

export async function DELETE(req: NextRequest) {
  // Leaving the chat forgets the record on the server as well as the cookie.
  const id = req.cookies.get(COOKIE)?.value;
  if (id) await deleteUser(id).catch(() => undefined);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
