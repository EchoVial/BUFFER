import {
  CalendarEvent,
  ChatMessage,
  ConversationDraft,
  DayStats,
  InteractiveList,
  MessageCard,
  ReplyButton,
  TodoItem,
  UserRecord,
} from "./types";
import { uid } from "./ids";
import { disconnectGoogle, googleConfigured, googleConnectUrl } from "./google";
import { siteOrigin } from "./calendar";
import { understand, understandSetup } from "./understand";
import { isStandingLanguage, parseRange, workLabelFor, type ParsedMessage, exceptDaysIn } from "./nlp";
import type { SetupUnderstanding } from "./llm";
import { dayImage, describeWindow, freeLine, protectPayload, protectedEvent, slotName, standingWork, suggestForFreeTime, suggestionLine, suggestionPayload, weekImage, weekView, windowLabel } from "./life";
import { findNamedItem } from "./match";
import { buildDayPlan, proposeEvent } from "./scheduler";
import {
  addDaysISO,
  dateISO,
  durationLabel,
  hmToMinutes,
  minutesToHM,
  nowInZone,
  prettyDate,
  shortClock, describeDays, dayNumbersIn, WEEKDAYS } from "./time";

type BotExtra = {
  card?: MessageCard;
  buttons?: ReplyButton[];
  list?: InteractiveList;
  calendarEventId?: string;
};

const CARD_TYPES = new Set(["schedule", "proposal", "todos", "overlaps", "debug", "image"]);

export function botText(text: string, extra?: MessageCard | BotExtra): ChatMessage {
  const opts: BotExtra =
    extra && "type" in extra && CARD_TYPES.has(String((extra as MessageCard).type))
      ? { card: extra as MessageCard }
      : ((extra as BotExtra) ?? {});
  return {
    id: uid("msg"),
    role: "bot",
    text,
    createdAt: new Date().toISOString(),
    status: "delivered",
    ...opts,
  };
}

function userText(text: string): ChatMessage {
  return {
    id: uid("msg"),
    role: "user",
    text,
    createdAt: new Date().toISOString(),
    status: "read",
  };
}

const btn = (id: string, title: string, payload: string): ReplyButton => ({ id, title: title.slice(0, 20), payload });

const B = {
  week: btn("week", "See my week", "my week"),
  today: btn("today", "See today", "today"),
  addWork: btn("work", "Mark work hours", "add work"),
  add: btn("add", "Add a plan or to-do", "add something"),
  ideas: btn("ideas", "Plan people time", "plan people time"),
  help: btn("help", "How this works", "help"),
  todos: btn("todos", "See my to-dos", "my to-dos"),
  undo: btn("undo", "Undo (remove it)", "undo"),
  later30: btn("later", "Push 30 min later", "make it 30m later"),
  cancel: btn("cancel", "Cancel", "cancel"),
};

/** Every reply gets three buttons; these fill the gaps, most useful first. */
const DEFAULT_BUTTONS: ReplyButton[] = [];

const CHANGE_BUTTONS: ReplyButton[] = [
  btn("apply", "Make the change", "make the change"),
  btn("leave", "Leave it as is", "leave it"),
];

const KIND_BUTTONS: ReplyButton[] = [
  btn("work", "It's work", "it's work"),
  btn("social", "It's with people", "it's social"),
  btn("personal", "It's for me", "it's personal"),
];
DEFAULT_BUTTONS.push(B.ideas, B.week, B.today, B.addWork, B.help);

/** The whole menu. Short on purpose: see, tell, more. */
const START_LIST: InteractiveList = {
  button: "See all options",
  footer: "or just text me like a friend",
  sections: [
    {
      title: "See",
      rows: [
        { id: "week", title: "See my week", description: "Where you're free, day by day", payload: "my week" },
        { id: "today", title: "See today", description: "Today as a picture", payload: "today" },
      ],
    },
    {
      title: "Tell me",
      rows: [
        { id: "work", title: "Mark work hours", description: "e.g. work 7 to 10pm today", payload: "add work" },
        { id: "add", title: "Add a plan or to-do", description: "dinner with sam fri 8pm · remind me to call nani", payload: "add something" },
        { id: "ideas", title: "Plan people time", description: "Slots this week for the people you named", payload: "plan people time" },
        { id: "keep", title: "Reserve an evening", description: "I block it so nothing else lands there", payload: "reserve an evening this week" },
        { id: "people", title: "People I call", description: "Who I nudge you to ring when you're free", payload: "who do i call" },
      ],
    },
    {
      title: "More",
      rows: [
        { id: "cal", title: "Connect my calendar", description: "Google, Apple, Outlook", payload: "connect calendar" },
        { id: "help", title: "How this works", description: "The whole thing in five lines", payload: "help" },
        { id: "setup", title: "Set up again", description: "Work hours, switch-off time, people", payload: "set up again" },
      ],
    },
  ],
};

function optionsMessage(): ChatMessage {
  return botText("everything i do. tap one, or just text me.", { list: START_LIST });
}

function helpText(): string {
  return [
    "the short version:",
    "• *work 7 to 10pm today* or *class 9 to 5 every weekday* marks work",
    "• *my week* or *today* sends a picture",
    "• *dinner with sam fri 8pm* adds a plan, *remind me to call nani* a to-do",
    "• *plan people time* finds slots for your people. free evenings get one nudge to call someone",
    "• *reserve friday evening* keeps it clear",
    "",
    "plain words change things: *move gym to 8pm*, *undo*, *add to gcal*.",
  ].join("\n");
}

function connectedLabel(via: string): string {
  switch (via) {
    case "google":
      return "Google Calendar";
    case "apple":
      return "Apple Calendar";
    case "outlook":
      return "Outlook";
    case "copy":
      return "your calendar app (feed URL copied)";
    case "snapshot":
      return "your calendar (via .ics snapshot)";
    default:
      return "your calendar";
  }
}

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

const cap = (n: string) => n.charAt(0).toUpperCase() + n.slice(1);
const clockShort = shortClock;
const span = (start: string, minutes: number) => `${clockShort(start)} to ${clockShort(minutesToHM((hmToMinutes(start) + minutes) % (24 * 60)))}`;

/** One-line explanations, each shown once per person. */
const TIPS: Record<string, string> = {
  keep: "(*Reserved for you* sits on your calendar. *Undo* removes it.)",
  save: "(*Undo* removes it. *Push 30 min later* moves it.)",
  todo: "(no fixed time: i slot it into a free gap.)",
  picture: "(purple blocks: drag them to a new time.)",
  calendar: "(the button opens google calendar with it filled in. you tap Save.)",
};

/** Talking to WhatsApp rather than the web chat: no browser, no dragging, no popups. */
const onWhatsApp = (u: UserRecord) => Boolean(u.waPhone);

function tip(next: UserRecord, id: keyof typeof TIPS): string {
  const seen = next.tips ?? [];
  if (seen.includes(id)) return "";
  if (id === "picture" && onWhatsApp(next)) return ""; // a PNG in WhatsApp cannot be dragged
  next.tips = [...seen, id];
  return `\n${TIPS[id]}`;
}

function dayWordFor(iso: string, tz: string): string {
  const today = dateISO(nowInZone(tz));
  if (iso === today) return "today";
  const d = new Date(`${iso}T12:00:00`);
  const t = new Date(`${today}T12:00:00`);
  const diff = Math.round((d.getTime() - t.getTime()) / 86400000);
  if (diff === 1) return "tomorrow";
  if (diff > 1 && diff < 7) return d.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  return prettyDate(iso);
}

/** "Roommates", "friends", "family": people you spend time with rather than ring. */
const isGroup = (name: string) => /^(roommates?|flatmates?|housemates?|friends|family|cousins|parents|siblings|the boys|the girls|the gang|team|mates)$/i.test(name.trim());

