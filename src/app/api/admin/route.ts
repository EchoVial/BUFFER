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
import { inStudy, studyDaily, studyIntents, studyRow, transcript, transcriptCsv } from "@/lib/study";
import { botText, setupNudge } from "@/lib/bot";
import { deliver, ensureTemplate, lastSendError, sendTemplate, waConfigured } from "@/lib/wa";
import { originFromRequest } from "@/lib/calendar";

const INVITE_TEMPLATE = "buffer_invite";
const INVITE_TEMPLATE_BODY =
  "hey, it's Buffer, the WhatsApp assistant from the study you signed up for. reply *hi* here whenever you're ready. setup is two questions, then you're in.";
const SETUP_TEMPLATE = "buffer_setup_nudge";
const SETUP_TEMPLATE_BODY = "hey {{1}}, it's Buffer. we stopped halfway through setting you up. reply *hi* here and i'll pick up where we left off. two questions, then you're in.";

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
    const all = (await listUsers()).filter((u) => u.waPhone);
    const users = all.filter(inStudy);
    return NextResponse.json({ rows: users.map(studyRow), hidden: all.filter((u) => u.studyHidden).map(studyRow), daily: studyDaily(users), intents: studyIntents(users) });
  }
  if (q.get("csv")) {
    return new NextResponse(transcriptCsv((await listUsers()).filter(inStudy)), {
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
    hidden?: boolean;
    text?: string;
    phone?: string;
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
  // Everyone in the study who stopped mid-setup gets their open question again. Inside WhatsApp's
  // 24-hour window that is the question itself with buttons; outside it only a template goes through.
  if (body.action === "nudge-setup") {
    if (!waConfigured()) return NextResponse.json({ error: "WhatsApp is not configured on this deployment" }, { status: 400 });
    const origin = originFromRequest(req);
    const pending = (await listUsers()).filter(inStudy).filter((u) => u.onboarding && u.onboarding !== "done");
    const template = pending.length ? await ensureTemplate(SETUP_TEMPLATE, SETUP_TEMPLATE_BODY, ["Sam"]) : "MISSING";
    const results: Array<{ name: string; how: string }> = [];
    for (const user of pending) {
      const msg = setupNudge(user);
      if (!msg) continue;
      const before = user.messages.length;
      await deliver(user, msg, origin);
      let how = lastSendError ? `failed: ${lastSendError.code ?? ""} ${lastSendError.message ?? ""}`.trim() : "sent the open question";
      if (lastSendError?.code === 131047 || lastSendError?.code === 131026) {
        // Outside the window: the template, if Meta has approved it yet.
        if (template === "APPROVED" && (await sendTemplate(user.waPhone!, SETUP_TEMPLATE, [user.name.split(" ")[0]]))) how = "outside the 24h window: sent the template";
        else how = `outside the 24h window; template is ${template.toLowerCase()}, try again in a few minutes`;
      }
      if (how.startsWith("sent") || how.startsWith("outside the 24h window: sent")) {
        await upsertUser({ ...user, messages: [...user.messages.slice(0, before), { ...msg, tag: "nudge" as const }], updatedAt: new Date().toISOString() });
      }
      results.push({ name: user.name, how });
    }
    return NextResponse.json({ ok: true, pending: pending.length, template, results });
  }
  // Someone on Meta's recipient list who has never written: no record exists and no 24-hour window is
  // open, so only an approved template can reach them. Their record is created when they reply.
  if (body.action === "send-invite" && body.phone) {
    if (!waConfigured()) return NextResponse.json({ error: "WhatsApp is not configured on this deployment" }, { status: 400 });
    const digits = body.phone.replace(/\D/g, "");
    if (digits.length < 8) return NextResponse.json({ error: "that does not look like a number with a country code" }, { status: 400 });
    const template = await ensureTemplate(INVITE_TEMPLATE, INVITE_TEMPLATE_BODY, []);
    if (template !== "APPROVED") {
      return NextResponse.json({ error: template === "PENDING" ? "the invite template is waiting for Meta's approval (usually minutes). try again shortly." : `invite template is ${template.toLowerCase()}` }, { status: 409 });
    }
    const ok = await sendTemplate(digits, INVITE_TEMPLATE, []);
    if (!ok) return NextResponse.json({ error: `WhatsApp refused it: ${lastSendError?.code ?? ""} ${lastSendError?.message ?? ""}`.trim() }, { status: 502 });
    return NextResponse.json({ ok: true });
  }
  // A researcher's own message to one participant, sent as Buffer and kept in the transcript.
  if (body.action === "send-message" && body.userId && body.text?.trim()) {
    const user = await getUserById(body.userId);
    if (!user?.waPhone) return NextResponse.json({ error: "not a WhatsApp participant" }, { status: 400 });
    const msg = { ...botText(body.text.trim()), tag: "nudge" as const };
    await deliver(user, msg, originFromRequest(req));
    if (lastSendError) return NextResponse.json({ error: `WhatsApp refused it: ${lastSendError.code ?? ""} ${lastSendError.message ?? ""}`.trim() }, { status: 502 });
    await upsertUser({ ...user, messages: [...user.messages, msg], updatedAt: new Date().toISOString() });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "study-hide" && body.userId) {
    const user = await getUserById(body.userId);
    if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
    await upsertUser({ ...user, studyHidden: Boolean(body.hidden) });
    return NextResponse.json({ ok: true });
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
