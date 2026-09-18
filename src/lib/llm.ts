import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { UserRecord } from "./types";
import { dateISO, nowInZone } from "./time";

/**
 * Buffer's understanding layer. One structured call to a language model turns
 * a messy WhatsApp text into a typed action plus, when the person goes off
 * script, the words to say back; the scheduler still does all the calendar
 * arithmetic deterministically.
 *
 * The model is whatever the environment points at, open models first:
 *   GROQ_API_KEY            Groq (free tier), default llama-3.3-70b-versatile
 *   GEMINI_API_KEY          Google AI Studio (free tier), default gemma-3-27b-it
 *   OPENROUTER_API_KEY      OpenRouter, default google/gemma-3-27b-it:free
 *   OLLAMA_HOST / OLLAMA_MODEL   a local Ollama, default gemma3
 *   LLM_BASE_URL + LLM_API_KEY + LLM_MODEL   any OpenAI-compatible endpoint
 *   ANTHROPIC_API_KEY       Claude (claude-opus-5)
 * With none of these set every function here returns null and the regex
 * parser in nlp.ts takes over.
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
  "question",
  "day_off",
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
  reply: z
    .string()
    .nullable()
    .describe(
      "The full message Buffer sends back, for intent = chitchat, question, greet, unknown or clarify (for clarify the question itself goes here). One to three short sentences in Buffer's voice. Null for actions (add_event, add_todo, protect, set_pref, schedule, week...): Buffer writes those itself.",
    ),
  lead: z
    .string()
    .nullable()
    .describe(
      "For actions only: an optional opening clause (max 12 words) that shows Buffer heard the detail or the mood in the message, e.g. 'roommates too, noted.' or 'long day. ok:'. Null when the message was plain.",
    ),
  question: z.string().nullable().describe("For intent=clarify only: the one question to ask (same text as reply). Otherwise null."),
  options: z
    .array(z.object({ title: z.string().max(20), payload: z.string() }))
    .max(3)
    .nullable()
    .describe("For clarify: up to 3 quick-reply buttons (2-3 plain words); payload is the full text to send back as if the user typed it."),
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
      workLabel: z.string().nullable().describe("What to call the standing weekday block: 'Class' for students, 'Shift', else 'Work'."),
      noWorkAfter: z.string().nullable(),
      protectEveningsAfter: z.string().nullable(),
    })
    .nullable()
    .describe("Only for set_pref: the settings the user stated. HH:MM for times."),
  people: z
    .array(z.string())
    .max(4)
    .nullable()
    .describe(
      "People the user wants to stay in touch with, whenever they say so in any intent ('remind me to spend time with my roommates too', 'i want to call my mom more'). Short names in Title case: 'Mom', 'Roommates'. Null if none.",
    ),
  memory_notes: z
    .array(z.string())
    .max(3)
    .nullable()
    .describe("Durable facts worth remembering about the person (e.g. 'gym is usually 7pm', 'friend: Sam'). Null if nothing new."),
});
export type Understanding = z.infer<typeof UnderstandingSchema>;

/** Answers to the three setup questions, in whatever order and wording they come. */
export const SetupSchema = z.object({
  work_start: z.string().nullable().describe("HH:MM usual work start, if the person gave standing hours."),
  work_end: z.string().nullable().describe("HH:MM usual work end."),
  work_varies: z.boolean().nullable().describe("True if they said their hours change day to day / no fixed hours / freelance. A student with fixed class hours is NOT varies: fill work_start/work_end and work_label 'Class'."),
  work_label: z.string().nullable().describe("'Class' for lectures/college/school, 'Shift' for shift work, otherwise 'Work'. Null if no hours given."),
  unwind: z.string().nullable().describe("HH:MM when they usually switch off from work in the evening, if given."),
  people: z.array(z.string()).max(4).nullable().describe("Who they want to be nudged to call or spend time with: short names in Title case ('Mom', 'Dad', 'Roommates', 'Sam'). Null if none given."),
  skip: z.boolean().describe("True if they declined to answer the current question (skip, no one, not now)."),
  reply: z
    .string()
    .describe(
      "One or two short sentences in Buffer's voice acknowledging exactly what they said, including anything extra they asked for (e.g. 'mom, and time with your roommates. got it.'). No question here; Buffer asks the next one. If they asked something unrelated, answer it briefly here too.",
    ),
});
export type SetupUnderstanding = z.infer<typeof SetupSchema>;

