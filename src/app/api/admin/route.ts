import { NextRequest, NextResponse } from "next/server";
import {
  createUser,
  deleteUser,
  getAppSettings,
  getStore,
  getUserById,
  listUsers,
  patchAppSettings,
  persistBackend,
  upsertUser,
} from "@/lib/store";
import { DEFAULT_USER_SETTINGS, UserSettings } from "@/lib/types";
import { studyDaily, studyIntents, studyRow, transcript, transcriptCsv } from "@/lib/study";

export const dynamic = "force-dynamic";

function expectedPassword(): string | null {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (process.env.VERCEL) return null;
  return "balance123";
}

function adminOk(req: NextRequest): boolean {
  const expected = expectedPassword();
  if (!expected) return false;
  const got =
    req.headers.get("x-admin-password") ||
    req.nextUrl.searchParams.get("password") ||
    "";
  return got === expected;
}

function deny() {
  const missing = process.env.VERCEL && !process.env.ADMIN_PASSWORD;
  return NextResponse.json(
    {
      error: missing
        ? "Set ADMIN_PASSWORD in Vercel → Project → Settings → Environment Variables, then redeploy."
        : "Wrong admin password.",
    },
    { status: 401 },
  );
}

export async function GET(req: NextRequest) {
  if (!adminOk(req)) return deny();
  const q = req.nextUrl.searchParams;
  const id = q.get("userId");
  // The study view: one row per participant, a readable transcript, or everything as CSV.
  if (q.get("study")) {
    const users = await listUsers();
    return NextResponse.json({ rows: users.map(studyRow), daily: studyDaily(users), intents: studyIntents(users) });
  }
  if (q.get("csv")) {
    return new NextResponse(transcriptCsv(await listUsers()), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="buffer-transcripts-${new Date().toISOString().slice(0, 10)}.csv"` },
    });
  }
  if (id && q.get("transcript")) {
    const user = await getUserById(id);
    if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ row: studyRow(user), messages: transcript(user) });
  }
  if (id) {
    const user = await getUserById(id);
    if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ user, settings: await getAppSettings() });
  }
  const users = (await listUsers()).map((u) => ({
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
  const backend = persistBackend();
  return NextResponse.json({
    settings: await getAppSettings(),
    users,
    env: {
      persistHint:
        backend === "kv"
          ? "Durable store: Vercel KV / Upstash Redis."
          : backend === "memory"
            ? "Vercel memory + each user's browser cache. Add KV_REST_API_URL and KV_REST_API_TOKEN for data that survives deploys."
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
    const user = await createUser(body.name, {
      notes: body.notes,
      settings: body.settings,
    });
    return NextResponse.json({ user });
  }
  if (body.action === "patch-settings") {
    const current = await getAppSettings();
    const settings = await patchAppSettings({
      ...body.appSettings,
      defaultUserSettings: {
        ...DEFAULT_USER_SETTINGS,
        ...current.defaultUserSettings,
        ...body.defaultUserSettings,
      },
    });
    return NextResponse.json({ settings });
  }
  if (body.action === "patch-user" && body.userId) {
    const user = await getUserById(body.userId);
    if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
    const saved = await upsertUser({
      ...user,
      notes: body.notes ?? user.notes,
      settings: { ...user.settings, ...body.settings },
    });
    return NextResponse.json({ user: saved });
  }
  if (body.action === "reset-user" && body.userId) {
    const user = await getUserById(body.userId);
    if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
    const saved = await upsertUser({
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
    await deleteUser(body.userId);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "export") {
    return NextResponse.json({ store: await getStore() });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
