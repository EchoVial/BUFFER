import { buildDayPlan } from "./scheduler";
import { addDaysISO, dateISO, hmToMinutes, minutesToHM, nowInZone, prettyDate, shortClock } from "./time";
import type { CalendarEvent, EventKind, ImageCard, UserRecord, UserSettings } from "./types";
import type { DayPlan } from "./scheduler";

/**
 * The life-first half of Buffer: where the free time is this week, what it
 * could be for, and holding a window so work cannot creep into it.
 */

export interface FreeWindow {
  date: string;
  startMin: number;
  endMin: number;
  /** evening = after protectEveningsAfter, day = during waking hours, weekend = any weekend daytime */
  slot: "evening" | "day" | "weekend";
}

export interface WeekView {
  from: string;
  days: Array<{ date: string; freeMinutes: number; workMinutes: number; socialMinutes: number; windows: FreeWindow[] }>;
  totalFree: number;
  /** Free minutes that fall on weekday evenings (after the switch-off time). */
  eveningFree: number;
  /** Free minutes on Saturday and Sunday. */
  weekendFree: number;
  totalWork: number;
  totalSocial: number;
  best: FreeWindow[];
}

/** Standing work hours, or null when the user said their days vary (start == end). */
export function standingWork(s: UserSettings): { start: number; end: number } | null {
  const a = hmToMinutes(s.workStart || "09:00");
  const b = hmToMinutes(s.workEnd || "18:00");
  if (a === b) return null;
  return { start: a, end: b };
}

