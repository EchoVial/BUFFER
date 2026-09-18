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
import { understand, understandSetup } from "./understand";
import { parseRange, type ParsedMessage } from "./nlp";
import type { SetupUnderstanding } from "./llm";
import { dayImage, describeWindow, freeLine, protectPayload, protectedEvent, slotName, standingWork, suggestForFreeTime, suggestionPayload, weekImage, weekView, windowLabel } from "./life";
import { findNamedItem } from "./match";
import { buildDayPlan, proposeEvent } from "./scheduler";
import {
  dateISO,
  durationLabel,
  hmToMinutes,
  minutesToHM,
  nowInZone,
  prettyDate,
  shortClock,
} from "./time";

type BotExtra = {
  card?: MessageCard;
  buttons?: ReplyButton[];
  list?: InteractiveList;
  calendarEventId?: string;
};

const CARD_TYPES = new Set(["schedule", "proposal", "todos", "overlaps", "debug", "image"]);

function botText(text: string, extra?: MessageCard | BotExtra): ChatMessage {
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
  ideas: btn("ideas", "Ideas for free time", "what should i do with my free time"),
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
DEFAULT_BUTTONS.push(B.week, B.today, B.addWork, B.help);

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
  return botText("here's everything i do. tap one, or just text me.", { list: START_LIST });
}