type Provider =
  | { kind: "anthropic"; model: string; label: string }
  | { kind: "openai"; baseUrl: string; apiKey?: string; model: string; label: string; jsonMode: boolean };

let provider: Provider | null | undefined;

/** Which model the environment points at. Open models win over Claude when both are set. */
export function resolveProvider(): Provider | null {
  if (provider !== undefined) return provider;
  const env = process.env;
  const model = env.LLM_MODEL;
  if (env.LLM_BASE_URL) {
    provider = { kind: "openai", baseUrl: env.LLM_BASE_URL.replace(/\/$/, ""), apiKey: env.LLM_API_KEY, model: model || "gemma3", label: `${model || "gemma3"} @ ${env.LLM_BASE_URL}`, jsonMode: env.LLM_JSON_MODE !== "off" };
  } else if (env.GROQ_API_KEY) {
    provider = { kind: "openai", baseUrl: "https://api.groq.com/openai/v1", apiKey: env.GROQ_API_KEY, model: model || "llama-3.3-70b-versatile", label: `groq ${model || "llama-3.3-70b-versatile"}`, jsonMode: true };
  } else if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) {
    provider = { kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY, model: model || "gemma-3-27b-it", label: `google ${model || "gemma-3-27b-it"}`, jsonMode: !/gemma/i.test(model || "gemma-3-27b-it") };
  } else if (env.OPENROUTER_API_KEY) {
    provider = { kind: "openai", baseUrl: "https://openrouter.ai/api/v1", apiKey: env.OPENROUTER_API_KEY, model: model || "google/gemma-3-27b-it:free", label: `openrouter ${model || "google/gemma-3-27b-it:free"}`, jsonMode: false };
  } else if (env.OLLAMA_HOST || env.OLLAMA_MODEL) {
    const host = (env.OLLAMA_HOST || "http://localhost:11434").replace(/\/$/, "");
    provider = { kind: "openai", baseUrl: `${host}/v1`, model: env.OLLAMA_MODEL || model || "gemma3", label: `ollama ${env.OLLAMA_MODEL || model || "gemma3"}`, jsonMode: true };
  } else if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) {
    provider = { kind: "anthropic", model: env.ANTHROPIC_MODEL || "claude-opus-5", label: env.ANTHROPIC_MODEL || "claude-opus-5" };
  } else {
    provider = null;
  }
  return provider;
}

export function llmAvailable(): boolean {
  return resolveProvider() !== null;
}

/** "groq llama-3.3-70b-versatile", "ollama gemma3", "rules" */
export function modelLabel(): string {
  return resolveProvider()?.label ?? "rules";
}

let anthropicClient: Anthropic | undefined;
function getAnthropic(): Anthropic {
  anthropicClient ??= new Anthropic({ maxRetries: 1, timeout: 25_000 });
  return anthropicClient;
}

/** Pull the first JSON object out of a model reply that may have fences or chatter around it. */
function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("no json in reply");
  }
}

/**
 * One structured call, whichever provider. Small open models sometimes drop
 * null fields or wrap the JSON in prose, so the OpenAI path validates loosely
 * (every field optional) and fills the gaps from `defaults`.
 */
