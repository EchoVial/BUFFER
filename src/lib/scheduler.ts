import {
  CalendarEvent,
  DayStats,
  MessageCard,
  TodoItem,
  UserRecord,
} from "./types";
import {
  durationLabel,
  formatClock,
  hmToMinutes,
  isStandingDay,
  isWeekend,
  minutesToHM,
  prettyDate,
} from "./time";

export interface ScheduleBlock {
  startMin: number;
  endMin: number;
  title: string;
  kind: "event" | "todo" | "social" | "free" | "sleep";
  subtype?: string;
  id?: string;
  movable: boolean;
}

export interface DayPlan {
  date: string;
  blocks: ScheduleBlock[];
  overlaps: Array<{ a: string; b: string; startMin: number; endMin: number }>;
  stats: DayStats;
  warnings: string[];
  unplaced: string[];
}

function eventsOn(user: UserRecord, date: string): CalendarEvent[] {
  return user.events.filter((e) => e.date === date);
}

function openTodos(user: UserRecord): TodoItem[] {
  const byId = new Map(user.todos.map((t) => [t.id, t]));
  return user.todos
    .filter((t) => !t.done)
    .sort((a, b) => {
      if (Boolean(a.starred) !== Boolean(b.starred)) return a.starred ? -1 : 1;
      const rank = { p0: 0, p1: 1, p2: 2, p3: 3 };
      if (rank[a.priority] !== rank[b.priority]) {
        return rank[a.priority] - rank[b.priority];
      }
      const ad = a.dueDate || "9999";
      const bd = b.dueDate || "9999";
      if (ad !== bd) return ad.localeCompare(bd);
      const ap = a.parentId ? 1 : 0;
      const bp = b.parentId ? 1 : 0;
      if (ap !== bp) return ap - bp;
      return a.title.localeCompare(b.title);
    })
    .map((t) => ({
      ...t,
      title: t.parentId
        ? `${byId.get(t.parentId)?.title ?? "…"} → ${t.title}`
        : t.title,
    }));
}

function clip(start: number, end: number, lo: number, hi: number) {
  return { start: Math.max(start, lo), end: Math.min(end, hi) };
}

function freeGaps(
  occupied: Array<{ start: number; end: number }>,
  from: number,
  to: number,
): Array<{ start: number; end: number }> {
  const sorted = [...occupied].sort((a, b) => a.start - b.start);
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = from;
  for (const o of sorted) {
    if (o.start > cursor) gaps.push({ start: cursor, end: o.start });
    cursor = Math.max(cursor, o.end);
  }
  if (cursor < to) gaps.push({ start: cursor, end: to });
  return gaps.filter((g) => g.end - g.start >= 15);
}

