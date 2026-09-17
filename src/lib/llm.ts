import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { UserRecord } from "./types";
import { dateISO, nowInZone } from "./time";

/**
 * Buffer's understanding layer. One structured call to Claude turns a messy
 * WhatsApp text into a typed action; the scheduler still does all the calendar
 * arithmetic deterministically. Without ANTHROPIC_API_KEY (or any other
 * Anthropic credential the SDK resolves) this module returns null and the
 * regex parser in nlp.ts takes over.
 */

export const INTENTS = [
  "greet",
  "help",
  "options",
  "schedule",
  "week",
  "free_time",
  "plan_free",
  "protect",
  "todos",
  "complete_todo",
  "add_event",
  "add_todo",
  "set_pref",
  "confirm",
  "cancel",
  "overlaps",
  "status",
  "chitchat",
  "calendar",
  "calendar_connected",
  "star",
  "unstar",
  "edit_item",
  "reshuffle",
  "clarify",
  "unknown",
] as const;
export type LlmIntent = (typeof INTENTS)[number];

const KINDS = ["work", "social", "personal", "health", "other"] as const;

export const UnderstandingSchema = z.object({
  intent: z.enum(INTENTS),
  confidence: z.number().min(0).max(1),
  reply_hint: z
    .string()
    .describe(
      "One short, warm sentence Buffer could say back, WhatsApp style, lowercase ok, no em dashes, no emoji spam. Used for chitchat and clarifications.",
    ),
  question: z
    .string()
    .nullable()
    .describe("For intent=clarify only: the one question to ask. Otherwise null."),
  options: z
    .array(z.object({ title: z.string().max(20), payload: z.string() }))
    .max(3)
    .nullable()
    .describe("For clarify: up to 3 quick-reply buttons; payload is the full text to send back as if the user typed it."),
  title: z.string().nullable().describe("Clean event/to-do title in Title case, without the time words. Null if none."),
  kind: z.enum(KINDS).nullable().describe("work = job/study; social = people; health = body; personal = rest, chores, hobbies, alone time."),
  date: z.string().nullable().describe("YYYY-MM-DD in the user's timezone, resolved from words like tomorrow / thu / next week. Null if not given."),
  start: z.string().nullable().describe("HH:MM 24h start time. Null if not given."),
  duration_minutes: z.number().int().positive().nullable(),
  items: z.array(z.string()).nullable().describe("For lists of to-dos (bullets, commas, 'and'): the separate titles."),
  target: z.string().nullable().describe("For edit_item / complete_todo / star / unstar / reshuffle: the name of the existing item the user means."),
  rename_to: z.string().nullable(),
  priority: z.enum(["p0", "p1", "p2", "p3"]).nullable(),
  due_date: z.string().nullable().describe("YYYY-MM-DD due date for a to-do."),
  prefs: z
    .object({
      socialMinutesPerDay: z.number().int().nullable(),
      maxWorkMinutesPerDay: z.number().int().nullable(),
      wakeTime: z.string().nullable(),
      sleepTime: z.string().nullable(),
      workStart: z.string().nullable(),
      workEnd: z.string().nullable(),
      noWorkAfter: z.string().nullable(),
      protectEveningsAfter: z.string().nullable(),
    })
    .nullable()
    .describe("Only for set_pref: the settings the user stated. HH:MM for times."),
  memory_notes: z
    .array(z.string())
    .max(3)
    .nullable()
    .describe("Durable facts worth remembering about the person (e.g. 'gym is usually 7pm', 'friend: Sam'). Null if nothing new."),
});
export type Understanding = z.infer<typeof UnderstandingSchema>;

let client: Anthropic | null | undefined;
function getClient(): Anthropic | null {
  if (client !== undefined) return client;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    client = null;
    return client;
  }
  client = new Anthropic({ maxRetries: 1, timeout: 25_000 });
  return client;
}

export function llmAvailable(): boolean {
  return getClient() !== null;
}