function helpText(): string {
  return [
    "here's the whole thing:",
    "",
    "1. tell me when you work: *work 7 to 10pm today*, *shift 9 to 5 tomorrow*. usual hours: *i usually work 9 to 6*.",
    "2. ask *my week* or *today*. i send a picture.",
    "3. add anything else the same way: *dinner with sam friday 8pm*, *gym tomorrow 7am*. no time means a to-do: *remind me to call nani*.",
    "4. when you're free after work, i nudge you to call someone. *nudge me to call mum* adds a person.",
    "5. *reserve friday evening* blocks it so nothing else lands there.",
    "",
    "change or finish things in plain words: *move gym to 8pm*, *done with the deck*, *undo*.",
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
  keep: "(reserving = i put a block called *Reserved for you* on your calendar, so nothing else gets planned there. *Undo* removes it.)",
  save: "(tap *Undo* to remove it, or *Push 30 min later* to move it.)",
  todo: "(a to-do has no fixed time. i slot it into a free gap and show it on your day.)",
  picture: "(tap the picture to see it big.)",
};

function tip(next: UserRecord, id: keyof typeof TIPS): string {
  const seen = next.tips ?? [];
  if (seen.includes(id)) return "";
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
  if (missing.includes("date") && missing.includes("time")) return `when is ${what}? say it like *7 to 10pm today* or *tomorrow at 6*.`;
  if (missing.includes("date")) return `which day is ${what}? today, tomorrow, or a weekday.`;
  return `what time is ${what}? say *7 to 10pm* for a start and end, or just *7pm*.`;
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
  if (connected) {
    return [
      { id: "gcal", title: "Google Calendar", action: "google-cal" },
      { id: "outlook", title: "Outlook", action: "outlook-cal" },
      { id: "ics", title: "Download .ics", action: "ics" },
    ];
  }
  return [
    { id: "connect", title: "Connect calendar", action: "connect-feed" },
    { id: "gcal", title: "Google (this event)", action: "google-cal" },
    { id: "outlook", title: "Outlook (this event)", action: "outlook-cal" },
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
  const text = `${lead ?? `${what}. *${ev.title}* ${when}, ${span(ev.start, ev.durationMinutes)}${note ? ` (${note})` : ""}.`}${rest}${tip(next, "save")}`;
  return botText(text, {
    card: dayPicture(next, ev.date, ev.title),
    buttons: [B.undo, B.later30, ev.kind === "work" ? B.week : B.today],
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
    botText(`hey ${first}, i'm *Buffer*.\n\ntell me when you work. i'll show you when you're actually free, and nudge you to spend some of that time with the people you love.`),
    workQuestion(),
  ];
}

function workQuestion(): ChatMessage {
  return botText("two quick questions to set up.\n\nfirst: when do you usually work? tap one or type it, like *9 to 6* or *7pm to 10pm*.", {
    buttons: [btn("w95", "9 to 5", "i usually work 9 to 5"), btn("w106", "10 to 6", "i usually work 10 to 6"), btn("wvar", "It varies", "it varies")],
  });
}

function unwindQuestion(next: UserRecord): ChatMessage {
  const standing = standingWork(next.settings);
  const base = standing ? Math.max(standing.end, 17 * 60) : 19 * 60;
  const opts = [0, 60, 120].map((add) => minutesToHM(Math.min(base + add, 22 * 60)));
  return botText("and when do you usually switch off from work for the day?", {
    buttons: opts.map((hm, i) => btn(`u${i}`, clockShort(hm), `i switch off at ${clockShort(hm)}`)),
  });
}

function peopleQuestion(): ChatMessage {
  return botText("last one: who should i nudge you to call when you're free? a name or two, like *mum, dad* or *nani and rohan*.", {
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
  const out: ChatMessage[] = [
    botText(
      `that's the setup. when you're free after ${after}, i'll send one small nudge ${verb} ${who}. never more than once a day.\n\nfrom here, just text me:\n• *work 7 to 10pm today* to mark work hours\n• *my week* or *today* for a picture\n• *dinner with sam friday 8pm* for a plan, *remind me to call nani* for a to-do`,
    ),
    botText(
      view.totalWork
        ? `here's your week so far. green is free, grey is work.${tip(next, "picture")}`
        : `here's your week so far. nothing is marked as work yet, so it all looks open. add your work and this gets real.${tip(next, "picture")}`,
      {
        card: weekImage(view, next),
        buttons: [B.addWork, B.today, B.help],
      },
    ),
  ];
  return out;
}

/** Apply whatever a setup answer gave, then ask the next unanswered question. */
function applySetup(next: UserRecord, a: SetupUnderstanding): ChatMessage[] {
  const step = next.onboarding;
  const gotWork = Boolean((a.work_start && a.work_end) || a.work_varies);
  if (a.work_start && a.work_end) next.settings = { ...next.settings, workStart: a.work_start, workEnd: a.work_end };
  else if (a.work_varies) next.settings = { ...next.settings, workStart: "00:00", workEnd: "00:00" };
  if (a.unwind) next.settings = { ...next.settings, protectEveningsAfter: a.unwind, noWorkAfter: a.unwind };
  if (a.people?.length) {
    const have = new Set((next.people ?? []).map((n) => n.toLowerCase()));
    next.people = [...(next.people ?? []), ...a.people.map(cap).filter((n) => !have.has(n.toLowerCase()))].slice(0, 6);
  }
  const answered = {
    work: gotWork || step !== "work",
    unwind: Boolean(a.unwind) || step === "people",
    people: Boolean(a.people?.length) || (step === "people" && a.skip),
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
    out.push(...finishSetup(next));
  }
  return out;
}

/** The setup questions, one at a time. Returns replies, or null when the text is not for setup. */
async function handleOnboarding(next: UserRecord, text: string): Promise<ChatMessage[] | null> {
  const step = next.onboarding;
  const t = text.toLowerCase().trim();
  if (!step || step === "done") return null;
  // Claude reads the answer when a key is set: loose wording, several answers at once, side questions.
  const smart = await understandSetup(step, text, next);
  if (smart) return applySetup(next, smart);
  // Let them escape the questions with the things they might type anyway.
  if (/^(skip all|skip setup|later|not now)$/.test(t)) {
    next.onboarding = "done";
    return [botText("no problem. say *set up again* whenever. for now: *work 7 to 10pm today*, *my week*, or *today*.", { buttons: [B.addWork, B.week, B.help] })];
  }
  if (step === "work") {
    const range = parseRange(t);
    if (/\b(varies|vary|depends|no fixed|different every|not fixed|flexible|freelance|student)\b/.test(t) || /^skip$/.test(t)) {
      next.settings = { ...next.settings, workStart: "00:00", workEnd: "00:00" };
      next.onboarding = "unwind";
      return [botText("no problem. just tell me each day, like *work 7 to 10pm today*, and i'll keep track."), unwindQuestion(next)];
    }
    if (range) {
      next.settings = { ...next.settings, workStart: range.start, workEnd: range.end };
      next.onboarding = "unwind";
      return [botText(`got it, ${span(range.start, range.durationMinutes)} on weekdays. if a day is different, just tell me: *work 7 to 10pm today*.`), unwindQuestion(next)];
    }
    return [botText("didn't catch the hours. say it like *9 to 6* or *7pm to 10pm*, or tap *It varies*.", { buttons: workQuestion().buttons })];
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
      return [botText("ok, i'll go with 7 pm and you can change it any time: *i switch off at 8pm*."), peopleQuestion()];
    }
    return [botText("just a time is enough, like *7pm* or *8:30*.", { buttons: unwindQuestion(next).buttons })];
  }
  if (step === "people") {
    const people = parsePeople(text);
    next.people = people;
    return finishSetup(next);
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
    push(botText("when? say it like *7 to 10pm today* or *9 to 5 tomorrow*.", { buttons: [B.cancel] }));
    return done();
  }
  if (/^add something$/.test(lower)) {
    push(botText("sure. what and when?\n• *dinner with sam friday 8pm*\n• *gym tomorrow 7am*\n• *remind me to renew my passport* (no time = a to-do)"));
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
        ? "here's your week. green is free, grey is work."
        : "the next 7 days are full edge to edge. that's the first thing to fix.";
    const best = view.best.length && view.totalWork ? `\nyour biggest open stretch is ${windowLabel(view.best[0])}.` : "";
    const nudge = view.best.length && view.totalWork ? " want me to reserve it for you?" : "";
    const buttons = view.best.slice(0, 2).map((w, i) => btn(`keep-${i}`, `Reserve ${slotName(w)}`, protectPayload(w, tz, "me")));
    push(
      botText(`${lead}${best}${nudge}${view.best.length ? tip(next, "keep") : ""}${tip(next, "picture")}`, {
        card: weekImage(view, next),
        buttons: [...buttons, B.ideas].slice(0, 3),
      }),
    );
  } else if (parsed.intent === "plan_free") {
    const view = weekView(next);
    const picks = suggestForFreeTime(next, view);
    if (!picks.length) {
      push(botText("i can't find a 45-minute gap in the next week. say *reserve thursday evening* and i'll make one.", { buttons: [btn("keep", "Reserve an evening", "reserve an evening this week")] }));
    } else {
      const lines = picks.map((p) => `• *${p.title}* · ${windowLabel(p.window)} · ${p.why}`);
      push(
        botText(`a few ways to use the room you have:\n${lines.join("\n")}\n\ntap one and i'll put it on your calendar.`, {
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
      botText(`reserved. *${ev.title}* · ${describeWindow(ev.date, ev.start, ev.durationMinutes)}.\nnothing else gets planned there.${tip(next, "keep")}`, {
        card: dayPicture(next, ev.date, ev.title),
        buttons: [btn("ideas", "Ideas for this slot", "what should i do with my free time"), B.undo, B.week],
        calendarEventId: ev.id,
      }),
    );
  } else if (parsed.intent === "set_pref") {
    next.settings = { ...next.settings, ...parsed.prefs };
    const p = parsed.prefs;
    const bits: string[] = [];
    if (p.workStart && p.workEnd) bits.push(`usual hours ${span(p.workStart, hmToMinutes(p.workEnd) - hmToMinutes(p.workStart))}`);
    if (p.protectEveningsAfter || p.noWorkAfter) bits.push(`after ${clockShort(p.protectEveningsAfter || p.noWorkAfter!)} the day is yours`);
    if (p.socialMinutesPerDay !== undefined) bits.push(p.socialMinutesPerDay ? `${durationLabel(p.socialMinutesPerDay)} a day kept for people` : "no daily people block");
    if (p.maxWorkMinutesPerDay) bits.push(`no more than ${durationLabel(p.maxWorkMinutesPerDay)} of work a day`);
    if (p.wakeTime) bits.push(`up at ${clockShort(p.wakeTime)}`);
    if (p.sleepTime) bits.push(`asleep by ${clockShort(p.sleepTime)}`);
    push(botText(bits.length ? `ok: ${bits.join(", ")}.` : "ok, noted.", { buttons: [B.week, B.today] }));
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
    push(botText(`connected. *${connectedLabel(via)}* now follows your Buffer feed. anything you add here shows up there within about 15 minutes.`));
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
  } else if (parsed.intent === "calendar") {
    const ev = next.events.find((e) => e.id === next.lastLockedEventId) || next.events[next.events.length - 1];
    const connected = Boolean(next.calendarConnectedAt);
    if (!ev) {
      push(
        botText(connected ? "nothing on the calendar yet. add something first." : "tap *Connect calendar* and everything you add here shows up in Google, Apple or Outlook.", connected ? undefined : { buttons: [{ id: "connect", title: "Connect calendar", action: "connect-feed" }] }),
      );
    } else {
      push(
        botText(
          connected ? `*${ev.title}* · ${prettyDate(ev.date)} ${clockShort(ev.start)}\n\nyour calendar is already connected. add just this one somewhere else, or download it.` : `*${ev.title}* · ${prettyDate(ev.date)} ${clockShort(ev.start)}\n\ntap *Connect calendar* for everything, or add just this one.`,
          { buttons: calendarButtons(connected), calendarEventId: ev.id },
        ),
      );
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
    const lead = parsed.lead && parsed.intent !== "chitchat" && parsed.intent !== "question" && parsed.intent !== "greet" && parsed.intent !== "unknown" && parsed.intent !== "clarify" ? `${parsed.lead.replace(/\s+$/, "")} ` : "";
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
 * Once a day after wake time: where the free time is this week and one offer
 * to keep some of it. Only when setup is done and there is something to say.
 */
export function dailyDigest(user: UserRecord): { message?: ChatMessage; patch?: Partial<UserRecord> } {
  if (user.onboarding && user.onboarding !== "done") return {};
  const now = nowInZone(user.settings.timezone);
  const today = dateISO(now);
  if (user.lastDigestDate === today) return {};
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  if (minutesNow < hmToMinutes(user.settings.wakeTime || "07:00") + 30) return {};
  if (!user.events.length && !standingWork(user.settings)) return {};
  const view = weekView(user);
  const best = view.best[0];
  const text = best
    ? `morning. your biggest open stretch this week is ${windowLabel(best)}. want me to reserve it for you?`
    : "morning. the next 7 days are wall to wall. say *reserve an evening* and i'll carve one out.";
  return {
    message: botText(text, {
      buttons: best
        ? [btn("keep", "Reserve that slot", protectPayload(best, user.settings.timezone, "me")), B.week, B.today]
        : [btn("keep", "Reserve an evening", "reserve an evening this week"), B.week, B.today],
    }),
    patch: { lastDigestDate: today },
  };
}

/**
 * The evening nudge: once a day, in the 90 minutes after their switch-off
 * time, when nothing is on and setup is done. Names one of their people.
 */
export function unwindNudge(user: UserRecord): { message?: ChatMessage; patch?: Partial<UserRecord> } {
  if (user.onboarding && user.onboarding !== "done") return {};
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