const weekdayShort = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
const isWeekendISO = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`).getDay();
  return d === 0 || d === 6;
};

/** Seven days from today: free windows (≥ 45 min) outside sleep, tagged by when they fall. */
export function weekView(user: UserRecord, days = 7): WeekView {
  const now = nowInZone(user.settings.timezone);
  const today = dateISO(now);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const eveningAt = hmToMinutes(user.settings.protectEveningsAfter || "19:00");
  const out: WeekView = { from: today, days: [], totalFree: 0, eveningFree: 0, weekendFree: 0, totalWork: 0, totalSocial: 0, best: [] };
  for (let i = 0; i < days; i++) {
    const date = addDaysISO(today, i);
    const plan = buildDayPlan(user, date);
    // Free time is what the day plan leaves open (standing hours already sit in it as a block on weekdays).
    const weekend = isWeekendISO(date);
    const windows: FreeWindow[] = plan.blocks
      .filter((b) => b.kind === "free")
      .filter((b) => (i === 0 ? b.endMin > minutesNow + 15 : true))
      .flatMap((b) => {
        const start = i === 0 ? Math.max(b.startMin, Math.ceil(minutesNow / 15) * 15) : b.startMin;
        const parts: Array<[number, number]> = [[start, b.endMin]];
        return parts
          .filter(([a, z]) => z - a >= 45)
          // On a work day the morning before work is not "free for life"; evenings and long daytime gaps are.
          .filter(([a, z]) => weekend || a >= eveningAt - 60 || z - a >= 120)
          .map(
            ([a, z]): FreeWindow => ({
              date,
              startMin: a,
              endMin: z,
              slot: weekend ? "weekend" : a >= eveningAt - 60 ? "evening" : "day",
            }),
          );
      });
    const freeMinutes = windows.reduce((s, w) => s + (w.endMin - w.startMin), 0);
    const workMinutes = plan.stats.workMinutes;
    out.days.push({ date, freeMinutes, workMinutes, socialMinutes: plan.stats.socialMinutes, windows });
    out.totalFree += freeMinutes;
    if (weekend) out.weekendFree += freeMinutes;
    else out.eveningFree += windows.filter((w) => w.slot === "evening").reduce((s, w) => s + (w.endMin - w.startMin), 0);
    out.totalWork += workMinutes;
    out.totalSocial += plan.stats.socialMinutes;
  }
  // Best windows: the longest first, with a thumb on the scale for evenings and weekends,
  // and nothing under 90 minutes unless that is all there is.
  const score = (w: FreeWindow) => w.endMin - w.startMin + (w.slot === "evening" ? 60 : w.slot === "weekend" ? 45 : 0);
  const all = out.days.flatMap((d) => d.windows).sort((a, b) => score(b) - score(a));
  const roomy = all.filter((w) => w.endMin - w.startMin >= 90);
  out.best = (roomy.length ? roomy : all).slice(0, 4);
  return out;
}

export function hours(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function windowLabel(w: FreeWindow): string {
  return `${weekdayShort(w.date)} ${shortClock(minutesToHM(w.startMin))} to ${shortClock(minutesToHM(w.endMin))}`;
}

/** "Fri evening", "Sat midday", "Sun morning": short enough for a 20-character button after "Reserve ". */
export function slotName(w: FreeWindow): string {
  const h = Math.floor(w.startMin / 60);
  const part = h >= 17 ? "evening" : h >= 12 ? "midday" : "morning";
  return `${weekdayShort(w.date)} ${part}`;
}

export interface Suggestion {
  title: string;
  /** Button text, two or three words. */
  label: string;
  kind: EventKind;
  window: FreeWindow;
  durationMinutes: number;
  why: string;
}

const isGroupName = (n: string) => /^(roommates?|flatmates?|housemates?|friends|family|cousins|parents|siblings|the boys|the girls|the gang|team|mates)$/i.test(n.trim());
const weekdayLong = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });

/**
 * People first: one slot this week for each person they named (a call for a
 * person, an evening or weekend stretch for a group), then a friend, then a
 * walk. Each idea gets its own free window so they do not pile up.
 */
export function suggestForFreeTime(user: UserRecord, view: WeekView): Suggestion[] {
  const notes = (user.notes || "").toLowerCase();
  const cap = (n: string) => n.charAt(0).toUpperCase() + n.slice(1);
  const people = (user.people ?? []).slice(0, 3);
  const pool: Array<{ title: string; short: string; kind: EventKind; minutes: number; why: string; prefer: FreeWindow["slot"][] }> = [];
  for (const p of people) {
    if (isGroupName(p)) {
      pool.push({ title: `Time with ${p.toLowerCase()}`, short: cap(p), kind: "social", minutes: 120, why: `an evening with your ${p.toLowerCase()}`, prefer: ["evening", "weekend"] });
    } else {
      pool.push({ title: `Call ${cap(p)}`, short: `Call ${cap(p)}`, kind: "social", minutes: 30, why: `${cap(p)} would love it`, prefer: ["evening", "weekend", "day"] });
    }
  }
  if (pool.length < 3) {
    pool.push({ title: "Coffee with a friend", short: "Friend coffee", kind: "social", minutes: 60, why: "someone you have not seen in a while", prefer: ["weekend", "evening", "day"] });
  }
  if (pool.length < 3) {
    pool.push({ title: "Call home", short: "Call home", kind: "social", minutes: 30, why: "a call home counts", prefer: ["evening", "weekend"] });
  }
  if (pool.length < 3) {
    pool.push({
      title: /run|gym|yoga|swim|cycl/.test(notes) ? "Gym or a run" : "A long walk",
      short: /run|gym|yoga|swim|cycl/.test(notes) ? "Workout" : "Long walk",
      kind: "health",
      minutes: 45,
      why: "not everything has to be people",
      prefer: ["day", "weekend", "evening"],
    });
  }

  const used = new Set<string>();
  const picks: Suggestion[] = [];
  for (const p of pool) {
    const w =
      view.best.find((x) => !used.has(`${x.date}${x.startMin}`) && p.prefer.includes(x.slot) && x.endMin - x.startMin >= p.minutes) ??
      view.best.find((x) => !used.has(`${x.date}${x.startMin}`) && x.endMin - x.startMin >= p.minutes) ??
      view.days.flatMap((d) => d.windows).find((x) => !used.has(`${x.date}${x.startMin}`) && x.endMin - x.startMin >= p.minutes);
    if (!w) continue;
    used.add(`${w.date}${w.startMin}`);
    // A sensible clock time inside the window: nobody wants a call at 7:30 on a Saturday morning.
    // Calls: a little after switching off on weekdays, late morning on weekends. Long things: the evening, or weekend afternoon.
    const unwind = hmToMinutes(user.settings.protectEveningsAfter || "19:00");
    const wanted = w.slot === "weekend" ? (p.minutes <= 45 ? 11 * 60 : 17 * 60) : p.minutes <= 45 ? unwind + 30 : unwind;
    let startMin = Math.max(w.startMin, wanted);
    if (startMin + p.minutes > w.endMin) startMin = Math.max(w.startMin, w.slot === "weekend" && p.minutes > 45 ? 12 * 60 : w.startMin);
    if (startMin + p.minutes > w.endMin) startMin = w.startMin;
    startMin = Math.ceil(startMin / 15) * 15;
    const window: FreeWindow = { ...w, startMin, endMin: Math.min(w.endMin, startMin + p.minutes) };
    const label = `${p.short} ${weekdayShort(w.date)} ${shortClock(minutesToHM(startMin)).replace(/\s/g, "")}`.slice(0, 20);
    picks.push({ title: p.title, label, kind: p.kind, window, durationMinutes: p.minutes, why: p.why });
    if (picks.length === 3) break;
  }
  return picks;
}

/** "Call Mom · Tuesday 7:30 to 8 pm" */
export function suggestionLine(s: Suggestion): string {
  return `*${s.title}* · ${weekdayLong(s.window.date)} ${shortClock(minutesToHM(s.window.startMin))} to ${shortClock(minutesToHM(s.window.startMin + s.durationMinutes))}`;
}

/** "today" / "tomorrow" / "friday": words both the rule parser and Claude resolve the same way inside a 7-day window. */
export function dayWord(iso: string, tz: string): string {
  const today = dateISO(nowInZone(tz));
  if (iso === today) return "today";
  if (iso === addDaysISO(today, 1)) return "tomorrow";
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
}

/** Text the buttons send back, readable by both parsers. */
export function suggestionPayload(s: Suggestion, tz: string): string {
  return `plan ${s.title.toLowerCase()} ${dayWord(s.window.date, tz)} at ${shortClock(minutesToHM(s.window.startMin))} for ${s.durationMinutes} minutes, ${s.kind}`;
}

export function protectPayload(w: FreeWindow, tz: string, forWhom: "people" | "me"): string {
  return `protect ${dayWord(w.date, tz)} at ${shortClock(minutesToHM(w.startMin))} for ${Math.min(120, w.endMin - w.startMin)} minutes for ${forWhom}`;
}

/** A held window: a real event so work cannot be scheduled over it. */
export function protectedEvent(date: string, start: string, durationMinutes: number, kind: EventKind, label?: string): Omit<CalendarEvent, "id" | "createdAt"> {
  return {
    title: label ?? (kind === "social" ? "Reserved for people" : "Reserved for you"),
    kind,
    date,
    start,
    durationMinutes,
    flexible: false,
    notes: "Buffer is keeping this clear. Nothing else gets planned here.",
  };
}

export function describeWindow(date: string, start: string, durationMinutes: number): string {
  const s = hmToMinutes(start);
  return `${prettyDate(date)} · ${shortClock(start)} to ${shortClock(minutesToHM((s + durationMinutes) % (24 * 60)))}`;
}

/** "about 25h of free evenings and 32h of weekend" (whichever parts are non-zero). */
export function freeSummary(view: WeekView): string {
  const bits: string[] = [];
  if (view.eveningFree) bits.push(`${hours(view.eveningFree)} of free evenings`);
  if (view.weekendFree) bits.push(`${hours(view.weekendFree)} of weekend`);
  const other = view.totalFree - view.eveningFree - view.weekendFree;
  if (other >= 60) bits.push(`${hours(other)} in the day`);
  if (!bits.length) return view.totalFree ? `${hours(view.totalFree)} free` : "no real gaps";
  return bits.slice(0, 2).join(" and ");
}

/** The week as a picture: free (outside work) stacked on work, per day. */
export function weekImage(view: WeekView, user: UserRecord): ImageCard {
  const today = dateISO(nowInZone(user.settings.timezone));
  return {
    type: "image",
    variant: "week",
    title: "Your next 7 days",
    subtitle: view.totalWork ? "green is free, grey is work" : "nothing marked as work yet",
    days: view.days.map((d) => {
      const biggest = [...d.windows].sort((a, b) => b.endMin - b.startMin - (a.endMin - a.startMin))[0];
      return {
        date: d.date,
        label: `${weekdayShort(d.date)} ${Number(d.date.slice(8))}`,
        freeMinutes: d.freeMinutes,
        workMinutes: d.workMinutes,
        best: biggest ? `${shortClock(minutesToHM(biggest.startMin)).replace(/\s/g, "")} to ${shortClock(minutesToHM(biggest.endMin)).replace(/\s/g, "")}` : undefined,
        today: d.date === today,
      };
    }),
  };
}

/**
 * One plain sentence about the open time on a day, no hour counts:
 * "you're free until 7 pm", "you're free from 10 pm", "the biggest open stretch is 2 to 6 pm".
 */
export function freeLine(plan: DayPlan, user: UserRecord): string {
  const now = nowInZone(user.settings.timezone);
  const isToday = dateISO(now) === plan.date;
  const sleep = hmToMinutes(user.settings.sleepTime || "23:00");
  const free = plan.blocks.filter((b) => b.kind === "free" && b.endMin - b.startMin >= 30);
  const clock = (m: number) => shortClock(minutesToHM(m % (24 * 60)));
  if (isToday) {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const cur = free.find((b) => b.startMin <= nowMin && b.endMin > nowMin + 15);
    if (cur) return cur.endMin >= sleep - 15 ? "you're free for the rest of the day." : `you're free until ${clock(cur.endMin)}.`;
    const nxt = free.find((b) => b.startMin > nowMin);
    if (nxt) return nxt.endMin >= sleep - 15 ? `you're free from ${clock(nxt.startMin)}.` : `you're free ${clock(nxt.startMin)} to ${clock(nxt.endMin)}.`;
    return "the rest of today is full.";
  }
  if (!free.length) return "the day is full.";
  const busy = plan.blocks.some((b) => b.kind !== "free" && b.kind !== "sleep");
  if (!busy) return "the day is open.";
  // Longest wins; evenings get a thumb on the scale, since that is when people time happens.
  const eveningAt = hmToMinutes(user.settings.protectEveningsAfter || "19:00");
  const score = (b: { startMin: number; endMin: number }) => b.endMin - b.startMin + (b.startMin >= eveningAt - 60 ? 45 : 0);
  const big = [...free].sort((a, b) => score(b) - score(a))[0];
  return `the biggest open stretch is ${clock(big.startMin)} to ${clock(big.endMin)}.`;
}