const SYSTEM = `You are the understanding layer of Buffer, a WhatsApp assistant for students and young professionals.

Buffer's purpose: find the free time in someone's week and keep it for the rest of their life (people, movement, rest, hobbies), so work fits around life instead of eating it. It also keeps their calendar and to-dos honest. It is warm, brief and never nags.

You receive one message plus context (date/time in the user's timezone, their settings, upcoming events, open to-dos, remembered facts, recent chat, and any half-finished draft). Return a single structured action.

Intent guide:
- add_event: a block with a time ("gym tmrw 7pm", "dinner w sam fri", "call mum sunday"). Social = with people. If the user is mid-draft (draft present) and sends just a time or a length, still use add_event and fill only the new slot.
- add_todo: something to do without a fixed time ("remind me to send the deck", bullet lists, "need to renew passport").
- complete_todo: they finished something ("done with the deck").
- edit_item: change an existing item ("move gym to 8", "make dinner 2h", "rename ...").
- star / unstar: prioritise or unprioritise a named item.
- schedule: today's or a given day's rundown ("what's today", "rundown", "how does friday look").
- week: the week ahead / free time this week ("how's my week", "when am i free", "free time this week").
- free_time: same as week when they ask specifically when they are free (a day or the week).
- plan_free: they want ideas for their free time or ask what to do with it ("what should i do this weekend", "i have a free evening", "suggest something").
- protect: hold time for themselves or people ("keep thursday evening free", "block sunday for me", "protect my evenings"). Fill date/start/duration if given; kind = social or personal.
- set_pref: rules about their days ("i work 9 to 6", "2 hours for people daily", "no work after 8").
- todos: list to-dos. overlaps: clashes. status: "how am i doing", burnout talk. calendar: connect/add to calendar. options: asks for the menu. help: how does this work.
- confirm: yes / lock it / go ahead / make the change. cancel: no / scrap it / never mind / leave it.
- chitchat: thanks, jokes, feelings with no action. greet: hi/hello with nothing else.
- clarify: genuinely ambiguous (which item? which day?) and a single question would settle it. Prefer a sensible default over a question when the risk is low.

Rules:
- Resolve relative dates and times against the provided "now". "tonight" = today evening (19:00 unless given). "this weekend" = the coming Saturday. Weekday names mean the next occurrence (today if still ahead).
- Never invent a time that was not said or strongly implied; leave start null so Buffer asks.
- Titles: strip time words and filler ("i want to", "can you"), keep names ("Dinner with Sam").
- kind: meetings, deck, assignment, study, interview, standup = work. friends, family, dates, dinner with a person, party = social. gym, run, yoga, doctor = health. reading, nap, chores, groceries, alone time, walk = personal.
- reply_hint: plain, kind, short. No em dashes. It is a fallback voice line, not the whole answer.`;

function compactEvents(user: UserRecord, todayISO: string): string {
  const upcoming = user.events
    .filter((e) => e.date >= todayISO)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    .slice(0, 25);
  if (!upcoming.length) return "none";
  return upcoming.map((e) => `${e.date} ${e.start} ${e.durationMinutes}m ${e.kind}${e.starred ? " ★" : ""} · ${e.title}`).join("\n");
}
function compactTodos(user: UserRecord): string {
  const open = user.todos.filter((t) => !t.done).slice(0, 25);
  if (!open.length) return "none";
  return open.map((t) => `${t.priority}${t.starred ? " ★" : ""} ${t.estimatedMinutes}m${t.dueDate ? ` due ${t.dueDate}` : ""} · ${t.title}`).join("\n");
}
function recentChat(user: UserRecord): string {
  return user.messages
    .slice(-8)
    .map((m) => `${m.role === "user" ? "user" : "buffer"}: ${m.text.replace(/\s+/g, " ").slice(0, 240)}`)
    .join("\n");
}

export async function understandWithClaude(raw: string, user: UserRecord): Promise<Understanding | null> {
  const anthropic = getClient();
  if (!anthropic) return null;
  const tz = user.settings.timezone || "UTC";
  const now = nowInZone(tz);
  const todayISO = dateISO(now);
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const draft = user.draft.type === "none" ? "none" : JSON.stringify({ type: user.draft.type, event: user.draft.event, todo: user.draft.todo, missing: user.draft.missing });

  const context = [
    `now: ${todayISO} (${weekday}) ${clock} in ${tz}`,
    `user: ${user.name}`,
    `settings: wake ${user.settings.wakeTime}, sleep ${user.settings.sleepTime}, work ${user.settings.workStart}-${user.settings.workEnd}, no work after ${user.settings.noWorkAfter ?? "none"}, evenings protected after ${user.settings.protectEveningsAfter}, social target ${user.settings.socialMinutesPerDay}m/day, work cap ${user.settings.maxWorkMinutesPerDay}m/day`,
    `remembered: ${user.notes?.trim() || "nothing yet"}`,
    `upcoming events:\n${compactEvents(user, todayISO)}`,
    `open to-dos:\n${compactTodos(user)}`,
    `draft in progress: ${draft}`,
    `recent chat:\n${recentChat(user) || "none"}`,
  ].join("\n\n");

  try {
    const response = await anthropic.messages.parse({
      model: "claude-opus-5",
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: "user", content: `${context}\n\nmessage: """${raw}"""` }],
      output_config: { effort: "low", format: zodOutputFormat(UnderstandingSchema) },
    });
    // A safety refusal or a truncated answer: let the regex parser handle the turn.
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
    return response.parsed_output ?? null;
  } catch (err) {
    console.warn("[buffer] claude understanding failed", err instanceof Error ? err.message : err);
    return null;
  }
}
