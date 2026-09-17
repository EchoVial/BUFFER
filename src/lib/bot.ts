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
import { understand } from "./understand";
import type { ParsedMessage } from "./nlp";
import { describeWindow, hours, protectPayload, protectedEvent, slotName, suggestForFreeTime, suggestionPayload, weekCard, weekView, windowLabel } from "./life";
import { findNamedItem } from "./match";
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
      title: "Your week",
      rows: [
        { id: "week", title: "Free time this week", description: "Where the room is, day by day", payload: "how's my week" },
        { id: "ideas", title: "Ideas for my free time", description: "People, movement, rest", payload: "what should i do with my free time" },
        { id: "protect", title: "Hold an evening for me", description: "Work does not get scheduled there", payload: "protect an evening this week" },
        { id: "rundown", title: "Today's rundown", description: "Hour by hour", payload: "rundown" },
      ],
    },
    {
      title: "Plan",
      rows: [
        { id: "hang", title: "Plan a hang", description: "Coffee, dinner, a catch-up", payload: "plan something social" },
        { id: "event", title: "Plan an event", description: "Class, gym, meeting", payload: "i want to plan an event" },
        { id: "todo", title: "Add a to-do", description: "No fixed time, priority stack", payload: "remind me to " },
        { id: "social", title: "Room for people daily", description: "A standing window, if you want it", payload: "i want 2 hrs of social every day" },
        { id: "cal", title: "Connect my calendar", description: "Google, Apple, Android, Outlook", payload: "connect calendar" },
        { id: "help", title: "How this works", description: "Examples of what to text", payload: "help" },
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
      `hey ${name.split(" ")[0]}, i'm *Buffer*.\n\ni find the free time in your week and keep it for the rest of your life: people, a walk, a nap, a call home. work fits around that, not the other way round.\n\ntext me like a friend: *how's my week*, *keep thursday evening free*, *gym tmrw 7pm*, *what should i do this weekend*, *remind me to send the deck*.\n\nor tap *See options*.`,
      { list: START_LIST },
    ),
  ];
}