/** Free minutes still ahead today (or the whole day's free time for another date). */
export function freeAhead(plan: DayPlan, user: UserRecord): number {
  const now = nowInZone(user.settings.timezone);
  if (dateISO(now) !== plan.date) return plan.stats.freeMinutes;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const total = plan.blocks.filter((b) => b.kind === "free").reduce((n, b) => n + Math.max(0, b.endMin - Math.max(b.startMin, nowMin)), 0);
  return Math.round(total / 5) * 5;
}

/** One day as a strip from wake to sleep. */
export function dayImage(plan: DayPlan, user: UserRecord, label: string, highlight?: string): ImageCard {
  const now = nowInZone(user.settings.timezone);
  const isToday = dateISO(now) === plan.date;
  const from = hmToMinutes(user.settings.wakeTime || "07:00");
  const to = hmToMinutes(user.settings.sleepTime || "23:00");
  const blocks = plan.blocks
    .filter((b) => b.kind !== "sleep")
    .map((b) => ({
      title: b.title,
      kind: b.kind === "event" ? (b.subtype ?? "work") : b.kind === "social" ? "social" : b.kind,
      startMin: b.startMin,
      endMin: b.endMin,
    }));
  const s = plan.stats;
  const pretty = prettyDate(plan.date);
  // For today, only the free time still ahead counts.
  const freeLeft = freeAhead(plan, user);
  return {
    type: "image",
    variant: "day",
    title: label,
    subtitle: label === pretty ? new Date(`${plan.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" }) : pretty,
    date: plan.date,
    fromMin: from,
    toMin: Math.max(to, from + 60),
    nowMin: isToday ? now.getHours() * 60 + now.getMinutes() : undefined,
    blocks,
    footer: [s.workMinutes ? `${hours(s.workMinutes)} work` : "", s.socialMinutes ? `${hours(s.socialMinutes)} people` : "", isToday ? `${hours(freeLeft)} free left` : `${hours(freeLeft)} free`].filter(Boolean).join(" · "),
    highlight,
  };
}
