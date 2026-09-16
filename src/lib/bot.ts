import {
  CalendarEvent,
  ChatMessage,
  ConversationDraft,
  InteractiveList,
  MessageCard,
  ReplyButton,
  TodoItem,
  UserRecord,
} from "./types";
import { uid } from "./ids";
import { parseMessage } from "./nlp";
import { buildDayPlan, planLines, proposeEvent, statsLine } from "./scheduler";
import {
  dateISO,
  durationLabel,
  formatClock,
  hmToMinutes,
  minutesToHM,
  nowInZone,
  prettyDate,
} from "./time";

type BotExtra = {
  card?: MessageCard;
  buttons?: ReplyButton[];
  list?: InteractiveList;
  calendarEventId?: string;
};

const CARD_TYPES = new Set(["schedule", "proposal", "todos", "overlaps", "debug"]);

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

const PROPOSAL_BUTTONS: ReplyButton[] = [
  { id: "lock", title: "Lock it", payload: "lock it" },
  { id: "later", title: "+30 min", payload: "make it 30m later" },
  { id: "cancel", title: "Cancel", payload: "nah, cancel" },
];

const CALENDAR_BUTTONS: ReplyButton[] = [
  { id: "connect", title: "Connect calendar", action: "connect-feed" },
  { id: "gcal", title: "Google (this event)", action: "google-cal" },
  { id: "ics", title: "Download .ics", action: "ics" },
];

const KIND_BUTTONS: ReplyButton[] = [
  { id: "work", title: "Work", payload: "it's work" },
  { id: "social", title: "Social", payload: "it's social" },
  { id: "personal", title: "Personal", payload: "it's personal" },
];

const START_LIST: InteractiveList = {
  button: "See options",
  footer: "or just text me like a friend",
  sections: [
    {
      title: "Plan",
      rows: [
        {
          id: "rundown",
          title: "Today's rundown",
          description: "Hour by hour, what moved",
          payload: "rundown",
        },
        {
          id: "event",
          title: "Plan an event",
          description: "Meeting, gym, dinner…",
          payload: "i want to plan an event",
        },
        {
          id: "todo",
          title: "Add a to-do",
          description: "Priority stack",
          payload: "remind me to ",
        },
      ],
    },
    {
      title: "Balance",
      rows: [
        {
          id: "social",
          title: "Set social hours",
          description: "Protect time off work",
          payload: "i want 2 hrs of social every day",
        },
        {
          id: "cal",
          title: "Connect my calendar",
          description: "Google, Apple, Android, Outlook",
          payload: "connect calendar",
        },
        {
          id: "help",
          title: "How this works",
          description: "Examples of what to text",
          payload: "help",
        },
      ],
    },
  ],
};