async function callStructured<S extends z.ZodObject>(schema: S, defaults: z.infer<S>, system: string, user: string, maxTokens: number): Promise<z.infer<S> | null> {
  const p = resolveProvider();
  if (!p) return null;
  try {
    if (p.kind === "anthropic") {
      const response = await getAnthropic().messages.parse({
        model: p.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { effort: "low", format: zodOutputFormat(schema) },
      });
      // A safety refusal or a truncated answer: let the regex parser handle the turn.
      if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
      return (response.parsed_output as z.infer<S> | null) ?? null;
    }
    const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    const res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}) },
      body: JSON.stringify({
        model: p.model,
        temperature: 0.2,
        max_tokens: maxTokens,
        ...(p.jsonMode ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: `${system}\n\nAnswer with one JSON object only, no prose and no code fences, matching this JSON schema (use null for anything not given):\n${jsonSchema}` },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) {
      console.warn("[buffer] model call failed", p.label, res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const loose = schema.partial().safeParse(extractJson(content));
    if (!loose.success) {
      console.warn("[buffer] model reply did not match the schema", p.label, loose.error.issues.slice(0, 3));
      return null;
    }
    const merged = { ...defaults } as Record<string, unknown>;
    for (const [k, v] of Object.entries(loose.data as Record<string, unknown>)) if (v !== undefined) merged[k] = v;
    return merged as z.infer<S>;
  } catch (err) {
    console.warn("[buffer] model call failed", p.label, err instanceof Error ? err.message : err);
    return null;
  }
}

const UNDERSTANDING_DEFAULTS: Understanding = {
  intent: "unknown",
  confidence: 0.6,
  reply: null,
  lead: null,
  question: null,
  options: null,
  title: null,
  kind: null,
  date: null,
  start: null,
  duration_minutes: null,
  items: null,
  target: null,
  rename_to: null,
  priority: null,
  due_date: null,
  prefs: null,
  people: null,
  memory_notes: null,
};

const SETUP_DEFAULTS: SetupUnderstanding = {
  work_start: null,
  work_end: null,
  work_varies: null,
  work_label: null,
  unwind: null,
  people: null,
  skip: false,
  reply: "",
};

const VOICE = `Buffer's voice: warm, brief, lowercase like a text from a friend, plain words, no em dashes, no emoji, no exclamation marks. Never corporate. It can be a little dry and funny. It never lectures about work-life balance; it just makes room for people.`;

const FEATURES = `What Buffer can do (answer questions about itself from this, never invent features):
- You tell it when you work ("work 7 to 10pm today", "shift 9 to 5 tomorrow", "i usually work 9 to 6"); it marks it on your calendar and knows when you are actually free.
- "my week" / "today" / "tomorrow" send a picture: the week as bars (green free, grey work), a day as a strip plus the blocks.
- Plans with a time ("dinner with sam friday 8pm") and to-dos without one ("remind me to renew my passport"). Everything saves immediately; "undo", "push 30 min later", "make it 2h", "move gym to 8pm", "done with the deck" change things.
- "reserve friday evening" puts a block called "Reserved for you" on the calendar so nothing else gets planned there.
- Once a day, in the 90 minutes after your switch-off time, if nothing is on, it nudges you to call one of your people ("nudge me to call mum" adds someone; "who do i call" lists them).
- "connect calendar" gives a private feed for Google, Apple, Android and Outlook; everything Buffer saves shows up there within about 15 minutes.
- Standing work or class hours ("every weekday 9 to 5") repeat on weekdays automatically; "no class tomorrow" or "off friday" clears them for that day. Other plans do not repeat yet; each one is added on its day.
- It does not read your existing calendar yet, does not send messages to other people, and has no voice or photo input yet.`;

const SYSTEM = `You are the understanding layer of Buffer, a WhatsApp assistant for students and young professionals. You only ever output one JSON object.

Buffer's purpose: the user tells it when they work; it shows them when they are actually free and nudges them to spend some of that time with the people they love (a call home, a friend). It also keeps their calendar and to-dos honest. It is warm, brief and never nags.

${VOICE}

${FEATURES}

You receive one message plus context (date/time in the user's timezone, their settings, upcoming events, open to-dos, remembered facts, their people, recent chat, and any half-finished draft). Return a single structured action.

Intent guide:
- add_event: a block with a time ("gym tmrw 7pm", "dinner w sam fri", "call mum sunday"). Social = with people. If the user is mid-draft (draft present) and sends just a time or a length, still use add_event and fill only the new slot.
- WORK ON A DAY IS AN EVENT: "work 7 to 10pm today", "i have work from 7pm-10pm today, mark it", "shift tomorrow 9 to 5", "working till 8 tonight" = add_event, kind work, title "Work" (or "Class"), start = range start, duration_minutes = range length. If no day is named, date = today.
- REPEATING WORK IS A PREFERENCE: "every weekday from 9am to 5pm i have class, mark that", "i usually work 9 to 6", "my hours are 9 to 6", "mon to fri 10 to 7", "all weekdays" as an answer about a range = set_pref with prefs.workStart, prefs.workEnd and prefs.workLabel ("Class", "Shift" or "Work"). Buffer then shows that block on every weekday. Only work/class/shift repeats this way; other repeating plans ("gym every day") are not supported yet: use question and say so, offering to add the next one.
- A range like "7 to 10pm" gives both start and duration_minutes (180). "9 to 6" means 9am to 6pm.
- add_todo: something to do without a fixed time ("remind me to send the deck", bullet lists, "need to renew passport").
- complete_todo: they finished something ("done with the deck").
- edit_item: change an existing item ("move gym to 8", "make dinner 2h", "rename ...").
- star / unstar: prioritise or unprioritise a named item.
- schedule: today's or a given day's rundown ("what's today", "rundown", "how does friday look", or just "today" / "tomorrow").
- week: the week ahead / free time this week ("how's my week", "when am i free", "free time this week").
- free_time: same as week when they ask specifically when they are free (a day or the week).
- plan_free: they want ideas for their free time or ask what to do with it ("what should i do this weekend", "i have a free evening", "suggest something").
- protect: reserve time for themselves or people ("keep thursday evening free", "reserve sunday for me", "protect my evenings"). Fill date/start/duration if given; kind = social or personal.
- set_pref: standing rules about their days ("i usually work 9 to 6", "2 hours for people daily", "no work after 8", "i wind down at 8"). "i wind down / unwind / switch off at 8pm" = prefs.protectEveningsAfter and noWorkAfter = "20:00".
- day_off: no standing work/class on a day ("no class tomorrow", "off today", "holiday on friday", "classes cancelled"): date = that day (today if none). Buffer drops the standing block for that day.
- todos: list to-dos. overlaps: clashes. status: "how am i doing", burnout talk. calendar: connect/add to calendar. options: asks for the menu. help: "how does this work" with no specific question.
- question: they ask something Buffer can answer in words: about Buffer ("what can you do", "do you sync with google", "what does reserve mean", "why did you do that"), about their own schedule from the context ("when did i say i work", "how many to-dos do i have", "who do you nudge me about"), or anything else where a short honest answer is the right response. Put the answer in reply. Be honest about limits (see the feature list).
- confirm: yes / save it / go ahead / make the change. cancel: no / scrap it / never mind / leave it.
- chitchat: thanks, jokes, feelings, venting with no action. Reply like a friend would, briefly, and only offer something if it fits ("rough day. want me to reserve tomorrow evening?"). greet: hi/hello with nothing else; reply with one line and what they could say.
- clarify: genuinely ambiguous (which item? which day?) and a single question would settle it. Prefer a sensible default over a question when the risk is low.
- unknown: only when nothing above fits; reply should say plainly what Buffer understood and offer the two or three likely readings.

Rules:
- Resolve relative dates and times against the provided "now". "tonight" = today evening (19:00 unless given). "this weekend" = the coming Saturday. Weekday names mean the next occurrence (today if still ahead).
- Never invent a time that was not said or strongly implied; leave start null so Buffer asks.
- Titles: strip time words and filler ("i want to", "can you"), keep names ("Dinner with Sam").
- kind: meetings, deck, assignment, study, interview, standup = work. friends, family, dates, dinner with a person, party = social. gym, run, yoga, doctor = health. reading, nap, chores, groceries, alone time, walk = personal.
- people: fill whenever they mention wanting to keep up with someone, even inside another intent. Buffer will confirm it in its reply.
- lead: for actions, one short clause only when the message carried a detail or mood worth acknowledging; otherwise null. Never repeat what Buffer's own confirmation will say (the time, the title).
- reply: write it for chitchat, question, greet, unknown, clarify. Use the context: their name, their people, what is on their calendar. Never claim Buffer did something it did not do.`;

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
function recentChat(user: UserRecord, n = 8): string {
  return user.messages
    .slice(-n)
    .map((m) => `${m.role === "user" ? "user" : "buffer"}: ${m.text.replace(/\s+/g, " ").slice(0, 240)}`)
    .join("\n");
}

function contextFor(user: UserRecord): string {
  const tz = user.settings.timezone || "UTC";
  const now = nowInZone(tz);
  const todayISO = dateISO(now);
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const draft = user.draft.type === "none" ? "none" : JSON.stringify({ type: user.draft.type, event: user.draft.event, todo: user.draft.todo, missing: user.draft.missing });
  const standing = user.settings.workStart === user.settings.workEnd ? "varies day to day" : `${user.settings.workStart}-${user.settings.workEnd}`;
  return [
    `now: ${todayISO} (${weekday}) ${clock} in ${tz}`,
    `user: ${user.name}`,
    `settings: wake ${user.settings.wakeTime}, sleep ${user.settings.sleepTime}, usual work ${standing}, switches off at ${user.settings.protectEveningsAfter}, no work after ${user.settings.noWorkAfter ?? "none"}, social target ${user.settings.socialMinutesPerDay}m/day, work cap ${user.settings.maxWorkMinutesPerDay}m/day`,
    `people they want to keep up with: ${user.people?.length ? user.people.join(", ") : "none yet"}`,
    `calendar connected: ${user.calendarConnectedAt ? "yes" : "no"}`,
    `remembered: ${user.notes?.trim() || "nothing yet"}`,
    `upcoming events:\n${compactEvents(user, todayISO)}`,
    `open to-dos:\n${compactTodos(user)}`,
    `draft in progress: ${draft}`,
    `recent chat:\n${recentChat(user) || "none"}`,
  ].join("\n\n");
}

export async function understandWithModel(raw: string, user: UserRecord): Promise<Understanding | null> {
  const out = await callStructured(UnderstandingSchema, UNDERSTANDING_DEFAULTS, SYSTEM, `${contextFor(user)}\n\nmessage: """${raw}"""`, 2000);
  if (!out || !INTENTS.includes(out.intent)) return null;
  return out;
}

/** Older name, kept for callers. */
export const understandWithClaude = understandWithModel;

const SETUP_SYSTEM = `You read answers to Buffer's three setup questions and return them as fields.

${VOICE}

${FEATURES}

The questions, in order: (1) when do you usually work, (2) when do you usually switch off from work in the evening, (3) who should Buffer nudge you to call when you are free. You are told which question was just asked. People answer loosely: "9 to 6 mostly", "depends, i'm a student", "around 8", "my mom, and remind me to spend some time with my roommates too", "skip". Fill every field the answer gives, including answers to questions not yet asked ("9 to 6 and i'm done by 7" fills work and unwind). A lone clock time after question 1 is not a work range; after question 2 it is the unwind time. For question 3, people can be roles ("Mom", "Roommates", "my sister" -> "Sister") or names. "Spend time with X" counts as a person to nudge about. If the answer asks something unrelated, answer it in reply in one sentence and still fill what you can. reply never asks the next question.`;

export async function understandSetupWithModel(step: "work" | "unwind" | "people", raw: string, user: UserRecord): Promise<SetupUnderstanding | null> {
  if (!resolveProvider()) return null;
  const asked = step === "work" ? "(1) when do you usually work?" : step === "unwind" ? "(2) when do you usually switch off from work for the day?" : "(3) who should i nudge you to call when you're free?";
  const tz = user.settings.timezone || "UTC";
  const standing = user.settings.workStart === user.settings.workEnd ? "varies" : `${user.settings.workStart}-${user.settings.workEnd}`;
  const known = `already answered: work ${step === "work" ? "not yet" : standing}; switch-off ${step === "people" ? user.settings.protectEveningsAfter : "not yet"}; people ${user.people?.length ? user.people.join(", ") : "not yet"}`;
  const out = await callStructured(SetupSchema, SETUP_DEFAULTS, SETUP_SYSTEM, `user: ${user.name}\ntimezone: ${tz}\n${known}\nquestion just asked: ${asked}\n\nrecent chat:\n${recentChat(user, 6)}\n\nanswer: """${raw}"""`, 800);
  if (!out) return null;
  // A model that answered nothing useful should not swallow the turn; the regexes get it.
  if (!out.reply && !out.work_start && !out.work_varies && !out.unwind && !out.people?.length && !out.skip) return null;
  return out;
}

/** Older name, kept for callers. */
export const understandSetupWithClaude = understandSetupWithModel;