export function buildDayPlan(user: UserRecord, date: string): DayPlan {
  const s = user.settings;
  const wake = hmToMinutes(s.wakeTime);
  let sleep = hmToMinutes(s.sleepTime);
  if (sleep <= wake) sleep += 24 * 60;
  const socialTarget =
    s.socialMinutesPerDay + (isWeekend(date) ? s.weekendSocialBonusMinutes : 0);

  const dayEvents = eventsOn(user, date);
  const eventBlocks: ScheduleBlock[] = dayEvents.map((e) => {
    const start = hmToMinutes(e.start);
    return {
      startMin: start,
      endMin: start + e.durationMinutes,
      title: e.starred ? `★ ${e.title}` : e.title,
      kind: "event",
      subtype: e.kind,
      id: e.id,
      movable: e.flexible,
    };
  });
  // Standing hours ("every weekday 9 to 5") are a block on weekdays, unless the day is off or a marked
  // work block overlaps them (then the marked one is the truth for that day).
  const standingStart = hmToMinutes(s.workStart);
  const standingEnd = hmToMinutes(s.workEnd);
  const overlapsStanding = dayEvents.some((e) => e.kind === "work" && hmToMinutes(e.start) < standingEnd && hmToMinutes(e.start) + e.durationMinutes > standingStart);
  const dayOff = user.daysOff?.includes(date) ?? false;
  if (standingEnd > standingStart && isStandingDay(s.workDays, date) && !overlapsStanding && !dayOff) {
    eventBlocks.push({
      startMin: standingStart,
      endMin: standingEnd,
      title: s.workLabel || "Work",
      kind: "event",
      subtype: "work",
      movable: false,
    });
  }

  const overlaps: DayPlan["overlaps"] = [];
  for (let i = 0; i < eventBlocks.length; i++) {
    for (let j = i + 1; j < eventBlocks.length; j++) {
      const a = eventBlocks[i];
      const b = eventBlocks[j];
      const start = Math.max(a.startMin, b.startMin);
      const end = Math.min(a.endMin, b.endMin);
      if (end > start) {
        overlaps.push({ a: a.title, b: b.title, startMin: start, endMin: end });
      }
    }
  }

  const occupied = eventBlocks.map((b) => ({
    start: b.startMin,
    end: b.endMin,
  }));
  const gaps = freeGaps(occupied, wake, sleep);
  const todoBlocks: ScheduleBlock[] = [];
  const unplaced: string[] = [];
  let workUsed = eventBlocks
    .filter((b) => b.subtype === "work")
    .reduce((n, b) => n + (b.endMin - b.startMin), 0);
  let socialUsed = dayEvents
    .filter((e) => e.kind === "social")
    .reduce((n, e) => n + e.durationMinutes, 0);

  const workEndCap = s.noWorkAfter
    ? hmToMinutes(s.noWorkAfter)
    : hmToMinutes(s.workEnd) + 120;

  for (const todo of openTodos(user)) {
    if (todo.dueDate && todo.dueDate < date) {
      /* still try to place overdue work */
    } else if (todo.dueDate && todo.dueDate > date && todo.priority !== "p0") {
      continue;
    }
    let placed = false;
    if (todo.plannedDate === date && todo.plannedStart) {
      const start = hmToMinutes(todo.plannedStart);
      const end = start + todo.estimatedMinutes;
      const gap = gaps.find((g) => g.start <= start && g.end >= end);
      if (gap) {
        todoBlocks.push({
          startMin: start,
          endMin: end,
          title: todo.starred ? `★ ${todo.title}` : todo.title,
          kind: "todo",
          subtype: todo.kind,
          id: todo.id,
          movable: true,
        });
        if (start === gap.start) gap.start = end;
        placed = true;
        if (todo.kind === "work") workUsed += todo.estimatedMinutes;
        if (todo.kind === "social") socialUsed += todo.estimatedMinutes;
      }
    }
    for (const gap of gaps) {
      if (placed) break;
      const workFrom = hmToMinutes(s.workStart) === hmToMinutes(s.workEnd) ? 9 * 60 : hmToMinutes(s.workStart);
      const lo = todo.kind === "work" ? Math.max(gap.start, workFrom) : gap.start;
      const hi =
        todo.kind === "work" ? Math.min(gap.end, workEndCap) : gap.end;
      if (hi - lo < todo.estimatedMinutes) continue;
      if (
        todo.kind === "work" &&
        workUsed + todo.estimatedMinutes > s.maxWorkMinutesPerDay
      ) {
        continue;
      }
      const start = lo;
      const end = lo + todo.estimatedMinutes;
      todoBlocks.push({
        startMin: start,
        endMin: end,
        title: todo.starred ? `★ ${todo.title}` : todo.title,
        kind: "todo",
        subtype: todo.kind,
        id: todo.id,
        movable: true,
      });
      gap.start = end;
      placed = true;
      if (todo.kind === "work") workUsed += todo.estimatedMinutes;
      if (todo.kind === "social") socialUsed += todo.estimatedMinutes;
      break;
    }
    if (!placed) unplaced.push(todo.title);
  }

  const afterTodos = [...eventBlocks, ...todoBlocks];
  const occ2 = afterTodos.map((b) => ({ start: b.startMin, end: b.endMin }));
  const remain = freeGaps(occ2, wake, sleep);
  const socialBlocks: ScheduleBlock[] = [];
  if (socialUsed < socialTarget) {
    let need = socialTarget - socialUsed;
    const evening = hmToMinutes(s.protectEveningsAfter);
    const ranked = [...remain].sort((a, b) => {
      const aEve = a.start >= evening ? 0 : 1;
      const bEve = b.start >= evening ? 0 : 1;
      if (aEve !== bEve) return aEve - bEve;
      return b.end - b.start - (a.end - a.start);
    });
    for (const gap of ranked) {
      if (need <= 0) break;
      // Sit in the evening part of a gap when there is one; people time in the morning rarely lands.
      const from = gap.start < evening && gap.end - evening >= 20 ? evening : gap.start;
      const slice = Math.min(need, gap.end - from);
      if (slice < 20) continue;
      socialBlocks.push({
        startMin: from,
        endMin: from + slice,
        title: "Space for people",
        kind: "social",
        movable: true,
      });
      need -= slice;
      socialUsed += slice;
    }
  }

  const all = [...eventBlocks, ...todoBlocks, ...socialBlocks].sort(
    (a, b) => a.startMin - b.startMin,
  );
  const free = freeGaps(
    all.map((b) => ({ start: b.startMin, end: b.endMin })),
    wake,
    sleep,
  ).map(
    (g): ScheduleBlock => ({
      startMin: g.start,
      endMin: g.end,
      title: "Free",
      kind: "free",
      movable: false,
    }),
  );

  const blocks = [...all, ...free].sort((a, b) => a.startMin - b.startMin);
  const personalMinutes = dayEvents
    .filter((e) => e.kind === "personal" || e.kind === "health")
    .reduce((n, e) => n + e.durationMinutes, 0);
  const freeMinutes = free.reduce((n, b) => n + (b.endMin - b.startMin), 0);

  const warnings: string[] = [];
  if (overlaps.length) {
    warnings.push(
      `Overlap alert: ${overlaps
        .map(
          (o) =>
            `"${o.a}" clashes with "${o.b}" (${formatClock(minutesToHM(o.startMin))})`,
        )
        .join("; ")}`,
    );
  }
  if (socialUsed < socialTarget) {
    warnings.push(
      `There's still a little room for people today if you want it (${durationLabel(socialUsed)} vs ${durationLabel(socialTarget)}). Skip it if you're wiped.`,
    );
  }
  if (workUsed > s.maxWorkMinutesPerDay) {
    warnings.push(
      `Work is a bit over your ${durationLabel(s.maxWorkMinutesPerDay)} cap (${durationLabel(workUsed)}). Splitting something is optional — just a heads-up.`,
    );
  }
  for (const e of dayEvents) {
    if (
      e.kind === "work" &&
      s.noWorkAfter &&
      hmToMinutes(e.start) >= hmToMinutes(s.noWorkAfter)
    ) {
      warnings.push(
        `"${e.title}" sits after your no-work line (${formatClock(s.noWorkAfter)}).`,
      );
    }
  }
  if (unplaced.length) {
    warnings.push(
      `Couldn't fit today: ${unplaced.slice(0, 4).join(", ")}${unplaced.length > 4 ? "…" : ""}.`,
    );
  }

  void clip;

  return {
    date,
    blocks,
    overlaps,
    stats: {
      workMinutes: workUsed,
      socialMinutes: socialUsed,
      personalMinutes,
      freeMinutes,
      socialTarget,
      workCap: s.maxWorkMinutesPerDay,
    },
    warnings,
    unplaced,
  };
}

