import { NextRequest, NextResponse } from "next/server";
import {
  createUser,
  deleteUser,
  getAppSettings,
  getStore,
  getUserById,
  listUsers,
  patchAppSettings,
  upsertUser,
} from "@/lib/store";
import { DEFAULT_USER_SETTINGS, UserSettings } from "@/lib/types";

function adminOk(req: NextRequest): boolean {
  const expected = process.env.ADMIN_PASSWORD || "balance123";
  const got =
    req.headers.get("x-admin-password") ||
    req.nextUrl.searchParams.get("password") ||
    "";
  return got === expected;
}

function deny() {
  return NextResponse.json({ error: "Wrong admin password." }, { status: 401 });
}

export async function GET(req: NextRequest) {
  if (!adminOk(req)) return deny();
  const id = req.nextUrl.searchParams.get("userId");
  if (id) {
    const user = getUserById(id);
    if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ user, settings: getAppSettings() });
  }
  const users = listUsers().map((u) => ({
    id: u.id,
    name: u.name,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    lastSeenAt: u.lastSeenAt,
    messages: u.messages.length,
    events: u.events.length,
    todos: u.todos.length,
    lastNlp: u.lastNlp,
    notes: u.notes,
    settings: u.settings,
  }));
  return NextResponse.json({
    settings: getAppSettings(),
    users,
    env: {
      persistHint:
        process.env.VERCEL === "1"
          ? "Running on Vercel: memory + /tmp. Pair with user local cache. For durable multi-instance storage, add a database later."
          : "Local filesystem store at data/store.json",
    },
  });
}

export async function POST(req: NextRequest) {
  if (!adminOk(req)) return deny();
  const body = (await req.json()) as {
    action?: string;
    name?: string;
    notes?: string;
    settings?: Partial<UserSettings>;
    userId?: string;
    appSettings?: Parameters<typeof patchAppSettings>[0];
    defaultUserSettings?: Partial<UserSettings>;
  };
  if (body.action === "create-user") {
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }
    const user = createUser(body.name, {
      notes: body.notes,
      settings: body.settings,
    });
    return NextResponse.json({ user });
  }
  if (body.action === "patch-settings") {
    const settings = patchAppSettings({
      ...body.appSettings,
      defaultUserSettings: {
        ...DEFAULT_USER_SETTINGS,
        ...getAppSettings().defaultUserSettings,
        ...body.defaultUserSettings,
      },
    });
    return NextResponse.json({ settings });
  }
  if (body.action === "patch-user" && body.userId) {
    const user = getUserById(body.userId);
    if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
    const saved = upsertUser({
      ...user,
      notes: body.notes ?? user.notes,
      settings: { ...user.settings, ...body.settings },
    });
    return NextResponse.json({ user: saved });
  }
  if (body.action === "reset-user" && body.userId) {
    const user = getUserById(body.userId);
    if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
    const saved = upsertUser({
      ...user,
      events: [],
      todos: [],
      messages: [],
      draft: { type: "none", missing: [] },
      remindedEventIds: [],
      lastNlp: undefined,
    });
    return NextResponse.json({ user: saved });
  }
  if (body.action === "delete-user" && body.userId) {
    deleteUser(body.userId);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "export") {
    return NextResponse.json({ store: getStore() });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
