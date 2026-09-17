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

const CALENDAR_BUTTONS: ReplyButton[] = [
  { id: "connect", title: "Connect calendar", action: "connect-feed" },
  { id: "gcal", title: "Google (this event)", action: "google-cal" },
  { id: "outlook", title: "Outlook (this event)", action: "outlook-cal" },
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
      title: "Buffer",
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
      `hey ${name.split(" ")[0]} 👋 i'm *Buffer*. think of me as the friend who actually remembers your calendar *and* tells you to leave the laptop.\n\ntext me like you text anyone — gym tmrw 7pm, i want 2 hrs of social every day, *rundown*, remind me to send the deck p0.\n\nor tap *See options* below, WhatsApp-style.`,
      { list: START_LIST },
    ),
  ];
}

function optionsMessage(): ChatMessage {
  return botText(
    "here's what else you can do — *Plan* and *Buffer*. tap *See options*, or just text me.",
    { list: START_LIST },
  );
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
    "• give options",
    "paste a list too:",
    "• buy milk",
    "• call jordan",
    "• dump the outline 30m",
    "• star gym / star the deck",
    "• move gym to 8pm",
    "when you drop an event i'll ask the missing bits, then show how to-dos slide around. tap *Lock it* when the plan looks right — after lock or cancel, scheduling stops until you bring it up again.",
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

function lockFollowupButtons(connected: boolean): ReplyButton[] {
  return [
    { id: "reshuffle", title: "Move my tasks", payload: "reshuffle around this event" },
    { id: "star", title: "Star it", payload: "star this event" },
    connected
      ? { id: "options", title: "See options", payload: "give options" }
      : { id: "connect", title: "Connect calendar", action: "connect-feed" },
  ];
}

function describeEvent(ev: CalendarEvent): string {
  return `*${ev.starred ? "★ " : ""}${ev.title}* · ${prettyDate(ev.date)} ${formatClock(ev.start)}`;
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
  const hasSlots = Boolean(
    parsed.event.date || parsed.event.start || parsed.event.durationMinutes || parsed.event.kind,
  );

  if (parsed.intent === "options") {
    push(optionsMessage());
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
  } else if (next.draft.type === "event" && parsed.intent === "confirm" && next.draft.proposal) {
    const ev = finalizeEvent({
      durationMinutes: 60,
      kind: "other",
      ...next.draft.event,
    });
    next.events = [...next.events, ev];
    next.draft = { type: "none", missing: [] };
    next.lastLockedEventId = ev.id;
    const connected = Boolean(next.calendarConnectedAt);
    push(
      botText(
        `locked in. *${ev.title}* is on ${prettyDate(ev.date)} at ${formatClock(ev.start)}.\ni'll nudge you here ${next.settings.reminderLeadMinutes} min before${ev.kind === "work" ? " (work)" : ""}.\n\nwant me to *move your tasks* around this, or *star* it so i prompt you to finish it before other stuff?`,
        {
          buttons: lockFollowupButtons(connected),
          calendarEventId: ev.id,
        },
      ),
    );
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
    push(optionsMessage());
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
          : "you're in decent shape today. don't sneak in 'just one more' task.",
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
    push(botText("haha noted. say *give options* if you want the menu, or just text the next thing."));
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
            : `heads up — *${e.title}* starts at ${formatClock(e.start)} (${e.kind}). wrap what you're doing; this is the reminder you asked for.`,
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