/** Names from "mum, dad", "nani and rohan", "my sister & ayaan". */
export function parsePeople(text: string): string[] {
  const t = text
    .toLowerCase()
    .replace(/\b(nudge|remind|prompt)\s+me\s+to\s+(call|ring|text|see|visit)\b/g, " ")
    .replace(/\b(remind me to|spend (?:some |more )?time with|hang out with|catch up with|keep up with|check in on|check on|talk to|see more of|too|as well|sometimes|more often|once a week|every week)\b/g, " ")
    .replace(/\b(when i'?m free|when i am free|please|call|to call|my|the|also|maybe|and my|and|with)\b/g, " ");
  return t
    .split(/,|&|\n|\+|\/|\s{2,}/)
    .map((s) => s.replace(/[^a-z' ]/g, "").replace(/\s+/g, " ").trim())
    .filter((s) => s && s.length <= 20 && !/^(skip|no one|noone|nobody|none|later|nah|no|not now|nope)$/.test(s))
    .slice(0, 4)
    .map(cap);
}

function renderTodos(user: UserRecord): string[] {
  const roots = user.todos.filter((t) => !t.parentId);
  const kids = (id: string) => user.todos.filter((t) => t.parentId === id);
  const line = (t: TodoItem, pad: string) => {
    const mark = t.done ? "✓" : "○";
    const due = t.dueDate ? ` · due ${prettyDate(t.dueDate)}` : "";
    const hot = t.starred || t.priority === "p0" ? " ★" : "";
    return `${pad}${mark}${hot} ${t.title} · ${durationLabel(t.estimatedMinutes)}${due}`;
  };
  const out: string[] = [];
  const walk = (t: TodoItem, depth: number) => {
    out.push(line(t, "  ".repeat(depth)));
    for (const c of kids(t.id)) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  const orphans = user.todos.filter((t) => t.parentId && !user.todos.some((p) => p.id === t.parentId));
  for (const o of orphans) out.push(line(o, ""));
  return out.length ? out : ['nothing yet. say something like "remind me to call nani".'];
}

function missingEventFields(ev: ConversationDraft["event"]): string[] {
  const missing: string[] = [];
  if (!ev?.title || ev.title.length < 2) missing.push("title");
  if (!ev?.date) missing.push("date");
  if (!ev?.start) missing.push("time");
  return missing;
}

function askFor(missing: string[], ev: ConversationDraft["event"]): string {
  const what = ev?.title && !missing.includes("title") ? `*${ev.title}*` : "it";
  if (missing.includes("title") && (missing.includes("date") || missing.includes("time"))) {
    return "what and when? say it like *gym tomorrow 7am* or *work 7 to 10pm today*.";
  }
  if (missing.includes("title")) return "what should i call it?";
  if (missing.includes("date") && missing.includes("time")) return `when is ${what}? say it your way: *7 to 10pm today*, *tomorrow at 6*, *every weekday 9 to 5*.`;
  if (missing.includes("date")) return `which day is ${what}? today, tomorrow, a weekday, or *every weekday* if it repeats. say it however you like.`;
  return `what time is ${what}? *7 to 10pm* for a start and end, *7pm* for just a start, or *till 6* if it runs from now.`;
}

function askMessage(missing: string[], ev: ConversationDraft["event"]): ChatMessage {
  return botText(askFor(missing, ev), { buttons: missing.includes("kind") ? KIND_BUTTONS : [B.cancel] });
}

function applyEventPatch(draft: ConversationDraft, parsed: ParsedMessage): ConversationDraft {
  const ev = { ...(draft.event || {}) };
  const junk = (t?: string) => !t || t.replace(/[^a-z]/gi, "").length < 3 || /^(yes|ok|today|tomorrow|tonight|event|it)$/i.test(t.trim()) || /^\d/.test(t.trim());
  if (parsed.intent === "add_event" && !junk(parsed.event.title) && ev.title !== "Work" && junk(ev.title)) {
    ev.title = parsed.event.title;
  }
  if (parsed.event.date) ev.date = parsed.event.date;
  if (parsed.event.start) ev.start = parsed.event.start;
  if (parsed.event.durationMinutes) ev.durationMinutes = parsed.event.durationMinutes;
  if (parsed.event.kind) ev.kind = parsed.event.kind;
  return { type: "event", event: ev, missing: missingEventFields(ev) };
}

function finalizeEvent(ev: NonNullable<ConversationDraft["event"]>): CalendarEvent {
  return {
    id: uid("evt"),
    title: ev.title || "Untitled",
    kind: ev.kind || "other",
    date: ev.date!,
    start: ev.start!,
    durationMinutes: ev.durationMinutes || 60,
    flexible: ev.kind !== "work",
    starred: ev.starred,
    createdAt: new Date().toISOString(),
  };
}

function findTodo(user: UserRecord, hint: string): TodoItem | undefined {
  const h = hint.toLowerCase();
  return user.todos.find((t) => t.title.toLowerCase().includes(h) && h.length > 1);
}

function calendarButtons(connected: boolean): ReplyButton[] {
  return [
    { id: "gcal", title: "Add to Google Cal", action: "google-cal" },
    { id: "ics", title: "Download .ics file", action: "ics" },
    connected ? { id: "outlook", title: "Add to Outlook", action: "outlook-cal" } : { id: "connect", title: "Connect live feed", action: "connect-feed" },
  ];
}

function peopleNote(stats: DayStats, flavor: "status" | "rundown"): string {
  const room = stats.freeMinutes >= 45;
  if (flavor === "status") {
    if (stats.workMinutes > stats.workCap) return "work ran long today. a quiet evening still counts.";
    if (room) return "there's a pocket of free time. a call, a walk, or nothing at all. your call.";
    return "today is full. hope there's something in it that's just for you.";
  }
  return "";
}

function sameishTitle(a?: string, b?: string): boolean {
  if (!a || !b) return true;
  const na = a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const nb = b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!na || !nb) return true;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function describeEvent(ev: CalendarEvent): string {
  return `*${ev.starred ? "★ " : ""}${ev.title}* · ${prettyDate(ev.date)} ${clockShort(ev.start)}`;
}

function dayPicture(next: UserRecord, date: string, highlight?: string): MessageCard {
  const plan = buildDayPlan(next, date);
  return dayImage(plan, next, cap(dayWordFor(date, next.settings.timezone)), highlight);
}

/** Put an event on the calendar and show the day with it in. */
function commitEvent(next: UserRecord, ev: CalendarEvent, lead?: string, note?: string): ChatMessage {
  next.events = [...next.events, ev];
  next.lastLockedEventId = ev.id;
  next.draft = { type: "none", missing: [] };
  const plan = buildDayPlan(next, ev.date);
  const tz = next.settings.timezone;
  const when = dayWordFor(ev.date, tz);
  const what = ev.kind === "work" ? "marked" : ev.kind === "social" ? "on the calendar" : "added";
  const rest = ` ${freeLine(plan, next)}`;
  const nextStep = ev.kind === "work" ? " want to put some people in the rest of it?" : ev.kind === "social" ? " good. that's the bit that matters." : "";
  const text = `${lead ?? `${what}. *${ev.title}* ${when}, ${span(ev.start, ev.durationMinutes)}${note ? ` (${note})` : ""}.`}${rest}${nextStep}${tip(next, "save")}`;
  return botText(text, {
    card: dayPicture(next, ev.date, ev.title),
    buttons: ev.kind === "work" ? [B.ideas, B.undo, B.later30] : [B.undo, B.later30, B.today],
    calendarEventId: ev.id,
  });
}

/** Event with everything known: save it, unless it clashes, then ask. */
function placeEvent(next: UserRecord, ev: CalendarEvent, replies: ChatMessage[], note?: string) {
  const clash = next.events.filter((e) => {
    if (e.date !== ev.date) return false;
    // A meeting inside a work block is just work; not a clash worth asking about.
    if (e.kind === "work" && ev.kind === "work") return false;
    const a = hmToMinutes(e.start);
    const b = a + e.durationMinutes;
    const c = hmToMinutes(ev.start);
    const d = c + ev.durationMinutes;
    return Math.max(a, c) < Math.min(b, d);
  });
  if (!clash.length) {
    replies.push(commitEvent(next, ev, undefined, note));
    return;
  }
  const proposal = proposeEvent(next, ev);
  next.draft = { type: "event", event: { ...ev }, missing: [], proposal };
  const other = clash[0];
  replies.push(
    botText(`*${ev.title}* ${dayWordFor(ev.date, next.settings.timezone)} ${span(ev.start, ev.durationMinutes)} clashes with *${other.title}* (${span(other.start, other.durationMinutes)}). save it anyway?`, {
      card: dayImage(buildDayPlan({ ...next, events: [...next.events, ev] }, ev.date), next, "If we add it", ev.title),
      buttons: [btn("save", "Save anyway", "save it"), B.later30, B.cancel],
    }),
  );
}

function applyStar(next: UserRecord, hit: { kind: "event" | "todo"; id: string }, starred: boolean): string {
  if (hit.kind === "event") {
    next.events = next.events.map((e) => (e.id === hit.id ? { ...e, starred } : e));
    const ev = next.events.find((e) => e.id === hit.id);
    return ev ? (starred ? `starred ${describeEvent(ev)}. i'll remind you earlier for this one.` : `took the star off *${ev.title}*.`) : "couldn't find that event.";
  }
  next.todos = next.todos.map((t) => (t.id === hit.id ? { ...t, starred, priority: starred ? "p0" : t.priority } : t));
  const todo = next.todos.find((t) => t.id === hit.id);
  return todo ? (starred ? `starred *${todo.title}*. it goes first.` : `took the star off *${todo.title}*.`) : "couldn't find that to-do.";
}

function shiftLater(next: UserRecord, minutes: number): ChatMessage | undefined {
  if (next.draft.type === "event" && next.draft.event?.start) {
    next.draft.event.start = minutesToHM((hmToMinutes(next.draft.event.start) + minutes) % (24 * 60));
    const ev = finalizeEvent({ durationMinutes: 60, kind: "other", ...next.draft.event });
    const clashes = next.events.some((e) => e.date === ev.date && Math.max(hmToMinutes(e.start), hmToMinutes(ev.start)) < Math.min(hmToMinutes(e.start) + e.durationMinutes, hmToMinutes(ev.start) + ev.durationMinutes));
    if (!clashes) return commitEvent(next, ev, `ok, *${ev.title}* at ${clockShort(ev.start)} instead.`);
    next.draft.proposal = proposeEvent(next, ev);
    return botText(`*${ev.title}* at ${clockShort(ev.start)} still clashes. save anyway, push again, or cancel.`, {
      buttons: [btn("save", "Save anyway", "save it"), B.later30, B.cancel],
    });
  }
  const ev = next.events.find((e) => e.id === next.lastLockedEventId);
  if (!ev) return undefined;
  const start = minutesToHM((hmToMinutes(ev.start) + minutes) % (24 * 60));
  next.events = next.events.map((e) => (e.id === ev.id ? { ...e, start } : e));
  return botText(`moved *${ev.title}* to ${span(start, ev.durationMinutes)}.`, { card: dayPicture(next, ev.date, ev.title), buttons: [B.undo, B.later30, B.today] });
}

/* ------------------------------------------------------------------ */
/* first run                                                           */
/* ------------------------------------------------------------------ */

function introMessages(name: string): ChatMessage[] {
  const first = name.split(" ")[0];
  return [
    botText(`hey ${first}. i'm *Buffer*. tell me when you work and i'll show you when you're free, then nudge you to spend some of it with your people.\n\nwhen do you usually work? tap one, or type it like *class 10 to 4 mon to fri*.`, {
      buttons: WORK_BUTTONS,
    }),
  ];
}

const WORK_BUTTONS = [btn("w95", "9 to 5", "i usually work 9 to 5"), btn("w106", "10 to 6", "i usually work 10 to 6"), btn("wvar", "It varies", "it varies")];

function workQuestion(): ChatMessage {
  return botText("when do you usually work? tap one, or type it like *class 10 to 4 mon to fri*.", { buttons: WORK_BUTTONS });
}

function unwindQuestion(next: UserRecord): ChatMessage {
  const standing = standingWork(next.settings);
  const base = standing ? Math.max(standing.end, 17 * 60) : 19 * 60;
  const opts = [0, 60, 120].map((add) => minutesToHM(Math.min(base + add, 22 * 60)));
  return botText("when do you switch off for the day? tap one or type a time.", {
    buttons: opts.map((hm, i) => btn(`u${i}`, clockShort(hm), `i switch off at ${clockShort(hm)}`)),
  });
}

/** Bare hours like "2" or "02:00" for a switch-off time mean the afternoon or evening. */
function eveningHM(hm: string): string {
  const m = hmToMinutes(hm);
  return m < 10 * 60 ? minutesToHM(m + 12 * 60) : hm;
}

/** Google writes straight in (when this Buffer has a Google client); Apple and the rest subscribe to the feed. */
function calendarQuestion(): ChatMessage {
  const buttons = [btn("cal-apple", "Apple Calendar", "connect apple"), btn("cal-skip", "Not now", "no calendar")];
  if (googleConfigured()) buttons.unshift(btn("cal-google", "Google Calendar", "connect google"));
  return botText("want the plans i save in your calendar too?", { buttons });
}

function ensureCalendarToken(next: UserRecord) {
  if (!next.calendarToken) next.calendarToken = uid("cal");
}

/** The link for the calendar they picked, as words (WhatsApp cannot open webcal:// on its own, so the page does it). */
function calendarLink(next: UserRecord, which: "google" | "apple"): ChatMessage {
  const origin = siteOrigin();
  if (which === "google" && googleConfigured()) {
    return botText(`tap this, pick your google account, and allow calendar access. after that every plan i save appears there on its own.\n${googleConnectUrl(origin, next.id)}`);
  }
  ensureCalendarToken(next);
  next.calendarConnectedAt = new Date().toISOString();
  next.calendarConnectedVia = which === "google" ? "google-feed" : "apple";
  const page = `${origin.replace(/\/$/, "")}/connect/${encodeURIComponent(next.calendarToken!)}`;
  if (which === "google") return botText(`google can subscribe to my feed (it refreshes about daily):\n${page}`);
  return botText(`open this on your iphone and tap *Subscribe*. new plans show up within the hour.\n${page}`);
}

function notifyQuestion(next: UserRecord): ChatMessage {
  const wa = onWhatsApp(next);
  return botText(wa ? "last one. a nudge here in the evening to call them, when you're free? once a day at most." : "last one. an evening nudge to call them, when you're free? once a day at most. your browser asks once.", {
    buttons: [
      wa ? btn("notify", "Yes, nudge me", "notifications on") : { id: "notify", title: "Yes, nudge me", action: "notify", payload: "notifications on" },
      btn("nonotify", "No nudges", "notifications off"),
    ],
  });
}

function peopleQuestion(): ChatMessage {
  return botText("who should i help you make time for? like *mum, dad* or *my sister and rohan*.", {
    buttons: [btn("skip", "Skip this", "skip")],
  });
}

function finishSetup(next: UserRecord): ChatMessage[] {
  next.onboarding = "done";
  const people = next.people ?? [];
  const who = people.length ? people.slice(0, 2).join(" or ") : "someone you love";
  const after = clockShort(next.settings.protectEveningsAfter || "19:00");
  const verb = people.length && people.slice(0, 2).some(isGroup) ? "about" : "to call";
  const view = weekView(next);
  const nudge = next.notify === false ? "no nudges. say *nudges on* if you change your mind." : `after ${after} on free days i'll nudge you once ${verb} ${who}.`;
  const morning = next.morningOff ? "" : " every morning at 8 you get the day as a picture.";
  const legend = view.totalWork ? "your week. white is free, grey is work." : "your week. nothing marked as work yet, so it all looks free.";
  const tryLine = view.totalWork ? "try *dinner with sam fri 8pm* or *plan people time*." : "try *work 7 to 10pm today* or *class 9 to 5 every weekday*.";
  return [
    botText(`${legend} ${nudge}${morning}\n\n${tryLine}${tip(next, "picture")}`, {
      card: weekImage(view, next),
      buttons: view.totalWork ? [B.ideas, B.addWork, B.help] : [B.addWork, B.ideas, B.help],
    }),
  ];
}

/** Apply whatever a setup answer gave, then ask the next unanswered question. */
function applySetup(next: UserRecord, a: SetupUnderstanding): ChatMessage[] {
  const step = next.onboarding;
  const gotWork = Boolean((a.work_start && a.work_end) || a.work_varies);
  if (a.work_start && a.work_end) next.settings = { ...next.settings, workStart: a.work_start, workEnd: a.work_end, workLabel: a.work_label || "Work" };
  else if (a.work_varies) next.settings = { ...next.settings, workStart: "00:00", workEnd: "00:00" };
  if (a.unwind) next.settings = { ...next.settings, protectEveningsAfter: eveningHM(a.unwind), noWorkAfter: eveningHM(a.unwind) };
  if (a.people?.length) {
    const have = new Set((next.people ?? []).map((n) => n.toLowerCase()));
    next.people = [...(next.people ?? []), ...a.people.map(cap).filter((n) => !have.has(n.toLowerCase()))].slice(0, 6);
  }
  const later = step === "calendar" || step === "notify";
  const answered = {
    work: gotWork || step !== "work",
    unwind: Boolean(a.unwind) || step === "people" || later,
    people: Boolean(a.people?.length) || (step === "people" && a.skip) || later,
  };
  // Skipping the current question counts as answered.
  if (a.skip) {
    if (step === "work") {
      next.settings = { ...next.settings, workStart: "00:00", workEnd: "00:00" };
      answered.work = true;
    } else if (step === "unwind") answered.unwind = true;
  }
  const out: ChatMessage[] = [botText(a.reply)];
  if (!answered.work) {
    next.onboarding = "work";
    out.push(workQuestion());
  } else if (!answered.unwind) {
    next.onboarding = "unwind";
    out.push(unwindQuestion(next));
  } else if (!answered.people) {
    next.onboarding = "people";
    out.push(peopleQuestion());
  } else {
    next.onboarding = "calendar";
    out.push(calendarQuestion());
  }
  return out;
}

/** The setup questions, one at a time. Returns replies, or null when the text is not for setup. */
async function handleOnboarding(next: UserRecord, text: string): Promise<ChatMessage[] | null> {
  const step = next.onboarding;
  const t = text.toLowerCase().trim();
  if (!step || step === "done") return null;
  if (step === "calendar") {
    const pick = /google/.test(t) ? "google" : /apple|iphone|ios|mac/.test(t) ? "apple" : null;
    if (pick) {
      next.onboarding = "notify";
      return [calendarLink(next, pick), notifyQuestion(next)];
    }
    if (/^(no calendar|no|not now|skip|later|nah|nope|none)\b/.test(t)) {
      next.onboarding = "notify";
      return [notifyQuestion(next)];
    }
    return [botText("*Google Calendar*, *Apple Calendar*, or *Not now*.", { buttons: calendarQuestion().buttons })];
  }
  if (step === "notify") {
    if (/^notifications on$/.test(t) || /\b(allow|allowed|yes|sure|ok|okay|go ahead)\b/.test(t)) {
      next.notify = true;
      return finishSetup(next);
    }
    if (/^notifications off$/.test(t) || /\b(no|not now|later|skip|nah|nope|don't|dont)\b/.test(t)) {
      next.notify = false;
      return finishSetup(next);
    }
    return [botText("*Yes, nudge me* or *No nudges*, and we're done.", { buttons: notifyQuestion(next).buttons })];
  }
  // The model reads the answer when one is configured: loose wording, several answers at once, side questions.
  const smart = await understandSetup(step, text, next);
  if (smart) return applySetup(next, smart);
  // Let them escape the questions with the things they might type anyway.
  if (/^(skip all|skip setup|later|not now)$/.test(t)) {
    next.onboarding = "done";
    return [botText("ok. *set up again* whenever. for now: *work 7 to 10pm today* or *my week*.", { buttons: [B.addWork, B.week, B.help] })];
  }
  if (step === "work") {
    const range = parseRange(t);
    if (/\b(varies|vary|depends|no fixed|different every|not fixed|flexible|freelance|student)\b/.test(t) || /^skip$/.test(t)) {
      next.settings = { ...next.settings, workStart: "00:00", workEnd: "00:00" };
      next.onboarding = "unwind";
      return [botText("ok. tell me each day, like *work 7 to 10pm today*."), unwindQuestion(next)];
    }
    if (range) {
      const label = workLabelFor(t);
      next.settings = { ...next.settings, workStart: range.start, workEnd: range.end, workLabel: label };
      next.onboarding = "unwind";
      return [botText(`${label.toLowerCase()} ${span(range.start, range.durationMinutes)} on weekdays. got it.`), unwindQuestion(next)];
    }
    return [botText("a start and an end is enough, like *9 to 6*. or tap *It varies*.", { buttons: WORK_BUTTONS })];
  }
  if (step === "unwind") {
    const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
    if (m) {
      let h = Number(m[1]);
      const mm = Number(m[2] || 0);
      if (m[3] === "pm" && h < 12) h += 12;
      if (m[3] === "am" && h === 12) h = 0;
      if (!m[3] && h <= 11) h += 12;
      const hm = minutesToHM(h * 60 + mm);
      next.settings = { ...next.settings, protectEveningsAfter: hm, noWorkAfter: hm };
      next.onboarding = "people";
      return [botText(`ok. after ${clockShort(hm)} the day is yours.`), peopleQuestion()];
    }
    if (/\b(varies|depends|skip|not sure|dunno|don't know)\b/.test(t)) {
      next.onboarding = "people";
      return [botText("i'll go with 7 pm. *i switch off at 8pm* changes it."), peopleQuestion()];
    }
    return [botText("a time is enough, like *7pm* or *around 8:30*.", { buttons: unwindQuestion(next).buttons })];
  }
  if (step === "people") {
    const people = parsePeople(text);
    next.people = people;
    next.onboarding = "notify";
    const list = people.length > 1 ? `${people.slice(0, -1).join(", ")} and ${people[people.length - 1]}` : people[0];
    next.onboarding = "calendar";
    return [botText(people.length ? `${list}. got it.` : "no one for now. *nudge me to call mum* adds someone later."), calendarQuestion()];
  }
  return null;
}

/** Start the chat for a brand new person: intro plus the first question. */
export function beginChat(user: UserRecord): UserRecord {
  return {
    ...user,
    onboarding: "work",
    messages: [...user.messages, ...introMessages(user.name)],
    updatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* the turn                                                            */
/* ------------------------------------------------------------------ */

export async function processTurn(user: UserRecord, text: string): Promise<{ user: UserRecord; replies: ChatMessage[] }> {
  const now = new Date().toISOString();
  const incoming = userText(text);
  const next: UserRecord = {
    ...user,
    messages: [...user.messages, incoming],
    lastSeenAt: now,
    updatedAt: now,
  };
  const replies: ChatMessage[] = [];
  const push = (m: ChatMessage | ChatMessage[]) => {
    replies.push(...(Array.isArray(m) ? m : [m]));
  };
  const done = () => {
    // A picture is its own bubble and every picture goes out before any words.
    for (let i = replies.length - 1; i >= 0; i--) {
      const m = replies[i];
      if (m.card?.type === "image" && m.text.trim()) {
        replies.splice(i, 1, { ...m, id: uid("msg"), text: "", buttons: undefined, list: undefined }, { ...m, card: undefined });
      }
    }
    replies.sort((a, b) => Number(b.card?.type === "image") - Number(a.card?.type === "image"));
    // Three buttons under the reply (the last bubble): the ones the branch chose, then the most useful defaults.
    const settingUp = Boolean(next.onboarding && next.onboarding !== "done");
    const i = replies.length - 1;
    const m = replies[i];
    if (m && !m.list && !settingUp && (m.buttons?.length ?? 0) < 3) {
      const have = m.buttons ?? [];
      const seen = new Set(have.map((b) => b.payload ?? b.action));
      const extra = DEFAULT_BUTTONS.filter((b) => !seen.has(b.payload)).slice(0, 3 - have.length);
      replies[i] = { ...m, buttons: [...have, ...extra] };
    }
    next.messages = [...next.messages, ...replies];
    return { user: next, replies };
  };
  const tz = next.settings.timezone;
  const todayISO = dateISO(nowInZone(tz));
  const lower = text.trim().toLowerCase();

  // --- first run: the three setup questions
  const onboard = await handleOnboarding(next, text);
  if (onboard) {
    push(onboard);
    return done();
  }

  // --- fast paths: button payloads and one-word commands. No model call needed.
  if (/^(set ?up again|set ?up|start over|restart setup|redo setup)$/.test(lower)) {
    next.onboarding = "work";
    push(botText("sure, let's redo it."));
    push(workQuestion());
    return done();
  }
  if (/^undo$/.test(lower)) {
    const ev = next.events.find((e) => e.id === next.lastLockedEventId);
    if (!ev) {
      push(botText("nothing to undo just now."));
    } else {
      next.events = next.events.filter((e) => e.id !== ev.id);
      next.lastLockedEventId = undefined;
      push(botText(`removed *${ev.title}*.`, { card: dayPicture(next, ev.date), buttons: [B.today, B.week] }));
    }
    return done();
  }
  const later = lower.match(/^(?:make it |push it |move it )?(?:\+)?\s*(\d+)\s*(m|min|mins|minutes|h|hour|hours)?\s*later$/) || (/^\+30 min$/.test(lower) ? ["", "30", "m"] : null);
  if (later) {
    const n = Number(later[1] || 30);
    const add = /^h/.test(later[2] || "m") ? n * 60 : n;
    const m = shiftLater(next, add);
    push(m ?? botText("nothing to move yet. add something first, like *work 7 to 10pm today*."));
    return done();
  }
  const resize = lower.match(/^(?:make it|change it to|set it to|it's|its)\s+(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minutes)$/);
  if (resize) {
    const n = Number(resize[1]);
    const minutes = /^h/.test(resize[2]) ? Math.round(n * 60) : Math.round(n);
    const ev = next.events.find((e) => e.id === next.lastLockedEventId);
    if (ev && minutes > 0) {
      next.events = next.events.map((e) => (e.id === ev.id ? { ...e, durationMinutes: minutes } : e));
      push(botText(`ok, *${ev.title}* is now ${span(ev.start, minutes)}.`, { card: dayPicture(next, ev.date, ev.title), buttons: [B.undo, B.today] }));
    } else {
      push(botText("nothing to resize yet."));
    }
    return done();
  }
  if (/^add work$/.test(lower)) {
    next.draft = { type: "event", event: { title: "Work", kind: "work" }, missing: ["date", "time"] };
    push(botText("when? say it the way you'd say it: *7 to 10pm today*, *9 to 5 tomorrow*, or *every weekday from 9 to 5* if it repeats.", { buttons: [B.cancel] }));
    return done();
  }
  if (/^add something$/.test(lower)) {
    push(botText("what and when? like *dinner with sam friday 8pm*, or *remind me to renew my passport* for a to-do."));
    return done();
  }
  // A block dragged on the day picture arrives as "move Work to 8 pm today"; ask before moving it.
  const dragged = lower.match(/^move (.+?) to (\d{1,2}(?::\d{2})?\s*(?:am|pm)) (today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|\d{4}-\d{2}-\d{2})$/);
  if (dragged) {
    const title = dragged[1].trim();
    const t = dragged[2].replace(/\s+/g, "");
    let h = Number(t.match(/^\d{1,2}/)![0]);
    const mm = Number(t.match(/:(\d{2})/)?.[1] ?? 0);
    if (/pm$/.test(t) && h < 12) h += 12;
    if (/am$/.test(t) && h === 12) h = 0;
    const start = minutesToHM(h * 60 + mm);
    const word = dragged[3];
    const date = /^\d{4}/.test(word) ? word : word === "today" ? todayISO : word === "tomorrow" ? addDaysISO(todayISO, 1) : (() => {
      const target = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(word);
      let delta = (target - new Date(`${todayISO}T12:00:00`).getDay() + 7) % 7;
      if (delta === 0) delta = 7;
      return addDaysISO(todayISO, delta);
    })();
    const ev = next.events.find((e) => e.date === date && e.title.toLowerCase() === title.toLowerCase()) ?? next.events.find((e) => e.date === date && e.title.toLowerCase().includes(title.toLowerCase()));
    if (!ev) {
      push(botText(`i can't find *${cap(title)}* on ${dayWordFor(date, tz)} any more. say *${dayWordFor(date, tz)}* for a fresh picture.`));
      return done();
    }
    if (ev.start === start) {
      push(botText(`*${ev.title}* is already at ${clockShort(start)}.`, { card: dayPicture(next, ev.date, ev.title), buttons: [B.today, B.week] }));
      return done();
    }
    const moved: UserRecord = { ...next, events: next.events.map((e) => (e.id === ev.id ? { ...e, start } : e)) };
    const plan = buildDayPlan(moved, ev.date);
    next.draft = { type: "edit", missing: [], edit: { kind: "event", id: ev.id, title: ev.title, summary: `*${ev.title}* moved to ${span(start, ev.durationMinutes)}`, eventPatch: { start } } };
    push(
      botText(`move *${ev.title}* to ${span(start, ev.durationMinutes)}? ${freeLine(plan, moved)}`, {
        card: dayImage(plan, moved, cap(dayWordFor(ev.date, tz)), ev.title),
        buttons: [btn("apply", "Yes, move it", "make the change"), btn("leave", "Leave it", "leave it"), B.today],
        calendarEventId: ev.id,
      }),
    );
    return done();
  }
  // "i said not friday", "except fridays", "mon to thu only": which days the standing hours fall on.
  const standing = standingWork(next.settings);
  const dayFix = lower.replace(/^(?:i said|i meant|sorry|no|nope|oops|wait)[,.!]?\s*/, "").replace(/[.!]+$/, "").trim();
  const skipDays = dayFix.match(/^(?:not|no|except|excluding|minus|but not|without|skip|remove|drop)\s+(?:on\s+)?((?:(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*s?)(?:(?:\s*,\s*|\s+and\s+|\s*&\s*|\s+or\s+)(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*s?)*)(?:\s+(?:off|free|though|please))?$/);
  const onlyDays = dayFix.match(/^(?:only |just )?((?:sun|mon|tue|wed|thu|fri|sat)[a-z]*\s*(?:to|-|through|thru|till|until)\s*(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*)(?:\s+only)?$/);
  if (standing && (skipDays || onlyDays)) {
    const days = skipDays ? (next.settings.workDays ?? WEEKDAYS).filter((d) => !dayNumbersIn(skipDays[1]).includes(d)) : dayNumbersIn(onlyDays![1]);
    next.settings = { ...next.settings, workDays: days };
    const label = (next.settings.workLabel || "work").toLowerCase();
    push(botText(`${label} ${span(minutesToHM(standing.start), standing.end - standing.start)}, ${describeDays(days)}. got it.`, { buttons: [B.week, B.ideas] }));
    return done();
  }
  if (/^(?:disconnect|unlink|forget|remove) (?:my )?(?:google|gcal|google calendar)$/.test(lower)) {
    const had = Boolean(next.google);
    Object.assign(next, disconnectGoogle(next));
    delete next.google;
    delete next.googleSynced;
    push(botText(had ? "google calendar disconnected. what i already put there stays; nothing new goes in." : "google calendar wasn't connected."));
    return done();
  }
  if (/^(?:connect|link|sync|set ?up) (?:my |to |with )?(?:google|gcal|google calendar)$|^connect google$/.test(lower)) {
    push(calendarLink(next, "google"));
    return done();
  }
  if (/^(?:connect|link|sync|set ?up) (?:my |to |with )?(?:apple|iphone|ios|apple calendar|icloud)(?: calendar)?$|^connect apple$/.test(lower)) {
    push(calendarLink(next, "apple"));
    return done();
  }
  if (/^(?:connect|link|sync) (?:my |a )?calendar$/.test(lower) && onWhatsApp(next)) {
    push(calendarQuestion());
    return done();
  }
  if (/^(?:no|stop|turn off|skip) (?:the )?morning (?:picture|pictures|snapshot|digest|message|messages)$/.test(lower)) {
    next.morningOff = true;
    push(botText("ok, no morning picture. *morning picture on* brings it back."));
    return done();
  }
  if (/^morning (?:picture|pictures|snapshot|digest) on$/.test(lower)) {
    next.morningOff = false;
    push(botText("morning picture is back, 8 am."));
    return done();
  }
  if (/^notifications (on|off)$/.test(lower)) {
    next.notify = lower.endsWith("on");
    push(botText(next.notify ? `nudges on. after ${clockShort(next.settings.protectEveningsAfter || "19:00")} on free days, once a day.` : "nudges off."));
    return done();
  }
  if (/^who do i call\??$/.test(lower)) {
    const p = next.people ?? [];
    push(
      botText(
        p.length
          ? `i nudge you to call ${p.join(", ")} when you're free after ${clockShort(next.settings.protectEveningsAfter || "19:00")}. add someone with *nudge me to call X*, or say *forget about X*.`
          : "no one yet. say *nudge me to call mum* and i'll add her.",
      ),
    );
    return done();
  }
  const callLater = lower.match(/^remind me to call (.+?) later tonight$/);
  if (callLater) {
    const who = cap(callLater[1]);
    const n = nowInZone(tz);
    const mins = n.getHours() * 60 + n.getMinutes() + 90;
    const sleep = hmToMinutes(next.settings.sleepTime || "23:00");
    const start = minutesToHM(Math.min(mins, Math.max(sleep - 45, mins)) % (24 * 60));
    const ev = finalizeEvent({ title: `Call ${who}`, kind: "social", date: todayISO, start, durationMinutes: 20 });
    next.events = [...next.events, ev];
    next.lastLockedEventId = ev.id;
    push(botText(`ok. i'll ping you at ${clockShort(start)} for *Call ${who}*.`, { buttons: [B.undo, B.today] }));
    return done();
  }
  if (/^(?:nudge|remind|prompt) me to call\s*$/.test(lower)) {
    push(botText("who should i nudge you about? type a name or two, like *mum* or *my sister and rohan*."));
    return done();
  }
  const addPerson = lower.match(/^(?:nudge|remind|prompt) me to call (.+?)(?: when i'?m free| when i am free| sometimes| more)?\.?$/);
  if (addPerson) {
    const names = parsePeople(addPerson[1]);
    if (names.length) {
      const have = new Set((next.people ?? []).map((n) => n.toLowerCase()));
      next.people = [...(next.people ?? []), ...names.filter((n) => !have.has(n.toLowerCase()))].slice(0, 6);
      push(botText(`added. i'll nudge you to call ${names.join(" and ")} when you're free after ${clockShort(next.settings.protectEveningsAfter || "19:00")}.`));
      return done();
    }
  }
  const forget = lower.match(/^(?:forget about|remove|drop) (.+?)(?: from my people| from the list)?\.?$/);
  if (forget && next.people?.some((n) => n.toLowerCase() === forget[1].trim())) {
    next.people = next.people.filter((n) => n.toLowerCase() !== forget[1].trim());
    push(botText(`ok, no more nudges about ${cap(forget[1].trim())}.`));
    return done();
  }
  // Replies to the evening nudge.
  const callingNow = lower.match(/^calling (.+?) now$/);
  if (callingNow) {
    const who = cap(callingNow[1]);
    const n = nowInZone(tz);
    const start = minutesToHM(Math.floor((n.getHours() * 60 + n.getMinutes()) / 5) * 5);
    const title = isGroup(who) ? `Time with ${who.toLowerCase()}` : `Call ${who}`;
    const ev = finalizeEvent({ title, kind: "social", date: todayISO, start, durationMinutes: isGroup(who) ? 45 : 20 });
    next.events = [...next.events, ev];
    next.lastLockedEventId = ev.id;
    push(botText(`${isGroup(who) ? "go on then, enjoy it." : "go on then. say hi from me."}\n\ni've put *${title}* on today so it counts.`, { buttons: [B.today, B.undo, B.week] }));
    return done();
  }
  if (/^skip the call today$/.test(lower)) {
    push(botText("no worries. tomorrow, maybe."));
    return done();
  }

  // --- everything else: understand the text (Claude when a key is set, rules otherwise)
  const parsed = await understand(text, user);
  next.lastNlp = parsed.debug;
  next.notes = rememberNotes(user.notes, parsed.memoryNotes);
  // Someone mentioned in passing ("...and remind me to spend time with my roommates too") joins the nudge list.
  const newPeople = (parsed.people ?? []).map(cap).filter((n) => !(next.people ?? []).some((p) => p.toLowerCase() === n.toLowerCase()));
  if (newPeople.length) next.people = [...(next.people ?? []), ...newPeople].slice(0, 6);
  const peopleLine = newPeople.length ? `\ni'll nudge you about ${newPeople.join(" and ")} too.` : "";
  const hasSlots = Boolean(parsed.event.date || parsed.event.start || parsed.event.durationMinutes || parsed.event.kind);

  if (parsed.intent === "options") {
    push(optionsMessage());
  } else if (parsed.intent === "clarify" && parsed.question) {
    push(
      botText(parsed.question, {
        buttons: (parsed.options ?? []).slice(0, 3).map((o, i) => ({ id: `clar-${i}`, title: o.title, payload: o.payload })),
      }),
    );
  } else if (parsed.intent === "week" || parsed.intent === "free_time") {
    const view = weekView(next);
    const lead = !view.totalWork
      ? "nothing is marked as work yet, so the week looks wide open. tell me your work and this gets real: *work 9 to 5 tomorrow*."
      : view.totalFree
        ? "here's your week. white is free, grey is work."
        : "the next 7 days are full edge to edge. that's the first thing to fix.";
    const best = view.best.length && view.totalWork ? `\nyour biggest open stretch is ${windowLabel(view.best[0])}.` : "";
    const nudge = view.best.length && view.totalWork ? " want me to reserve it for you?" : "";
    const buttons = view.best.slice(0, 2).map((w, i) => btn(`keep-${i}`, `Reserve ${slotName(w)}`, protectPayload(w, tz, "me")));
    push(
      botText(`${lead}${best}${nudge}${view.best.length ? tip(next, "keep") : ""}${tip(next, "picture")}`, {
        card: weekImage(view, next),
        buttons: [B.ideas, ...buttons].slice(0, 3),
      }),
    );
  } else if (parsed.intent === "plan_free") {
    const view = weekView(next);
    const picks = suggestForFreeTime(next, view);
    if (!picks.length) {
      push(botText("i can't find a 30-minute gap in the next week. say *reserve thursday evening* and i'll make one.", { buttons: [btn("keep", "Reserve an evening", "reserve an evening this week")] }));
    } else {
      const who = (next.people ?? []).length ? "" : "\n(tell me who matters with *nudge me to call mum* and these get personal.)";
      const lines = picks.map((p) => `• ${suggestionLine(p)}`);
      push(
        botText(`here's where people could go this week:\n${lines.join("\n")}\n\ntap one and it's on your calendar. or tell me your own: *dinner with sam friday 8pm*.${who}`, {
          card: weekImage(view, next),
          buttons: picks.map((p, i) => btn(`idea-${i}`, p.label, suggestionPayload(p, tz))),
        }),
      );
    }
  } else if (parsed.intent === "protect") {
    const view = weekView(next);
    const kind = parsed.event.kind === "social" || /\b(people|friends|family)\b/.test(parsed.normalized) ? "social" : "personal";
    let date = parsed.event.date;
    let start = parsed.event.start;
    let duration = parsed.event.durationMinutes;
    if (!date || !start) {
      const candidates = date ? view.best.filter((w) => w.date === date) : view.best.filter((w) => w.slot !== "day");
      const w = candidates[0] ?? view.best[0];
      if (!w) {
        push(botText("there's no open evening left this week to reserve. tell me a day and time and i'll clear it, like *reserve saturday 10am to 12*."));
        return done();
      }
      date = w.date;
      start = start ?? minutesToHM(w.startMin);
      duration = duration ?? Math.min(120, w.endMin - w.startMin);
    }
    duration = duration ?? 120;
    const custom =
      parsed.event.title && !/^(protect|keep|hold|block|free|evening|weekend|kept|reserve|reserved)/i.test(parsed.event.title) && !/(for me|for people|for myself)/i.test(parsed.event.title) ? parsed.event.title : undefined;
    const ev = finalizeEvent(protectedEvent(date, start, duration, kind, custom));
    next.events = [...next.events, ev];
    next.lastLockedEventId = ev.id;
    push(
      botText(`reserved: *${ev.title}* · ${describeWindow(ev.date, ev.start, ev.durationMinutes)}.${tip(next, "keep")}`, {
        card: dayPicture(next, ev.date, ev.title),
        buttons: [btn("ideas", "Ideas for this slot", "what should i do with my free time"), B.undo, B.week],
        calendarEventId: ev.id,
      }),
    );
  } else if (parsed.intent === "set_pref") {
    if (parsed.prefs.protectEveningsAfter) parsed.prefs.protectEveningsAfter = eveningHM(parsed.prefs.protectEveningsAfter);
    if (parsed.prefs.noWorkAfter) parsed.prefs.noWorkAfter = eveningHM(parsed.prefs.noWorkAfter);
    // Only what actually changed gets said; the model sometimes echoes settings that were already so.
    const before = next.settings;
    const p = Object.fromEntries(Object.entries(parsed.prefs).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k as keyof typeof before]))) as typeof parsed.prefs;
    // "except fridays" in the same breath as the hours applies to the hours, not to the old days.
    if (p.workDays && !p.workStart && !before.workDays && exceptDaysIn(parsed.normalized)) p.workDays = WEEKDAYS.filter((d) => !exceptDaysIn(parsed.normalized)!.days.includes(d));
    next.settings = { ...next.settings, ...p };
    if (next.draft.type === "event" && p.workStart) next.draft = { type: "none", missing: [] };
    const bits: string[] = [];
    const hours = standingWork(next.settings);
    if ((p.workStart || p.workEnd || p.workDays) && hours) bits.push(`${(next.settings.workLabel || "work").toLowerCase()} ${span(minutesToHM(hours.start), hours.end - hours.start)}, ${describeDays(next.settings.workDays)}`);
    if (p.protectEveningsAfter || p.noWorkAfter) bits.push(`after ${clockShort(p.protectEveningsAfter || p.noWorkAfter!)} the day is yours`);
    if (p.socialMinutesPerDay !== undefined) bits.push(p.socialMinutesPerDay ? `${durationLabel(p.socialMinutesPerDay)} a day for people` : "no daily people block");
    if (p.maxWorkMinutesPerDay) bits.push(`max ${durationLabel(p.maxWorkMinutesPerDay)} of work a day`);
    if (p.wakeTime) bits.push(`up at ${clockShort(p.wakeTime)}`);
    if (p.sleepTime) bits.push(`asleep by ${clockShort(p.sleepTime)}`);
    push(botText(bits.length ? `${bits.join(", ")}. got it.` : "already set that way.", { buttons: [B.week, B.ideas] }));
  } else if (parsed.intent === "calendar") {
    // A mis-read "add it to gcal" may have opened a junk draft; drop it.
    if (next.draft.type === "event" && (!next.draft.event?.start || /gcal|calendar/i.test(next.draft.event?.title ?? ""))) next.draft = { type: "none", missing: [] };
    const ev = next.events.find((e) => e.id === next.lastLockedEventId) || [...next.events].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0];
    const connected = Boolean(next.calendarConnectedAt);
    if (!ev) {
      push(botText("nothing saved yet. mark something first, like *work 7 to 10pm today*.", { buttons: [B.addWork, B.ideas, { id: "connect", title: "Connect live feed", action: "connect-feed" }] }));
    } else {
      push(
        botText(`*${ev.title}* · ${dayWordFor(ev.date, tz)} ${span(ev.start, ev.durationMinutes)}.${tip(next, "calendar")}`, {
          buttons: calendarButtons(connected),
          calendarEventId: ev.id,
        }),
      );
    }
  } else if (next.draft.type === "edit" && parsed.intent === "confirm" && next.draft.edit) {
    const edit = next.draft.edit;
    if (edit.kind === "event") {
      next.events = edit.remove ? next.events.filter((e) => e.id !== edit.id) : next.events.map((e) => (e.id === edit.id ? { ...e, ...edit.eventPatch } : e));
    } else {
      next.todos = edit.remove ? next.todos.filter((t) => t.id !== edit.id) : next.todos.map((t) => (t.id === edit.id ? { ...t, ...edit.todoPatch } : t));
    }
    next.draft = { type: "none", missing: [] };
    const ev = edit.kind === "event" ? next.events.find((e) => e.id === edit.id) : undefined;
    push(botText(`done. ${edit.summary}`, ev ? { card: dayPicture(next, ev.date, ev.title), buttons: [B.today, B.week] } : undefined));
  } else if (next.draft.type === "edit" && parsed.intent === "cancel") {
    next.draft = { type: "none", missing: [] };
    push(botText("left it as it was."));
  } else if (next.draft.type === "reshuffle" && parsed.intent === "confirm" && next.draft.reshuffle) {
    const rs = next.draft.reshuffle;
    next.todos = next.todos.map((t) => {
      const patch = rs.todos.find((p) => p.id === t.id);
      return patch ? { ...t, plannedDate: patch.plannedDate, plannedStart: patch.plannedStart } : t;
    });
    next.draft = { type: "none", missing: [] };
    const ev = next.events.find((e) => e.id === rs.eventId);
    const date = ev?.date || todayISO;
    push(botText(`to-dos now wrap around *${ev?.title || "that event"}*.`, { card: dayPicture(next, date), buttons: [B.today] }));
  } else if (next.draft.type === "reshuffle" && parsed.intent === "cancel") {
    next.draft = { type: "none", missing: [] };
    push(botText("left the order as it was."));
  } else if (parsed.intent === "calendar_connected") {
    const via = parsed.normalized.match(/\bconnected (?:my )?(google|apple|outlook|copy|snapshot)\b/)?.[1] || "your";
    next.calendarConnectedAt = now;
    next.calendarConnectedVia = via;
    push(botText(`connected. *${connectedLabel(via)}* follows your Buffer feed now; it refreshes every few hours. for right now, *Add to Google Cal*.`));
  } else if (next.draft.type === "event" && parsed.intent === "cancel") {
    next.draft = { type: "none", missing: [] };
    push(botText("dropped it."));
  } else if (next.draft.type === "event" && parsed.intent === "confirm") {
    if (next.draft.proposal && next.draft.event) {
      push(commitEvent(next, finalizeEvent({ durationMinutes: 60, kind: "other", ...next.draft.event })));
    } else {
      const missing = missingEventFields(next.draft.event);
      if (missing.length) push(askMessage(missing, next.draft.event));
      else placeEvent(next, finalizeEvent({ durationMinutes: 60, kind: "other", ...next.draft.event }), replies);
    }
  } else if (parsed.intent === "edit_item") {
    const named = findNamedItem(next, parsed.targetHint || "") || findNamedItem(next, parsed.event.title || text);
    if (!named) {
      push(botText("i couldn't tell which one you meant. name it like it shows on your day, e.g. *move gym to 8pm*."));
    } else if (named.kind === "event") {
      const patch: Partial<CalendarEvent> = {};
      const bits: string[] = [];
      if (parsed.renameTo) {
        const title = parsed.renameTo.replace(/^(to)\s+/, "");
        patch.title = cap(title);
        bits.push(`rename to *${patch.title}*`);
      }
      if (parsed.event.date && parsed.event.date !== named.event.date) {
        patch.date = parsed.event.date;
        bits.push(`move to ${prettyDate(patch.date)}`);
      }
      if (parsed.event.start && parsed.event.start !== named.event.start) {
        patch.start = parsed.event.start;
        bits.push(`move it to ${clockShort(patch.start)}`);
      }
      if (parsed.event.durationMinutes && parsed.event.durationMinutes !== named.event.durationMinutes) {
        patch.durationMinutes = parsed.event.durationMinutes;
        bits.push(`length ${durationLabel(patch.durationMinutes)}`);
      }
      if (parsed.event.kind && parsed.event.kind !== named.event.kind) {
        patch.kind = parsed.event.kind;
        bits.push(`kind ${patch.kind}`);
      }
      if (!bits.length) {
        push(botText(`that's *${named.event.title}* already. say what to change: time, day, or length.`));
      } else {
        const summary = bits.join(", ");
        next.draft = { type: "edit", missing: [], edit: { kind: "event", id: named.event.id, title: named.event.title, summary: `*${named.event.title}*: ${summary}`, eventPatch: patch } };
        push(botText(`found ${describeEvent(named.event)}.\ni can ${summary}. tap *Make the change* to apply it.`, { buttons: CHANGE_BUTTONS, calendarEventId: named.event.id }));
      }
    } else {
      const patch: Partial<TodoItem> = {};
      const bits: string[] = [];
      if (parsed.renameTo) {
        const title = parsed.renameTo.replace(/^(to)\s+/, "");
        patch.title = cap(title);
        bits.push(`rename to *${patch.title}*`);
      }
      if (parsed.event.date && parsed.event.date !== named.todo.dueDate) {
        patch.dueDate = parsed.event.date;
        bits.push(`due ${prettyDate(patch.dueDate)}`);
      }
      if (parsed.todo.estimatedMinutes && parsed.todo.estimatedMinutes !== named.todo.estimatedMinutes) {
        patch.estimatedMinutes = parsed.todo.estimatedMinutes;
        bits.push(`takes ${durationLabel(patch.estimatedMinutes)}`);
      }
      if (parsed.todo.priority && parsed.todo.priority !== named.todo.priority) {
        patch.priority = parsed.todo.priority;
        bits.push(parsed.todo.priority === "p0" || parsed.todo.priority === "p1" ? "bump it up" : "lower priority");
      }
      if (parsed.todo.kind && parsed.todo.kind !== named.todo.kind) {
        patch.kind = parsed.todo.kind;
        bits.push(`kind ${patch.kind}`);
      }
      if (!bits.length) {
        push(botText(`that's the to-do *${named.todo.title}*. say the change: due day, how long it takes, or *star ${named.todo.title}*.`));
      } else {
        const summary = bits.join(", ");
        next.draft = { type: "edit", missing: [], edit: { kind: "todo", id: named.todo.id, title: named.todo.title, summary: `*${named.todo.title}*: ${summary}`, todoPatch: patch } };
        push(botText(`found to-do *${named.todo.starred ? "★ " : ""}${named.todo.title}*.\ni can ${summary}. tap *Make the change* to apply it.`, { buttons: CHANGE_BUTTONS }));
      }
    }
  } else if (next.draft.type === "event" && parsed.intent === "add_event" && parsed.event.title && !sameishTitle(next.draft.event?.title, parsed.event.title) && (parsed.event.date || parsed.event.start) && next.draft.event?.title !== "Work") {
    // They started something new mid-question: switch to it.
    const ev: ConversationDraft["event"] = { ...parsed.event };
    if (!ev.durationMinutes) ev.durationMinutes = 60;
    const missing = missingEventFields(ev);
    next.draft = { type: "event", event: ev, missing };
    if (missing.length) push(askMessage(missing, ev));
    else placeEvent(next, finalizeEvent(ev), replies);
  } else if (next.draft.type === "event" && next.draft.event?.kind === "work" && (isStandingLanguage(parsed.normalized) || /\b(all|every|each) (week)?days?\b|\bweekdays\b|\bmon(day)? (to|-) fri(day)?\b/.test(parsed.normalized)) && (parsed.event.start || next.draft.event.start)) {
    // "which day is Work?" answered with "all weekdays": that is a standing block, not one event.
    const start = parsed.event.start || next.draft.event.start!;
    const minutes = parsed.event.durationMinutes || next.draft.event.durationMinutes || 480;
    const label = workLabelFor(parsed.normalized) === "Work" ? next.settings.workLabel || "Work" : workLabelFor(parsed.normalized);
    next.settings = { ...next.settings, workStart: start, workEnd: minutesToHM((hmToMinutes(start) + minutes) % (24 * 60)), workLabel: label };
    next.draft = { type: "none", missing: [] };
    push(botText(`${label.toLowerCase()} ${span(start, minutes)}, ${describeDays(next.settings.workDays)}. got it.`, { buttons: [B.week, B.ideas] }));
  } else if (next.draft.type === "event" && (parsed.intent === "add_event" || parsed.intent === "unknown" || hasSlots)) {
    next.draft = applyEventPatch(next.draft, parsed);
    if (next.draft.missing.length) {
      push(askMessage(next.draft.missing, next.draft.event));
    } else if (next.draft.event) {
      const ev = { ...next.draft.event };
      let note: string | undefined;
      if (!ev.durationMinutes) {
        ev.durationMinutes = ev.kind === "work" ? 120 : 60;
        note = `i assumed ${durationLabel(ev.durationMinutes)}, say *make it 2h* if not`;
      }
      placeEvent(next, finalizeEvent(ev), replies, note);
    }
  } else if (next.draft.type === "event") {
    const title = next.draft.event?.title || "that";
    push(botText(`still on *${title}*. give me the time, or tap *Cancel*.`, { buttons: [B.cancel] }));
  } else if (parsed.intent === "confirm") {
    push(botText("nothing waiting on a yes right now. tell me what's on, or ask for *my week*.", { buttons: [B.week, B.today, B.addWork] }));
  } else if (parsed.intent === "cancel") {
    push(botText("nothing to cancel. all good."));
  } else if (parsed.intent === "star" || parsed.intent === "unstar") {
    const starred = parsed.intent === "star";
    const thisOne = /\bthis (event|task|to-?do|one)\b/.test(parsed.normalized);
    let hit: { kind: "event" | "todo"; id: string } | undefined = thisOne && next.lastLockedEventId ? { kind: "event", id: next.lastLockedEventId } : undefined;
    if (!hit) {
      const named = findNamedItem(next, parsed.targetHint || parsed.event.title || text);
      if (named) hit = { kind: named.kind, id: named.kind === "event" ? named.event.id : named.todo.id };
    }
    if (!hit && next.lastLockedEventId) hit = { kind: "event", id: next.lastLockedEventId };
    if (!hit) push(botText("which one? name the event or to-do, like *star gym*."));
    else push(botText(applyStar(next, hit, starred)));
  } else if (parsed.intent === "reshuffle") {
    const ev = next.events.find((e) => e.id === next.lastLockedEventId) || next.events[next.events.length - 1];
    if (!ev) {
      push(botText("add an event first, then i can slide to-dos around it."));
    } else {
      const plan = buildDayPlan(next, ev.date);
      const todos = plan.blocks.filter((b) => b.kind === "todo" && b.id).map((b) => ({ id: b.id as string, plannedDate: ev.date, plannedStart: minutesToHM(b.startMin) }));
      next.draft = { type: "reshuffle", missing: [], reshuffle: { eventId: ev.id, todos, summary: `slide ${todos.length} to-do${todos.length === 1 ? "" : "s"} around ${ev.title}` } };
      push(botText(`here's how to-dos would wrap around *${ev.title}*. tap *Make the change* to keep this order.`, { card: dayImage(plan, next, prettyDate(ev.date)), buttons: CHANGE_BUTTONS }));
    }
  } else if (parsed.intent === "day_off") {
    const date = parsed.event.date || todayISO;
    const label = (next.settings.workLabel || "work").toLowerCase();
    const backOn = /\b(back on|is on|not off|after all|back to normal)\b/.test(parsed.normalized);
    if (backOn) {
      next.daysOff = (next.daysOff ?? []).filter((d) => d !== date);
      push(botText(`ok, ${label} is back on ${dayWordFor(date, tz)}.`, { buttons: [B.today, B.week] }));
    } else {
      if (!next.daysOff?.includes(date)) next.daysOff = [...(next.daysOff ?? []), date].slice(-30);
      const plan = buildDayPlan(next, date);
      push(botText(`ok, no ${label} ${dayWordFor(date, tz)}. ${freeLine(plan, next)}`, { buttons: [B.ideas, B.today, B.week] }));
    }
  } else if (parsed.intent === "schedule") {
    const date = parsed.event.date || todayISO;
    const plan = buildDayPlan(next, date);
    const isToday = date === todayISO;
    const label = isToday ? "today" : dayWordFor(date, tz);
    const busy = plan.blocks.some((b) => b.kind !== "free" && b.kind !== "sleep");
    if (!busy) {
      push(botText(`nothing on ${label} yet. tell me what's on, like *work 9 to 5* or *dinner with sam at 8*.`, { card: dayPicture(next, date), buttons: [B.addWork, B.week] }));
    } else {
      const warn = plan.overlaps.length ? `\n${plan.warnings.filter((w) => w.startsWith("Overlap")).slice(0, 1).join("")}` : "";
      push(botText(`here's ${label}. ${freeLine(plan, next)}${warn}${tip(next, "picture")}`, { card: dayPicture(next, date), buttons: [B.week, B.addWork, B.ideas] }));
    }
  } else if (parsed.intent === "overlaps") {
    const date = parsed.event.date || todayISO;
    const plan = buildDayPlan(next, date);
    push(botText(plan.overlaps.length ? "you've got clashes. want me to slide the flexible stuff?" : "no clashes today.", { type: "overlaps", items: plan.overlaps.length ? plan.warnings : ["No overlapping events."] }));
  } else if (parsed.intent === "todos") {
    push(botText("your to-dos:", { card: { type: "todos", lines: renderTodos(next) }, buttons: [B.today, B.add] }));
  } else if (parsed.intent === "complete_todo") {
    const hint = parsed.todo.doneHint || parsed.todo.title || "";
    const hit = findTodo(next, hint);
    if (!hit) {
      push(botText(`couldn't find a to-do like "${hint}".`, { buttons: [B.todos] }));
    } else {
      next.todos = next.todos.map((t) => (t.id === hit.id ? { ...t, done: true } : t));
      push(botText(`nice, *${hit.title}* done.`));
    }
  } else if (parsed.intent === "add_todo") {
    let parentId: string | null = null;
    if (parsed.todo.parentHint) parentId = findTodo(next, parsed.todo.parentHint)?.id ?? null;
    const titles = (parsed.todo.items?.length ? parsed.todo.items : [parsed.todo.title || text.split("\n")[0].trim()]).filter((t) => t && t.length > 1);
    if (!titles.length) {
      push(botText("that came through empty. try:\n• buy milk\n• call jordan"));
    } else {
      const added: TodoItem[] = titles.map((title) => ({
        id: uid("todo"),
        title,
        priority: parsed.todo.priority || "p2",
        parentId,
        estimatedMinutes: parsed.todo.estimatedMinutes || 45,
        dueDate: parsed.todo.dueDate,
        done: false,
        kind: parsed.todo.kind || "work",
        createdAt: now,
      }));
      next.todos = [...next.todos, ...added];
      if (added.length > 1) {
        push(botText(`added ${added.length} to-dos:\n${added.map((t) => `• ${t.title}`).join("\n")}${tip(next, "todo")}`, { buttons: [B.todos, B.today] }));
      } else {
        const t = added[0];
        const due = t.dueDate ? `, due ${prettyDate(t.dueDate)}` : "";
        push(botText(`added *${t.title}* to your to-dos${due}.${tip(next, "todo")}`, { buttons: [B.todos, B.today] }));
      }
    }
  } else if (parsed.intent === "add_event" || (parsed.intent === "unknown" && parsed.event.start)) {
    const ev: ConversationDraft["event"] = { ...parsed.event };
    if (!ev.kind) ev.kind = "other";
    if (ev.kind === "work" && !ev.date) ev.date = todayISO;
    const missing = missingEventFields(ev);
    next.draft = { type: "event", event: ev, missing };
    if (missing.length) {
      push(askMessage(missing, ev));
    } else {
      let note: string | undefined;
      if (!ev.durationMinutes) {
        ev.durationMinutes = ev.kind === "work" ? 120 : 60;
        note = `i assumed ${durationLabel(ev.durationMinutes)}, say *make it 2h* if not`;
      }
      placeEvent(next, finalizeEvent(ev), replies, note);
    }
  } else if (parsed.intent === "help") {
    push(botText(helpText(), { buttons: [B.week, B.today, B.addWork] }));
  } else if (parsed.intent === "status") {
    const plan = buildDayPlan(next, todayISO);
    push(botText(`${peopleNote(plan.stats, "status")} ${freeLine(plan, next)}`, { card: dayPicture(next, todayISO), buttons: [B.week, B.ideas] }));
  } else if (parsed.intent === "chitchat" || parsed.intent === "question") {
    push(botText(parsed.reply || (parsed.intent === "question" ? helpText() : "anytime.")));
  } else if (parsed.intent === "greet") {
    push(botText(parsed.reply || "hey. *my week*, *today*, or tell me what's on.", { buttons: [B.week, B.today, B.addWork] }));
  } else if (parsed.reply) {
    push(botText(parsed.reply, { buttons: [B.help, B.today, B.week] }));
  } else {
    push(
      botText(`not sure i got that. is *${parsed.event.title}* a plan with a time, or a to-do?`, {
        buttons: [btn("as-event", "A plan with a time", `plan ${parsed.event.title}`), btn("as-todo", "A to-do, no time", `remind me to ${parsed.event.title}`), B.help],
      }),
    );
  }

  // A tailored opening line and any people picked up along the way, on the first reply.
  if (replies.length) {
    const first = replies[0];
    const ack = /^(got it|ok|okay|sure|done|noted|alright|right|cool|yep|yes|my bad|sorry|understood|will do)\b[^a-z]*$/i;
    const echo = parsed.lead && first.text.toLowerCase().startsWith(parsed.lead.toLowerCase().split(/\s+/)[0]);
    const lead = parsed.lead && !ack.test(parsed.lead) && !echo && parsed.intent !== "chitchat" && parsed.intent !== "question" && parsed.intent !== "greet" && parsed.intent !== "unknown" && parsed.intent !== "clarify" ? `${parsed.lead.replace(/\s+$/, "")} ` : "";
    replies[0] = { ...first, text: `${lead}${first.text}${peopleLine}` };
  }

  return done();
}

/** Older sessions with an empty chat get the new intro. */
export function welcomeIfEmpty(user: UserRecord): UserRecord {
  if (user.messages.length) return user;
  return beginChat(user);
}

/** Kept for the session route; the intro is now the start of setup. */
export function greeting(name: string): ChatMessage[] {
  return introMessages(name);
}

/* ------------------------------------------------------------------ */
/* proactive messages                                                  */
/* ------------------------------------------------------------------ */

export function dueReminders(user: UserRecord): ChatMessage[] {
  const now = nowInZone(user.settings.timezone);
  const today = dateISO(now);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const lead = user.settings.reminderLeadMinutes;
  const out: ChatMessage[] = [];
  const starredTodos = user.todos.filter((t) => t.starred && !t.done);
  const upcoming = user.events.filter((e) => {
    if (e.date !== today) return false;
    const start = hmToMinutes(e.start);
    const delta = start - minutesNow;
    return delta <= Math.max(lead * 2, 45) && delta >= -5;
  });

  for (const e of upcoming) {
    const start = hmToMinutes(e.start);
    const delta = start - minutesNow;
    const starLead = e.starred ? Math.max(lead * 2, 45) : lead;
    if (delta <= starLead && delta >= -5 && !user.remindedEventIds.includes(e.id)) {
      out.push(
        botText(
          e.starred
            ? `★ *${e.title}* starts at ${clockShort(e.start)}. finish this before the next thing.`
            : e.kind === "social"
              ? `*${e.title}* at ${clockShort(e.start)}. hope it's a good one.`
              : `heads up, *${e.title}* starts at ${clockShort(e.start)}.`,
        ),
      );
    }
    const preId = `pre:${e.id}`;
    if (starredTodos.length && delta <= starLead && delta > 0 && !user.remindedEventIds.includes(preId)) {
      out.push(botText(`before *${e.title}* at ${clockShort(e.start)}: ${starredTodos.map((t) => `*${t.title}*`).join(", ")}.`));
    }
  }
  return out;
}

/** Keep at most 20 short facts; newest last; no duplicates. */
function rememberNotes(existing: string | undefined, fresh: string[] | undefined): string | undefined {
  if (!fresh?.length) return existing;
  const lines = (existing || "").split("\n").map((l) => l.trim()).filter(Boolean);
  for (const f of fresh) {
    const t = f.trim().replace(/\s+/g, " ");
    if (t && !lines.some((l) => l.toLowerCase() === t.toLowerCase())) lines.push(t);
  }
  return lines.slice(-20).join("\n");
}

/**
 * 8 am, once a day: today as a picture and one line about the open time.
 * Only when setup is done; nothing between noon and the next morning.
 */
export function dailyDigest(user: UserRecord): { message?: ChatMessage; patch?: Partial<UserRecord> } {
  if (user.onboarding && user.onboarding !== "done") return {};
  if (user.morningOff) return {};
  const now = nowInZone(user.settings.timezone);
  const today = dateISO(now);
  if (user.lastDigestDate === today) return {};
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  if (minutesNow < 8 * 60 || minutesNow >= 12 * 60) return {};
  const plan = buildDayPlan(user, today);
  const busy = plan.blocks.some((b) => b.kind !== "free" && b.kind !== "sleep");
  const text = busy ? `morning. ${freeLine(plan, user)}` : "morning. nothing on today yet.";
  return {
    message: botText(text, { card: dayPicture(user, today), buttons: busy ? [B.ideas, B.week] : [B.addWork, B.ideas] }),
    patch: { lastDigestDate: today },
  };
}

/**
 * The evening nudge: once a day, in the 90 minutes after their switch-off
 * time, when nothing is on and setup is done. Names one of their people.
 */
export function unwindNudge(user: UserRecord): { message?: ChatMessage; patch?: Partial<UserRecord> } {
  if (user.onboarding && user.onboarding !== "done") return {};
  if (user.notify === false) return {}; // they said no nudges; the chat still answers when asked
  const tz = user.settings.timezone;
  const now = nowInZone(tz);
  const today = dateISO(now);
  if (user.lastNudgeDate === today) return {};
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const unwind = hmToMinutes(user.settings.protectEveningsAfter || "19:00");
  if (minutesNow < unwind || minutesNow > unwind + 90) return {};
  const busy = user.events.some((e) => e.date === today && hmToMinutes(e.start) <= minutesNow && hmToMinutes(e.start) + e.durationMinutes > minutesNow);
  if (busy) return {};
  const calledToday = user.events.some((e) => e.date === today && e.kind === "social");
  if (calledToday) return { patch: { lastNudgeDate: today } };
  const people = user.people ?? [];
  const idx = (user.nudgeIndex ?? 0) % Math.max(1, people.length);
  const who = people[idx];
  const group = Boolean(who && isGroup(who));
  const text = who
    ? group
      ? `you're off the clock. some time with your ${who.toLowerCase()} would be a good use of it. even half an hour.`
      : `you're off the clock. ${who} would love to hear from you. even ten minutes counts.`
    : "you're off the clock. a ten-minute call to someone you love counts more than it feels like it does.";
  const buttons = who
    ? [
        group ? btn("now", "Doing it now", `calling ${who.toLowerCase()} now`) : btn("now", `Calling ${who} now`.length <= 20 ? `Calling ${who} now` : `Call ${who} now`, `calling ${who.toLowerCase()} now`),
        btn("later", "Remind me tonight", `remind me to call ${who.toLowerCase()} later tonight`),
        btn("skip", "Skip today", "skip the call today"),
      ]
    : [btn("who", "Add a person", "nudge me to call "), btn("skip", "Skip today", "skip the call today"), B.today];
  return {
    message: botText(text, { buttons }),
    patch: { lastNudgeDate: today, nudgeIndex: idx + 1 },
  };
}