function optionsMessage(): ChatMessage {
  return botText("here's what i can do. tap one, or just text me.", { list: START_LIST });
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

function helpText(): string {
  return [
    "i read messy texts. try:",
    "• how's my week / when am i free",
    "• what should i do this weekend",
    "• keep thursday evening free",
    "• protect my evenings",
    "• gym tmrw 6:30pm for 1h",
    "• dinner w sam friday at 8",
    "• remind me to finish the deck p0 90m",
    "• i work 9 to 6, no work after 7pm",
    "• 2 hours for people every day",
    "• rundown / what's today",
    "• done with the deck",
    "• move gym to 8pm · star gym",
    "• connect calendar",
    "paste a list too:",
    "• buy milk",
    "• call jordan",
    "when you give me an event i fill the missing bits, show how the day settles, and you tap *Lock it*. held time stays held; work is not scheduled over it.",
  ].join("\n");
}

function renderTodos(user: UserRecord): string[] {
  const roots = user.todos.filter((t) => !t.parentId);
  const kids = (id: string) => user.todos.filter((t) => t.parentId === id);
  const line = (t: TodoItem, pad: string) => {
    const mark = t.done ? "✓" : "○";
    const due = t.dueDate ? ` · due ${prettyDate(t.dueDate)}` : "";
    return `${pad}${mark}${t.starred ? " ★" : ""} *${t.priority.toUpperCase()}* ${t.title} (${durationLabel(t.estimatedMinutes)})${due}`;
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
  parsed: ParsedMessage,
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
    starred: ev.starred,
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

const CHANGE_BUTTONS: ReplyButton[] = [
  { id: "apply", title: "Make the change", payload: "make the change" },
  { id: "leave", title: "Leave it", payload: "leave it" },
];

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

function lockFollowupButtons(connected: boolean): ReplyButton[] {
  return [
    { id: "reshuffle", title: "Move my tasks", payload: "reshuffle around this event" },
    { id: "star", title: "Star it", payload: "star this event" },
    connected
      ? { id: "addcal", title: "Add to calendar", payload: "add to calendar" }
      : { id: "connect", title: "Connect calendar", action: "connect-feed" },
  ];
}

function peopleNote(
  stats: DayStats,
  flavor: "status" | "rundown" | "afterWorkLock" | "afterSocialLock" | "afterTodo",
): string {
  const short = stats.socialMinutes < stats.socialTarget;
  const room = stats.freeMinutes >= 45;
  if (flavor === "afterSocialLock") {
    return "that's usually the kind of block that makes the rest of the day sit better.";
  }
  if (flavor === "afterWorkLock") {
    if (short && room) {
      return "there's a little open space later if a low-key hang sounds nice — skip it if you're cooked.";
    }
    if (short) {
      return "if this week's already loud, even a short catch-up sometime is plenty. no rush.";
    }
    return "";
  }
  if (flavor === "status") {
    if (stats.workMinutes > stats.workCap && short) {
      return "work ran a bit long. if you've got anything left in the tank, a small social thing can even it out — skip it if you're done for the day.";
    }
    if (short && room) {
      return "there's a pocket of free time. coffee, a walk, a call — only if you'd actually enjoy it.";
    }
    if (stats.workMinutes > stats.workCap) {
      return "work's stacked. a quiet evening still counts.";
    }
    return "today looks alright. hope there's something in it that's just for you.";
  }
  if (flavor === "afterTodo") {
    if (short && room) {
      return " if tonight's still open, it's a sweet window for people — or a book. your call.";
    }
    return "";
  }
  if (flavor === "rundown" && short && room) {
    return "\nthere's room for people today if you feel like it. no need to fill it.";
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
  return `*${ev.starred ? "★ " : ""}${ev.title}* · ${prettyDate(ev.date)} ${formatClock(ev.start)}`;
}

function lockEventMessage(next: UserRecord, ev: CalendarEvent): ChatMessage {
  next.lastLockedEventId = ev.id;
  const connected = Boolean(next.calendarConnectedAt);
  const plan = buildDayPlan(next, ev.date);
  const extra =
    ev.kind === "social"
      ? peopleNote(plan.stats, "afterSocialLock")
      : ev.kind === "work"
        ? peopleNote(plan.stats, "afterWorkLock")
        : "";
  return botText(
    `locked in. *${ev.title}* is on ${prettyDate(ev.date)} at ${formatClock(ev.start)}.\ni'll nudge you here ${next.settings.reminderLeadMinutes} min before${ev.kind === "work" ? " (work)" : ""}.${extra ? `\n${extra}` : ""}\n\nwant me to *move your tasks* around this, *star* it, or ${connected ? "*add it to your calendar*" : "*connect your calendar*"}? you can also just plan another event.`,
    {
      buttons: lockFollowupButtons(connected),
      calendarEventId: ev.id,
    },
  );
}

function applyStar(
  next: UserRecord,
  hit: { kind: "event" | "todo"; id: string },
  starred: boolean,
): string {
  if (hit.kind === "event") {
    next.events = next.events.map((e) => (e.id === hit.id ? { ...e, starred } : e));
    const ev = next.events.find((e) => e.id === hit.id);
    return ev
      ? starred
        ? `starred ${describeEvent(ev)}. i'll nudge you about this *before* other stuff so you can wrap it first.`
        : `took the star off *${ev.title}*.`
      : "couldn't find that event.";
  }
  next.todos = next.todos.map((t) =>
    t.id === hit.id ? { ...t, starred, priority: starred ? "p0" : t.priority } : t,
  );
  const todo = next.todos.find((t) => t.id === hit.id);
  return todo
    ? starred
      ? `starred *${todo.title}* (now P0). i'll prompt you to knock it out before other events land.`
      : `took the star off *${todo.title}*.`
    : "couldn't find that to-do.";
}

export async function processTurn(
  user: UserRecord,
  text: string,
): Promise<{ user: UserRecord; replies: ChatMessage[] }> {
  const now = new Date().toISOString();
  const incoming = userText(text);
  const parsed = await understand(text, user);
  const next: UserRecord = {
    ...user,
    messages: [...user.messages, incoming],
    lastNlp: parsed.debug,
    lastSeenAt: now,
    updatedAt: now,
    notes: rememberNotes(user.notes, parsed.memoryNotes),
  };
  const replies: ChatMessage[] = [];
  const push = (m: ChatMessage | ChatMessage[]) => {
    const arr = Array.isArray(m) ? m : [m];
    replies.push(...arr);
  };
  const hasSlots = Boolean(
    parsed.event.date || parsed.event.start || parsed.event.durationMinutes || parsed.event.kind,
  );

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
    const lead = view.totalFree
      ? `outside work hours you have about *${hours(view.totalFree)}* free over the next 7 days${view.totalWork ? `, with ${hours(view.totalWork)} of work booked` : ""}.`
      : "the next 7 days are packed edge to edge. that is the thing to fix first.";
    const best = view.best.length ? `\nbiggest windows: ${view.best.slice(0, 3).map(windowLabel).join(" · ")}.` : "";
    const nudge = view.best.length ? "\nwant me to hold one of those for people, or for you?" : "";
    const buttons = view.best.slice(0, 2).map((w, i) => ({
      id: `hold-${i}`,
      title: `Hold ${slotName(w)}`.slice(0, 20),
      payload: protectPayload(w, next.settings.timezone, "me"),
    }));
    push(
      botText(`${lead}${best}${nudge}`, {
        card: weekCard(view),
        buttons: [...buttons, { id: "ideas", title: "Ideas", payload: "what should i do with my free time" }].slice(0, 3),
      }),
    );
  } else if (parsed.intent === "plan_free") {
    const view = weekView(next);
    const picks = suggestForFreeTime(next, view);
    if (!picks.length) {
      push(botText("i can't find a 45-minute gap in the next week. say *keep thursday evening free* and i will make one."));
    } else {
      const lines = picks.map((p) => `• *${p.title}* · ${windowLabel(p.window)} · ${p.why}`);
      push(
        botText(`a few ways to spend the room you have:\n${lines.join("\n")}\n\ntap one and i'll put it on the calendar (you still get to *Lock it*).`, {
          buttons: picks.map((p, i) => ({ id: `idea-${i}`, title: p.title.slice(0, 20), payload: suggestionPayload(p, next.settings.timezone) })),
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
      // "protect an evening this week": pick the best evening (or the best window on the named day).
      const candidates = date ? view.best.filter((w) => w.date === date) : view.best.filter((w) => w.slot !== "day");
      const w = candidates[0] ?? view.best[0];
      if (!w) {
        push(botText("there is no open evening left this week to hold. tell me a day and time and i will clear it, e.g. *keep saturday 10am to 12 free*."));
        next.messages = [...next.messages, ...replies];
        return { user: next, replies };
      }
      date = w.date;
      start = start ?? minutesToHM(w.startMin);
      duration = duration ?? Math.min(120, w.endMin - w.startMin);
    }
    duration = duration ?? 120;
    const custom = parsed.event.title && !/^(protect|keep|hold|block|free|evening|weekend)/i.test(parsed.event.title) && !/(for me|for people|for myself)/i.test(parsed.event.title) ? parsed.event.title : undefined;
    const ev = finalizeEvent(protectedEvent(date, start, duration, kind, custom));
    next.events = [...next.events, ev];
    next.lastLockedEventId = ev.id;
    push(
      botText(`held. *${ev.title}* · ${describeWindow(ev.date, ev.start, ev.durationMinutes)}.\nwork will not get scheduled over it, and it goes to your calendar with the next refresh.`, {
        buttons: [
          { id: "week", title: "Rest of the week", payload: "how's my week" },
          { id: "ideas", title: "Ideas for it", payload: "what should i do with my free time" },
          ...calendarButtons(Boolean(next.calendarConnectedAt)).slice(0, 1),
        ],
        calendarEventId: ev.id,
      }),
    );
  } else if (next.draft.type === "edit" && parsed.intent === "confirm" && next.draft.edit) {
    const edit = next.draft.edit;
    if (edit.kind === "event") {
      if (edit.remove) {
        next.events = next.events.filter((e) => e.id !== edit.id);
      } else {
        next.events = next.events.map((e) =>
          e.id === edit.id ? { ...e, ...edit.eventPatch } : e,
        );
      }
    } else if (edit.remove) {
      next.todos = next.todos.filter((t) => t.id !== edit.id);
    } else {
      next.todos = next.todos.map((t) =>
        t.id === edit.id ? { ...t, ...edit.todoPatch } : t,
      );
    }
    next.draft = { type: "none", missing: [] };
    push(botText(`done. ${edit.summary}`));
  } else if (next.draft.type === "edit" && parsed.intent === "cancel") {
    next.draft = { type: "none", missing: [] };
    push(botText("left it as-is."));
  } else if (next.draft.type === "reshuffle" && parsed.intent === "confirm" && next.draft.reshuffle) {
    const rs = next.draft.reshuffle;
    next.todos = next.todos.map((t) => {
      const patch = rs.todos.find((p) => p.id === t.id);
      return patch ? { ...t, plannedDate: patch.plannedDate, plannedStart: patch.plannedStart } : t;
    });
    next.draft = { type: "none", missing: [] };
    const ev = next.events.find((e) => e.id === rs.eventId);
    const plan = buildDayPlan(next, ev?.date || dateISO(nowInZone(next.settings.timezone)));
    push(
      botText(`tasks now wrap around *${ev?.title || "that event"}*. starred work stays first.`, {
        type: "schedule",
        date: plan.date,
        lines: planLines(plan),
        warnings: plan.warnings,
        stats: plan.stats,
      }),
    );
  } else if (next.draft.type === "reshuffle" && parsed.intent === "cancel") {
    next.draft = { type: "none", missing: [] };
    push(botText("left the task order as-is."));
  } else if (parsed.intent === "calendar_connected") {
    const via =
      parsed.normalized.match(
        /\bconnected (?:my )?(google|apple|outlook|copy|snapshot)\b/,
      )?.[1] || "your";
    next.calendarConnectedAt = now;
    next.calendarConnectedVia = via;
    push(
      botText(
        `you're connected. *${connectedLabel(via)}* is hooked up to your live Buffer feed.\nlocked events will show up on the next refresh (about 15 minutes).\n\nyou're all set — i won't keep scheduling until you bring something up.`,
      ),
    );
  } else if (next.draft.type === "event" && parsed.intent === "cancel") {
    next.draft = { type: "none", missing: [] };
    push(
      botText(
        "scrapped. scheduling's off until you bring it up again — say *give options* or just text the next thing.",
      ),
    );
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
  } else if (next.draft.type === "event" && parsed.intent === "confirm") {
    if (next.draft.event && !next.draft.event.durationMinutes) {
      next.draft.event = { ...next.draft.event, durationMinutes: 60 };
    }
    if (next.draft.event && !next.draft.event.kind) {
      next.draft.event = { ...next.draft.event, kind: "other" };
    }
    const missing = missingEventFields(next.draft.event);
    if (missing.length) {
      push(askMessage(missing, next.draft.event));
    } else {
      const ev = finalizeEvent({
        durationMinutes: 60,
        kind: "other",
        ...next.draft.event,
      });
      next.events = [...next.events, ev];
      next.draft = { type: "none", missing: [] };
      push(lockEventMessage(next, ev));
    }
  } else if (parsed.intent === "edit_item") {
    const named =
      findNamedItem(next, parsed.targetHint || "") ||
      findNamedItem(next, parsed.event.title || text);
    if (!named) {
      push(botText("i couldn't tell which event or to-do you meant. name it like it shows on the rundown."));
    } else if (named.kind === "event") {
      const patch: Partial<CalendarEvent> = {};
      const bits: string[] = [];
      if (parsed.renameTo) {
        const title = parsed.renameTo.replace(/^(to)\s+/, "");
        patch.title = title.charAt(0).toUpperCase() + title.slice(1);
        bits.push(`rename to *${patch.title}*`);
      }
      if (parsed.event.date && parsed.event.date !== named.event.date) {
        patch.date = parsed.event.date;
        bits.push(`move to ${prettyDate(patch.date)}`);
      }
      if (parsed.event.start && parsed.event.start !== named.event.start) {
        patch.start = parsed.event.start;
        bits.push(`time ${formatClock(patch.start)}`);
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
        push(botText(`that's *${named.event.title}* already. say what to change — time, day, length, or *star ${named.event.title}*.`));
      } else {
        const summary = bits.join(", ");
        next.draft = {
          type: "edit",
          missing: [],
          edit: {
            kind: "event",
            id: named.event.id,
            title: named.event.title,
            summary: `update *${named.event.title}*: ${summary}`,
            eventPatch: patch,
          },
        };
        push(
          botText(
            `found ${describeEvent(named.event)}.\ni can ${summary}. tap *Make the change* to apply it.`,
            { buttons: CHANGE_BUTTONS, calendarEventId: named.event.id },
          ),
        );
      }
    } else {
      const patch: Partial<TodoItem> = {};
      const bits: string[] = [];
      if (parsed.renameTo) {
        const title = parsed.renameTo.replace(/^(to)\s+/, "");
        patch.title = title.charAt(0).toUpperCase() + title.slice(1);
        bits.push(`rename to *${patch.title}*`);
      }
      if (parsed.event.date && parsed.event.date !== named.todo.dueDate) {
        patch.dueDate = parsed.event.date;
        bits.push(`due ${prettyDate(patch.dueDate)}`);
      }
      if (parsed.todo.estimatedMinutes && parsed.todo.estimatedMinutes !== named.todo.estimatedMinutes) {
        patch.estimatedMinutes = parsed.todo.estimatedMinutes;
        bits.push(`estimate ${durationLabel(patch.estimatedMinutes)}`);
      }
      if (parsed.todo.priority && parsed.todo.priority !== named.todo.priority) {
        patch.priority = parsed.todo.priority;
        bits.push(`priority ${patch.priority.toUpperCase()}`);
      }
      if (parsed.todo.kind && parsed.todo.kind !== named.todo.kind) {
        patch.kind = parsed.todo.kind;
        bits.push(`kind ${patch.kind}`);
      }
      if (!bits.length) {
        push(botText(`that's to-do *${named.todo.title}*. say the change — due day, time estimate, or *star ${named.todo.title}*.`));
      } else {
        const summary = bits.join(", ");
        next.draft = {
          type: "edit",
          missing: [],
          edit: {
            kind: "todo",
            id: named.todo.id,
            title: named.todo.title,
            summary: `update *${named.todo.title}*: ${summary}`,
            todoPatch: patch,
          },
        };
        push(
          botText(
            `found to-do *${named.todo.starred ? "★ " : ""}${named.todo.title}*.\ni can ${summary}. tap *Make the change* to apply it.`,
            { buttons: CHANGE_BUTTONS },
          ),
        );
      }
    }
  } else if (
    next.draft.type === "event" &&
    parsed.intent === "add_event" &&
    parsed.event.title &&
    !sameishTitle(next.draft.event?.title, parsed.event.title) &&
    (parsed.event.date || parsed.event.start)
  ) {
    const ev: ConversationDraft["event"] = { ...parsed.event };
    if (!ev.durationMinutes) ev.durationMinutes = 60;
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
          `switching to a new one: *${full.title}*. tap *Lock it* to save, or tweak the time.`,
          proposal,
        ),
      );
    }
  } else if (
    next.draft.type === "event" &&
    (parsed.intent === "add_event" || (parsed.intent === "unknown" && hasSlots))
  ) {
    next.draft = applyEventPatch(next.draft, parsed);
    if (next.draft.missing.length) {
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
  } else if (next.draft.type === "event") {
    const title = next.draft.event?.title || "that event";
    push(
      botText(
        `still on *${title}* — tap *Lock it* or *Cancel* to close it out. i won't start something else until this one's done.`,
        next.draft.proposal ? { buttons: PROPOSAL_BUTTONS } : undefined,
      ),
    );
  } else if (parsed.intent === "confirm") {
    push(
      botText(
        "nothing's in the scheduler right now. say *give options* if you want the menu, or just text the next thing.",
      ),
    );
  } else if (parsed.intent === "cancel") {
    push(botText("nothing to cancel — we weren't scheduling. *give options* if you want the menu."));
  } else if (parsed.intent === "star" || parsed.intent === "unstar") {
    const starred = parsed.intent === "star";
    const thisOne = /\bthis (event|task|to-?do|one)\b/.test(parsed.normalized);
    let hit: { kind: "event" | "todo"; id: string } | undefined =
      thisOne && next.lastLockedEventId
        ? { kind: "event", id: next.lastLockedEventId }
        : undefined;
    if (!hit) {
      const named = findNamedItem(next, parsed.targetHint || parsed.event.title || text);
      if (named) hit = { kind: named.kind, id: named.kind === "event" ? named.event.id : named.todo.id };
    }
    if (!hit && next.lastLockedEventId) {
      hit = { kind: "event", id: next.lastLockedEventId };
    }
    if (!hit) {
      push(botText("which one should i star? name the event or to-do, like *star gym* or *star the deck*."));
    } else {
      push(botText(applyStar(next, hit, starred)));
    }
  } else if (parsed.intent === "reshuffle") {
    const ev =
      next.events.find((e) => e.id === next.lastLockedEventId) ||
      next.events[next.events.length - 1];
    if (!ev) {
      push(botText("lock an event first, then i can slide to-dos around it."));
    } else {
      const plan = buildDayPlan(next, ev.date);
      const todos = plan.blocks
        .filter((b) => b.kind === "todo" && b.id)
        .map((b) => ({
          id: b.id as string,
          plannedDate: ev.date,
          plannedStart: minutesToHM(b.startMin),
        }));
      next.draft = {
        type: "reshuffle",
        missing: [],
        reshuffle: {
          eventId: ev.id,
          todos,
          summary: `slide ${todos.length} task${todos.length === 1 ? "" : "s"} around ${ev.title}`,
        },
      };
      push(
        botText(
          `here's how to-dos would wrap around *${ev.title}* at ${formatClock(ev.start)}. tap *Make the change* to save the new order.`,
          {
            card: {
              type: "schedule",
              date: ev.date,
              lines: planLines(plan),
              warnings: plan.warnings,
              stats: plan.stats,
            },
            buttons: CHANGE_BUTTONS,
          },
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
        `locked those in (${bits}). i'll keep them in mind and mention it softly if a day's all work.\n${statsLine(plan.stats)}`,
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
        `${prettyDate(today)} *rundown* — ${statsLine(plan.stats)}${peopleNote(plan.stats, "rundown")}`,
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
      botText("your stack, parents first. P0s before inventing more work — and leave a little air for people:", {
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
      const leftoverHeat = next.todos.some(
        (t) => !t.done && (t.priority === "p0" || t.starred),
      );
      const extra = leftoverHeat
        ? ""
        : peopleNote(
            buildDayPlan(next, dateISO(nowInZone(next.settings.timezone))).stats,
            "afterTodo",
          );
      push(botText(`nice. *${hit.title}* is done.${extra}`));
    }
  } else if (parsed.intent === "add_todo") {
    let parentId: string | null = null;
    if (parsed.todo.parentHint) {
      parentId = findTodo(next, parsed.todo.parentHint)?.id ?? null;
    }
    const titles = (
      parsed.todo.items?.length
        ? parsed.todo.items
        : [parsed.todo.title || text.split("\n")[0].trim()]
    ).filter((t) => t && t.length > 1);
    if (!titles.length) {
      push(botText("that list came through empty. try bullets like:\n• buy milk\n• call jordan"));
    } else {
    const added: TodoItem[] = [];
    for (const title of titles) {
      const todo: TodoItem = {
        id: uid("todo"),
        title,
        priority: parsed.todo.priority || "p2",
        parentId: added.length === 0 ? parentId : parentId,
        estimatedMinutes: parsed.todo.estimatedMinutes || 45,
        dueDate: parsed.todo.dueDate,
        done: false,
        kind: parsed.todo.kind || "work",
        createdAt: now,
      };
      added.push(todo);
    }
    next.todos = [...next.todos, ...added];
    const today = dateISO(nowInZone(next.settings.timezone));
    const plan = buildDayPlan(next, today);
    if (added.length > 1) {
      push(
        botText(
          `got your list — added *${added.length}* to-dos:\n${added.map((t) => `• ${t.title}`).join("\n")}`,
          { type: "todos", lines: renderTodos(next) },
        ),
      );
    } else {
      const todo = added[0];
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
    }
    }
  } else if (parsed.intent === "add_event") {
    const ev: ConversationDraft["event"] = { ...parsed.event };
    if (!ev.durationMinutes) ev.durationMinutes = 60;
    if (!ev.kind) ev.kind = "other";
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
          `ok here's the move-around for *${full.title}*. tap *Lock it* to save, or tweak it.`,
          proposal,
        ),
      );
    }
  } else if (parsed.intent === "calendar") {
    const ev =
      next.events.find((e) => e.id === next.lastLockedEventId) ||
      next.events[next.events.length - 1];
    const connected = Boolean(next.calendarConnectedAt);
    if (!ev) {
      push(
        botText(
          connected
            ? "nothing locked yet — plan an event first, then i can add that one to Google or Outlook."
            : "nothing locked yet. tap *Connect calendar* to subscribe the live feed, or plan an event first.",
          connected
            ? undefined
            : { buttons: [{ id: "connect", title: "Connect calendar", action: "connect-feed" }] },
        ),
      );
    } else {
      push(
        botText(
          connected
            ? `*${ev.title}* · ${prettyDate(ev.date)} ${formatClock(ev.start)}\n\nadd this event to Google, Outlook, or download a file. your live feed is already connected.`
            : `*${ev.title}* · ${prettyDate(ev.date)} ${formatClock(ev.start)}\n\nyour calendar isn't connected yet — tap *Connect calendar* for the live feed, or add just this event to Google / Outlook.`,
          { buttons: calendarButtons(connected), calendarEventId: ev.id },
        ),
      );
    }
  } else if (parsed.intent === "help") {
    push(botText(helpText(), { list: START_LIST }));
  } else if (parsed.intent === "status") {
    const today = dateISO(nowInZone(next.settings.timezone));
    const plan = buildDayPlan(next, today);
    push(
      botText(
        peopleNote(plan.stats, "status"),
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
    push(botText(parsed.replyHint || "noted. whenever you want the week, an idea, or a rundown, just say."));
  } else if (parsed.intent === "greet") {
    push(optionsMessage());
  } else {
    push(
      botText(
        parsed.replyHint ? `${parsed.replyHint}\nwant me to treat *${parsed.event.title}* as:` : `i think you're talking about "${parsed.event.title}". treat it as:`,
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
  const out: ChatMessage[] = [];
  const starredTodos = user.todos.filter((t) => t.starred && !t.done);
  const upcoming = user.events.filter((e) => {
    if (e.date !== today) return false;
    const start = Number(e.start.slice(0, 2)) * 60 + Number(e.start.slice(3, 5));
    const delta = start - minutesNow;
    return delta <= Math.max(lead * 2, 45) && delta >= -5;
  });

  for (const e of upcoming) {
    const start = Number(e.start.slice(0, 2)) * 60 + Number(e.start.slice(3, 5));
    const delta = start - minutesNow;
    const starLead = e.starred ? Math.max(lead * 2, 45) : lead;
    if (delta <= starLead && delta >= -5 && !user.remindedEventIds.includes(e.id)) {
      out.push(
        botText(
          e.starred
            ? `★ heads up — starred *${e.title}* starts at ${formatClock(e.start)}. finish this before you slide into the next thing.`
            : `heads up — *${e.title}* starts at ${formatClock(e.start)}${e.kind === "social" ? ". hope it's a good one." : ` (${e.kind}). wrap what you're doing; this is the reminder you asked for.`}`,
        ),
      );
    }
    const preId = `pre:${e.id}`;
    if (
      starredTodos.length &&
      delta <= starLead &&
      delta > 0 &&
      !user.remindedEventIds.includes(preId)
    ) {
      out.push(
        botText(
          `before *${e.title}* at ${formatClock(e.start)}, knock out starred ${starredTodos.length === 1 ? "item" : "items"}: ${starredTodos.map((t) => `*${t.title}*`).join(", ")}.`,
        ),
      );
    }
  }
  return out;
}

export { greeting };

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
 * Once a day, after wake time: where the free time is this week and one
 * offer to hold some of it. Proactive, but only when there is something to say.
 */
export function dailyDigest(user: UserRecord): { message?: ChatMessage; patch?: Partial<UserRecord> } {
  const now = nowInZone(user.settings.timezone);
  const today = dateISO(now);
  if (user.lastDigestDate === today) return {};
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  if (minutesNow < hmToMinutes(user.settings.wakeTime || "07:00") + 30) return {};
  if (!user.events.length && !user.todos.length) return {};
  const view = weekView(user);
  const best = view.best[0];
  const text = best
    ? `morning. outside work you have about *${hours(view.totalFree)}* free this week${view.totalWork ? `, with ${hours(view.totalWork)} of work booked` : ""}. the best open window is ${windowLabel(best)}. want me to hold it for people, or for you?`
    : `morning. the next 7 days are wall to wall. say *keep an evening free* and i will carve one out.`;
  return {
    message: botText(text, {
      buttons: best
        ? [
            { id: "hold-people", title: "Hold it for people", payload: protectPayload(best, user.settings.timezone, "people") },
            { id: "hold-me", title: "Hold it for me", payload: protectPayload(best, user.settings.timezone, "me") },
            { id: "week", title: "Show the week", payload: "how's my week" },
          ]
        : [{ id: "protect", title: "Keep an evening free", payload: "protect an evening this week" }],
    }),
    patch: { lastDigestDate: today },
  };
}