export function planLines(plan: DayPlan): string[] {
  return plan.blocks
    .filter((b) => b.kind !== "free" || b.endMin - b.startMin >= 30)
    .map((b) => {
      const tag =
        b.kind === "event"
          ? (b.subtype || "event").toUpperCase()
          : b.kind === "todo"
            ? "TODO"
            : b.kind === "social"
              ? "SOCIAL"
              : "FREE";
      return `${formatClock(minutesToHM(b.startMin))}–${formatClock(minutesToHM(b.endMin))}  ${b.title}  · ${tag} ${durationLabel(b.endMin - b.startMin)}`;
    });
}

export function statsLine(stats: DayStats): string {
  return `Work ${durationLabel(stats.workMinutes)}/${durationLabel(stats.workCap)} · Social ${durationLabel(stats.socialMinutes)}/${durationLabel(stats.socialTarget)} · Free ${durationLabel(stats.freeMinutes)}`;
}

/** The same numbers in plain words, no targets or caps: "3h of work, 1h with people, 6h free". */
export function plainStats(stats: DayStats): string {
  const bits: string[] = [];
  if (stats.workMinutes) bits.push(`${durationLabel(stats.workMinutes)} of work`);
  if (stats.socialMinutes) bits.push(`${durationLabel(stats.socialMinutes)} with people`);
  if (stats.personalMinutes) bits.push(`${durationLabel(stats.personalMinutes)} for you`);
  bits.push(stats.freeMinutes ? `${durationLabel(stats.freeMinutes)} free` : "no free time left");
  return bits.join(", ");
}

export function proposeEvent(
  user: UserRecord,
  event: CalendarEvent,
): Extract<MessageCard, { type: "proposal" }> {
  const before = buildDayPlan(user, event.date);
  const clone: UserRecord = {
    ...user,
    events: [...user.events, event],
  };
  const after = buildDayPlan(clone, event.date);

  const beforeTodos = before.blocks.filter((b) => b.kind === "todo");
  const afterTodos = after.blocks.filter((b) => b.kind === "todo");
  const moves: string[] = [];
  for (const t of afterTodos) {
    const prev = beforeTodos.find((b) => b.id === t.id);
    if (prev && prev.startMin !== t.startMin) {
      moves.push(
        `"${t.title}" slides ${formatClock(minutesToHM(prev.startMin))} → ${formatClock(minutesToHM(t.startMin))}`,
      );
    }
  }
  for (const title of after.unplaced) {
    if (!before.unplaced.includes(title)) {
      moves.push(`"${title}" gets bumped off today to make room`);
    }
  }

  if (after.overlaps.length) {
    moves.push("There's a hard overlap — see warnings. We can still lock it if you want.");
  }
  if (
    event.kind === "work" &&
    hmToMinutes(event.start) >= hmToMinutes(user.settings.protectEveningsAfter)
  ) {
    moves.push(
      "This sits in evening hours. Fine to keep — only mentioning it in case you wanted that stretch for people.",
    );
  }

  return {
    type: "proposal",
    date: event.date,
    summary: `Here's how ${prettyDate(event.date)} reshuffles if we add this.`,
    before: planLines(before),
    after: planLines(after),
    moves: moves.length ? moves : ["Nothing else has to move. Clean insert."],
    warnings: after.warnings,
    eventPreview: `${event.title} · ${prettyDate(event.date)} ${formatClock(event.start)} · ${durationLabel(event.durationMinutes)} · ${event.kind}`,
  };
}
