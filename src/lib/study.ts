import type { ChatMessage, UserRecord } from "./types";
import { isReservedEvent } from "./life";

/**
 * What a researcher wants per participant: how much they talked, what Buffer
 * understood, what got planned, and whether the nudges did anything.
 */
export interface StudyRow {
  id: string;
  name: string;
  phone?: string;
  channel: "whatsapp" | "web";
  setup: string;
  firstSeen: string;
  lastSeen: string;
  activeDays: number;
  userMessages: number;
  botMessages: number;
  buttonTaps: number;
  intents: Record<string, number>;
  workEvents: number;
  socialEvents: number;
  reservedEvents: number;
  todos: number;
  people: string[];
  peopleLogged: number;
  nudges: number;
  nudgeReplies: number;
  nudgeCalls: number;
  digests: number;
  reminders: number;
  notify: string;
  calendar: string;
  workHours: string;
  switchOff: string;
}

const day = (iso: string) => iso.slice(0, 10);

export function studyRow(u: UserRecord): StudyRow {
  const msgs = u.messages;
  const userMsgs = msgs.filter((m) => m.role === "user");
  const botMsgs = msgs.filter((m) => m.role === "bot");
  const intents: Record<string, number> = {};
  for (const m of userMsgs) intents[m.intent ?? "unknown"] = (intents[m.intent ?? "unknown"] ?? 0) + 1;
  const nudges = botMsgs.filter((m) => m.tag === "nudge");
  // A reply within three hours of a nudge counts as a response; "calling X now" as the call itself.
  let nudgeReplies = 0;
  let nudgeCalls = 0;
  for (const n of nudges) {
    const t = new Date(n.createdAt).getTime();
    const reply = userMsgs.find((m) => {
      const mt = new Date(m.createdAt).getTime();
      return mt > t && mt - t < 3 * 3600 * 1000;
    });
    if (reply) nudgeReplies++;
    if (reply && /^calling .+ now$/i.test(reply.text)) nudgeCalls++;
  }
  const s = u.settings;
  const standing = s.workStart && s.workEnd && s.workStart !== s.workEnd ? `${s.workLabel || "Work"} ${s.workStart}-${s.workEnd}` : "varies";
  return {
    id: u.id,
    name: u.name,
    phone: u.waPhone ? `+${u.waPhone.slice(0, 2)} ***${u.waPhone.slice(-4)}` : undefined,
    channel: u.waPhone ? "whatsapp" : "web",
    setup: u.onboarding && u.onboarding !== "done" ? `at "${u.onboarding}"` : "done",
    firstSeen: u.createdAt,
    lastSeen: u.lastSeenAt,
    activeDays: new Set(userMsgs.map((m) => day(m.createdAt))).size,
    userMessages: userMsgs.length,
    botMessages: botMsgs.length,
    buttonTaps: userMsgs.filter((m) => m.intent === "fast").length,
    intents,
    workEvents: u.events.filter((e) => e.kind === "work").length,
    socialEvents: u.events.filter((e) => e.kind === "social").length,
    reservedEvents: u.events.filter((e) => isReservedEvent(e)).length,
    todos: u.todos.length,
    people: u.people ?? [],
    peopleLogged: Object.keys(u.lastContact ?? {}).length,
    nudges: nudges.length,
    nudgeReplies,
    nudgeCalls,
    digests: botMsgs.filter((m) => m.tag === "digest").length,
    reminders: botMsgs.filter((m) => m.tag === "reminder").length,
    notify: u.notify === false ? "off" : "on",
    calendar: u.google ? `google (${u.google.email ?? "connected"})` : u.calendarConnectedVia ?? "none",
    workHours: standing,
    switchOff: s.protectEveningsAfter || "19:00",
  };
}

/** Every message of every participant, one line each, for a spreadsheet. */
export function transcriptCsv(users: UserRecord[]): string {
  const esc = (v: unknown) => {
    const t = v === undefined || v === null ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const rows = [["participant", "channel", "timestamp", "role", "intent_or_tag", "text", "buttons", "picture"].join(",")];
  for (const u of users) {
    for (const m of u.messages) {
      rows.push(
        [
          u.name,
          u.waPhone ? "whatsapp" : "web",
          m.createdAt,
          m.role,
          m.role === "user" ? m.intent ?? "" : m.tag ?? "",
          m.text,
          (m.buttons ?? []).map((b) => b.title).join(" | "),
          m.card?.type === "image" ? m.card.variant : "",
        ]
          .map(esc)
          .join(","),
      );
    }
  }
  return rows.join("\n");
}

export function transcript(u: UserRecord): Array<Pick<ChatMessage, "id" | "role" | "text" | "createdAt" | "intent" | "tag"> & { buttons?: string[]; picture?: string }> {
  return u.messages.map((m) => ({
    id: m.id,
    role: m.role,
    text: m.text,
    createdAt: m.createdAt,
    intent: m.intent,
    tag: m.tag,
    buttons: m.buttons?.map((b) => b.title),
    picture: m.card?.type === "image" ? m.card.variant : undefined,
  }));
}