function withProposal(text: string, card: MessageCard): ChatMessage {
  return botText(text, { card, buttons: PROPOSAL_BUTTONS });
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

function greeting(name: string): ChatMessage[] {
  return [
    botText(
      `hey ${name.split(" ")[0]} 👋 i'm *Balance*. think of me as the friend who actually remembers your calendar *and* tells you to leave the laptop.\n\ntext me like you text anyone — gym tmrw 7pm, i want 2 hrs of social every day, *rundown*, remind me to send the deck p0.\n\nor tap *See options* below, WhatsApp-style.`,
      { list: START_LIST },
    ),
  ];
}

function helpText(): string {
  return [
    "i get messy texts. try stuff like:",
    "• gym tmrw 6:30pm for 1h",
    "• lunch w sam friday at 1, social",
    "• remind me to finish the deck p0 90m",
    "• add under deck: dump outline 30m",
    "• i want 2 hours of social every day",
    "• i work 9 to 6, no work after 7pm",
    "• rundown / what's today",
    "• overlaps?",
    "• done with the deck",
    "• add to calendar / connect calendar",
    "when you drop an event i'll ask the missing bits, then show how to-dos slide around. tap *Lock it* when the plan looks right. tap *Connect calendar* to subscribe Google, Apple, Android, or Outlook to a live feed.",
  ].join("\n");
}

function renderTodos(user: UserRecord): string[] {
  const roots = user.todos.filter((t) => !t.parentId);
  const kids = (id: string) => user.todos.filter((t) => t.parentId === id);
  const line = (t: TodoItem, pad: string) => {
    const mark = t.done ? "✓" : "○";
    const due = t.dueDate ? ` · due ${prettyDate(t.dueDate)}` : "";
    return `${pad}${mark} *${t.priority.toUpperCase()}* ${t.title} (${durationLabel(t.estimatedMinutes)})${due}`;
  };
  const out: string[] = [];
  const walk = (t: TodoItem, depth: number) => {
    out.push(line(t, "  ".repeat(depth)));
    for (const c of kids(t.id)) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  const orphans = user.todos.filter(
    (t) => t.parentId && !user.todos.some((p) => p.id === t.parentId),
  );
  for (const o of orphans) out.push(line(o, ""));
  return out.length ? out : ["no to-dos yet. drop one like \"remind me to email jordan p1 20m\"."];
}

function missingEventFields(ev: ConversationDraft["event"]): string[] {
  const missing: string[] = [];
  if (!ev?.title || ev.title.length < 2) missing.push("title");
  if (!ev?.date) missing.push("date");
  if (!ev?.start) missing.push("time");
  if (!ev?.durationMinutes) missing.push("duration");
  if (!ev?.kind) missing.push("kind");
  return missing;
}

function askFor(missing: string[], ev: ConversationDraft["event"]): string {
  const bits: string[] = [];
  if (missing.includes("title")) bits.push("what's it called?");
  if (missing.includes("date")) bits.push("which day? (today / tmrw / friday)");
  if (missing.includes("time")) bits.push("what time?");
  if (missing.includes("duration")) bits.push("how long? (30m, 1h…)");
  if (missing.includes("kind")) bits.push("is it work, social, personal, or health?");
  const known = [
    ev?.title,
    ev?.date ? prettyDate(ev.date) : null,
    ev?.start ? formatClock(ev.start) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return `${known ? `got *${known}*. ` : ""}still need: ${bits.join(" / ")}\njust fire a casual reply, like "tmrw 3pm for 45m, work".`;
}

function applyEventPatch(
  draft: ConversationDraft,
  parsed: ReturnType<typeof parseMessage>,
): ConversationDraft {
  const ev = { ...(draft.event || {}) };
  if (parsed.event.title && parsed.event.title.length > 1 && parsed.intent === "add_event") {
    if (!ev.title || ev.title.length < 3 || /^(yes|ok|today|tomorrow)$/i.test(ev.title)) {
      ev.title = parsed.event.title;
    }
  }
  if (parsed.event.date) ev.date = parsed.event.date;
  if (parsed.event.start) ev.start = parsed.event.start;
  if (parsed.event.durationMinutes) ev.durationMinutes = parsed.event.durationMinutes;
  if (parsed.event.kind) ev.kind = parsed.event.kind;
  const missing = missingEventFields(ev);
  return { type: "event", event: ev, missing };
}

function finalizeEvent(ev: NonNullable<ConversationDraft["event"]>): CalendarEvent {
  return {
    id: uid("evt"),
    title: ev.title || "Untitled",
    kind: ev.kind || "other",
    date: ev.date!,
    start: ev.start!,
    durationMinutes: ev.durationMinutes || 60,
    flexible: ev.kind !== "work" ? true : false,
    createdAt: new Date().toISOString(),
  };
}

function askMessage(missing: string[], ev: ConversationDraft["event"]): ChatMessage {
  return botText(askFor(missing, ev), {
    buttons: missing.includes("kind") ? KIND_BUTTONS : undefined,
  });
}

function findTodo(user: UserRecord, hint: string): TodoItem | undefined {
  const h = hint.toLowerCase();
  return user.todos.find((t) => t.title.toLowerCase().includes(h) && h.length > 1);
}

export function processTurn(
  user: UserRecord,
  text: string,
): { user: UserRecord; replies: ChatMessage[] } {
  const now = new Date().toISOString();
  const incoming = userText(text);
  const parsed = parseMessage(text, user);
  const next: UserRecord = {
    ...user,
    messages: [...user.messages, incoming],
    lastNlp: parsed.debug,
    lastSeenAt: now,
    updatedAt: now,
  };
  const replies: ChatMessage[] = [];
  const push = (m: ChatMessage | ChatMessage[]) => {
    const arr = Array.isArray(m) ? m : [m];
    replies.push(...arr);
  };

  if (next.draft.type === "event" && parsed.intent === "cancel") {
    next.draft = { type: "none", missing: [] };
    push(botText("cool, scrapped that. what instead?", { list: START_LIST }));
  } else if (
    next.draft.type === "event" &&
    next.draft.event?.start &&
    /\b\d+\s*(m|min|minutes|h|hour|hours)?\s*later\b/.test(parsed.normalized)
  ) {
    const shift = parsed.normalized.match(/(\d+)\s*(m|min|minutes|h|hour|hours)?/);
    const n = Number(shift?.[1] || 30);
    const unit = shift?.[2] || "m";
    const add = /^h/.test(unit) ? n * 60 : n;
    next.draft.event.start = minutesToHM(hmToMinutes(next.draft.event.start) + add);
    const ev = finalizeEvent({ durationMinutes: 60, kind: "other", ...next.draft.event });
    const proposal = proposeEvent(next, ev);
    next.draft = { type: "event", event: next.draft.event, missing: [], proposal };
    push(
      withProposal(
        `shifted to *${formatClock(ev.start)}*. here's the new layout — *Lock it* when you're good.`,
        proposal,
      ),
    );
  } else if (next.draft.type === "event" && parsed.intent === "confirm" && next.draft.proposal) {
    const ev = finalizeEvent({
      durationMinutes: 60,
      kind: "other",
      ...next.draft.event,
    });
    next.events = [...next.events, ev];
    next.draft = { type: "none", missing: [] };
    const plan = buildDayPlan(next, ev.date);
    push(
      botText(
        `locked. *${ev.title}* is on ${prettyDate(ev.date)} at ${formatClock(ev.start)}.\ni'll nudge you here ${next.settings.reminderLeadMinutes} min before.\n\n*Connect calendar* subscribes this device's calendar (Google, Apple, Android, Outlook) to your live Balance feed. Google (this event) is a one-shot add.`,
        {
          card: {
            type: "schedule",
            date: ev.date,
            lines: planLines(plan),
            warnings: plan.warnings,
            stats: plan.stats,
          },
          buttons: CALENDAR_BUTTONS,
          calendarEventId: ev.id,
        },
      ),
    );
  } else if (next.draft.type === "event" && (parsed.intent === "add_event" || parsed.intent === "unknown" || parsed.intent === "confirm" || parsed.intent === "chitchat")) {
    next.draft = applyEventPatch(next.draft, parsed);
    if (parsed.intent === "confirm" && next.draft.missing.length) {
      push(askMessage(next.draft.missing, next.draft.event));
    } else if (next.draft.missing.length) {
      if (!next.draft.event?.durationMinutes) {
        next.draft.event = { ...next.draft.event, durationMinutes: 60 };
        next.draft.missing = missingEventFields(next.draft.event);
        if (!next.draft.missing.includes("duration")) {
          push(botText("no length given so i'm assuming 1 hour — say if that's off."));
        }
      }
      if (next.draft.missing.length) {
        push(askMessage(next.draft.missing, next.draft.event));
      }
    }
    if (!next.draft.missing.length && next.draft.event) {
      const ev = finalizeEvent(next.draft.event);
      const proposal = proposeEvent(next, ev);
      next.draft = { ...next.draft, proposal, missing: [] };
      push(
        withProposal(
          `ok here's the move-around for *${ev.title}*. tap *Lock it* to save, or tweak the time.`,
          proposal,
        ),
      );
    }
  } else if (parsed.intent === "set_pref") {
    next.settings = { ...next.settings, ...parsed.prefs };
    const bits = Object.entries(parsed.prefs)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    const today = dateISO(nowInZone(next.settings.timezone));
    const plan = buildDayPlan(next, today);
    push(
      botText(
        `locked those rules in (${bits}). i'll treat them as non-negotiable unless you change them.\n${statsLine(plan.stats)}`,
        {
          type: "schedule",
          date: today,
          lines: planLines(plan),
          warnings: plan.warnings,
          stats: plan.stats,
        },
      ),
    );
  } else if (parsed.intent === "schedule") {
    const today = parsed.event.date || dateISO(nowInZone(next.settings.timezone));
    const plan = buildDayPlan(next, today);
    push(
      botText(
        `${prettyDate(today)} *rundown* — ${statsLine(plan.stats)}`,
        {
          type: "schedule",
          date: today,
          lines: planLines(plan),
          warnings: plan.warnings,
          stats: plan.stats,
        },
      ),
    );
  } else if (parsed.intent === "overlaps") {
    const today = parsed.event.date || dateISO(nowInZone(next.settings.timezone));
    const plan = buildDayPlan(next, today);
    push(
      botText(
        plan.overlaps.length
          ? "yeah you've got clashes. want me to slide the flexible stuff?"
          : "no hard overlaps today. you're clean.",
        {
          type: "overlaps",
          items: plan.overlaps.length
            ? plan.warnings
            : ["No overlapping events."],
        },
      ),
    );
  } else if (parsed.intent === "todos") {
    push(
      botText("your stack, parents first — knock out P0s before you invent more work:", {
        type: "todos",
        lines: renderTodos(next),
      }),
    );
  } else if (parsed.intent === "complete_todo") {
    const hint = parsed.todo.doneHint || parsed.todo.title || "";
    const hit = findTodo(next, hint);
    if (!hit) {
      push(botText(`couldn't find a to-do matching "${hint}". send the list? just say todos.`));
    } else {
      next.todos = next.todos.map((t) =>
        t.id === hit.id ? { ...t, done: true } : t,
      );
      push(
        botText(`nice. *${hit.title}* is done. keep the streak without stacking another 3 tasks on top.`),
      );
    }
  } else if (parsed.intent === "add_todo") {
    let parentId: string | null = null;
    if (parsed.todo.parentHint) {
      parentId = findTodo(next, parsed.todo.parentHint)?.id ?? null;
    }
    const todo: TodoItem = {
      id: uid("todo"),
      title: parsed.todo.title || text.trim(),
      priority: parsed.todo.priority || "p2",
      parentId,
      estimatedMinutes: parsed.todo.estimatedMinutes || 45,
      dueDate: parsed.todo.dueDate,
      done: false,
      kind: parsed.todo.kind || "work",
      createdAt: now,
    };
    next.todos = [...next.todos, todo];
    const today = dateISO(nowInZone(next.settings.timezone));
    const plan = buildDayPlan(next, today);
    push(
      botText(
        `added *${todo.title}* as ${todo.priority.toUpperCase()}${parentId ? " under its parent" : ""} · ${durationLabel(todo.estimatedMinutes)}. here's how today would absorb it:`,
        {
          type: "schedule",
          date: today,
          lines: planLines(plan),
          warnings: plan.warnings,
          stats: plan.stats,
        },
      ),
    );
    push(
      botText("full tree:", { type: "todos", lines: renderTodos(next) }),
    );
  } else if (parsed.intent === "add_event") {
    const ev: ConversationDraft["event"] = { ...parsed.event };
    if (!ev.durationMinutes) ev.durationMinutes = undefined;
    const missing = missingEventFields(ev);
    next.draft = { type: "event", event: ev, missing };
    if (missing.length) {
      push(askMessage(missing, ev));
    } else {
      const full = finalizeEvent(ev);
      const proposal = proposeEvent(next, full);
      next.draft = { type: "event", event: ev, missing: [], proposal };
      push(
        withProposal(
          `ok here's the move-around for *${full.title}*. tap *Lock it* to save, or say a different time.`,
          proposal,
        ),
      );
    }
  } else if (parsed.intent === "calendar") {
    const ev = next.events[next.events.length - 1];
    const connect =
      "tap *Connect calendar* and i'll match this device: Apple Calendar on iPhone/Mac, Google Calendar on Android/Chrome, Outlook on Windows. that's a live subscribe — new locked events show up on the next refresh.\n\nbrowsers still can't silently write into the OS calendar. one tap from you is the rule.";
    if (!ev) {
      push(
        botText(
          `no events locked yet, but you can still subscribe the empty feed so later plans land automatically.\n\n${connect}`,
          { buttons: [{ id: "connect", title: "Connect calendar", action: "connect-feed" }] },
        ),
      );
    } else {
      push(
        botText(
          `*${ev.title}* · ${prettyDate(ev.date)} ${formatClock(ev.start)}\n\n${connect}`,
          { buttons: CALENDAR_BUTTONS, calendarEventId: ev.id },
        ),
      );
    }
  } else if (parsed.intent === "greet") {
    push(
      botText(
        `yo. want today's rundown, a new event, or to dump a to-do? i'll keep your social hours honest.`,
        { list: START_LIST },
      ),
    );
  } else if (parsed.intent === "help") {
    push(botText(helpText(), { list: START_LIST }));
  } else if (parsed.intent === "status") {
    const today = dateISO(nowInZone(next.settings.timezone));
    const plan = buildDayPlan(next, today);
    const over = plan.stats.workMinutes > plan.stats.workCap;
    const underSocial = plan.stats.socialMinutes < plan.stats.socialTarget;
    push(
      botText(
        over || underSocial
          ? `workaholic check: ${over ? "you're over the work cap. " : ""}${underSocial ? "social time is under goal. " : ""}protect the non-work blocks like they're meetings with someone you like.`
          : "balance looks decent today. don't sneak in 'just one more' task.",
        {
          type: "schedule",
          date: today,
          lines: planLines(plan),
          warnings: plan.warnings,
          stats: plan.stats,
        },
      ),
    );
  } else if (parsed.intent === "chitchat") {
    push(botText("haha noted. you still want me to lock something, or we just vibing?"));
  } else {
    push(
      botText(
        `i think you're talking about "${parsed.event.title}". treat it as:`,
        {
          buttons: [
            { id: "as-event", title: "An event", payload: `plan ${parsed.event.title}` },
            { id: "as-todo", title: "A to-do", payload: `remind me to ${parsed.event.title}` },
            { id: "rundown", title: "Rundown", payload: "rundown" },
          ],
        },
      ),
    );
  }

  if (next.settings && user.settings.timezone) {
    /* keep */
  }

  next.messages = [...next.messages, ...replies];
  return { user: next, replies };
}

export function welcomeIfEmpty(user: UserRecord): UserRecord {
  if (user.messages.length) return user;
  const msgs = greeting(user.name);
  return {
    ...user,
    messages: msgs,
    updatedAt: new Date().toISOString(),
  };
}

export function dueReminders(user: UserRecord): ChatMessage[] {
  const now = nowInZone(user.settings.timezone);
  const today = dateISO(now);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const lead = user.settings.reminderLeadMinutes;
  const due = user.events.filter((e) => {
    if (e.date !== today) return false;
    if (user.remindedEventIds.includes(e.id)) return false;
    const start = Number(e.start.slice(0, 2)) * 60 + Number(e.start.slice(3, 5));
    const delta = start - minutesNow;
    return delta <= lead && delta >= -5;
  });
  return due.map((e) =>
    botText(
      `heads up — *${e.title}* starts at ${formatClock(e.start)} (${e.kind}). wrap what you're doing; this is the reminder you asked for.`,
    ),
  );
}

export { greeting };
