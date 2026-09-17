import { buildDayPlan } from "./scheduler";
import { addDaysISO, dateISO, formatClock, hmToMinutes, minutesToHM, nowInZone, prettyDate } from "./time";
import type { CalendarEvent, EventKind, ImageCard, MessageCard, UserRecord } from "./types";
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
  totalWork: number;
  totalSocial: number;
  best: FreeWindow[];
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
  const out: WeekView = { from: today, days: [], totalFree: 0, totalWork: 0, totalSocial: 0, best: [] };
  for (let i = 0; i < days; i++) {
    const date = addDaysISO(today, i);
    const plan = buildDayPlan(user, date);
    // Free time is what is left outside working hours on weekdays; weekends count whole.
    const weekend = isWeekendISO(date);
    const workStart = hmToMinutes(user.settings.workStart || "09:00");
    const workEnd = hmToMinutes(user.settings.workEnd || "18:00");
    const windows: FreeWindow[] = plan.blocks
      .filter((b) => b.kind === "free")
      .filter((b) => (i === 0 ? b.endMin > minutesNow + 15 : true))
      .flatMap((b) => {
        const start = i === 0 ? Math.max(b.startMin, Math.ceil(minutesNow / 15) * 15) : b.startMin;
        const parts: Array<[number, number]> = weekend ? [[start, b.endMin]] : [[start, Math.min(b.endMin, workStart)], [Math.max(start, workEnd), b.endMin]];
        return parts
          .filter(([a, z]) => z - a >= 45)
          .map(
            ([a, z]): FreeWindow => ({
              date,
              startMin: a,
              endMin: z,
              slot: weekend ? "weekend" : a >= eveningAt ? "evening" : "day",
            }),
          );
      });
    const freeMinutes = windows.reduce((s, w) => s + (w.endMin - w.startMin), 0);
    out.days.push({ date, freeMinutes, workMinutes: plan.stats.workMinutes, socialMinutes: plan.stats.socialMinutes, windows });
    out.totalFree += freeMinutes;
    out.totalWork += plan.stats.workMinutes;
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
  return `${weekdayShort(w.date)} ${formatClock(minutesToHM(w.startMin))} to ${formatClock(minutesToHM(w.endMin))}`;
}

/** "Fri evening", "Sat afternoon", "Sun morning": for button labels. */
export function slotName(w: FreeWindow): string {
  const h = Math.floor(w.startMin / 60);
  const part = h >= 17 ? "evening" : h >= 12 ? "afternoon" : "morning";
  return `${weekdayShort(w.date)} ${part}`;
}

/** Card lines for the week: one line per day, biggest window called out. */
export function weekCard(view: WeekView): MessageCard {
  const lines = view.days.map((d) => {
    const biggest = [...d.windows].sort((a, b) => b.endMin - b.startMin - (a.endMin - a.startMin))[0];
    const free = d.freeMinutes ? `${hours(d.freeMinutes)} free` : "no real gaps";
    const work = d.workMinutes ? ` · ${hours(d.workMinutes)} work` : "";
    const win = biggest ? ` · best ${formatClock(minutesToHM(biggest.startMin))} to ${formatClock(minutesToHM(biggest.endMin))}` : "";
    return `${weekdayShort(d.date)} ${d.date.slice(8)} · ${free}${work}${win}`;
  });
  const warnings: string[] = [];
  const heavy = view.days.filter((d) => d.workMinutes > 0 && d.freeMinutes < 60);
  if (heavy.length) warnings.push(`${heavy.map((d) => weekdayShort(d.date)).join(", ")}: work leaves under an hour. Worth protecting something.`);
  return {
    type: "schedule",
    date: view.from,
    lines,
    warnings,
    stats: {
      workMinutes: view.totalWork,
      socialMinutes: view.totalSocial,
      personalMinutes: 0,
      freeMinutes: view.totalFree,
      socialTarget: 0,
      workCap: 0,
    },
  };
}

export interface Suggestion {
  title: string;
  kind: EventKind;
  window: FreeWindow;
  durationMinutes: number;
  why: string;
}

/**
 * Ideas for the free time, shaped by what the week is missing: people first
 * when the social target is behind, then movement, then an hour that is
 * simply theirs. Remembered facts (notes) nudge the wording.
 */
export function suggestForFreeTime(user: UserRecord, view: WeekView): Suggestion[] {
  const notes = (user.notes || "").toLowerCase();
  const socialGap = view.totalSocial < user.settings.socialMinutesPerDay * 3;
  const hasHealth = user.events.some((e) => e.kind === "health" && e.date >= view.from);
  const pool: Array<{ title: string; kind: EventKind; minutes: number; why: string; prefer: FreeWindow["slot"][] }> = [];
  const friend = notes.match(/friend[s]?:?\s*([a-z][a-z .]+)/)?.[1]?.split(/[ ,.]/)[0];
  pool.push({
    title: friend ? `Call ${friend.charAt(0).toUpperCase() + friend.slice(1)}` : "Dinner or a call with a friend",
    kind: "social",
    minutes: 60,
    why: socialGap ? "you are behind on people this week" : "keeps the week from being only work",
    prefer: ["evening", "weekend"],
  });
  pool.push({
    title: /run|gym|yoga|swim|cycl/.test(notes) ? "Move: gym, run or a long walk" : "A long walk, no headphones",
    kind: "health",
    minutes: 45,
    why: hasHealth ? "one more turn for the body" : "nothing for your body is on the calendar yet",
    prefer: ["day", "weekend", "evening"],
  });
  pool.push({
    title: "An hour that is yours",
    kind: "personal",
    minutes: 60,
    why: "no screens, no to-dos, whatever you like",
    prefer: ["evening", "weekend"],
  });
  pool.push({
    title: "Family time",
    kind: "social",
    minutes: 60,
    why: "a call home counts",
    prefer: ["weekend", "evening"],
  });

  const used = new Set<string>();
  const picks: Suggestion[] = [];
  for (const p of pool) {
    const w =
      view.best.find((x) => !used.has(`${x.date}${x.startMin}`) && p.prefer.includes(x.slot) && x.endMin - x.startMin >= p.minutes) ??
      view.best.find((x) => !used.has(`${x.date}${x.startMin}`) && x.endMin - x.startMin >= p.minutes);
    if (!w) continue;
    used.add(`${w.date}${w.startMin}`);
    picks.push({ title: p.title, kind: p.kind, window: w, durationMinutes: p.minutes, why: p.why });
    if (picks.length === 3) break;
  }
  return picks;
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
  return `plan ${s.title.toLowerCase()} ${dayWord(s.window.date, tz)} at ${formatClock(minutesToHM(s.window.startMin)).toLowerCase()} for ${s.durationMinutes} minutes, ${s.kind}`;
}

export function protectPayload(w: FreeWindow, tz: string, forWhom: "people" | "me"): string {
  return `protect ${dayWord(w.date, tz)} at ${formatClock(minutesToHM(w.startMin)).toLowerCase()} for ${Math.min(120, w.endMin - w.startMin)} minutes for ${forWhom}`;
}

/** A held window: a real event so work cannot be scheduled over it. */
export function protectedEvent(date: string, start: string, durationMinutes: number, kind: EventKind, label?: string): Omit<CalendarEvent, "id" | "createdAt"> {
  return {
    title: label ?? (kind === "social" ? "Held for people" : "Held for you"),
    kind,
    date,
    start,
    durationMinutes,
    flexible: false,
    notes: "Buffer is keeping this clear. Work does not get scheduled here.",
  };
}

export function describeWindow(date: string, start: string, durationMinutes: number): string {
  const s = hmToMinutes(start);
  return `${prettyDate(date)} · ${formatClock(start)} to ${formatClock(minutesToHM(s + durationMinutes))}`;
}

/** The week as a picture: free (outside work) stacked on work, per day. */
export function weekImage(view: WeekView, user: UserRecord): ImageCard {
  const today = dateISO(nowInZone(user.settings.timezone));
  return {
    type: "image",
    variant: "week",
    title: "Your next 7 days",
    subtitle: `${hours(view.totalFree)} free outside work${view.totalWork ? ` · ${hours(view.totalWork)} of work booked` : ""}`,
    days: view.days.map((d) => {
      const biggest = [...d.windows].sort((a, b) => b.endMin - b.startMin - (a.endMin - a.startMin))[0];
      return {
        date: d.date,
        label: `${weekdayShort(d.date)} ${Number(d.date.slice(8))}`,
        freeMinutes: d.freeMinutes,
        workMinutes: d.workMinutes,
        best: biggest ? `${formatClock(minutesToHM(biggest.startMin)).replace(/:00/, "").replace(/\s/g, "").toLowerCase()} to ${formatClock(minutesToHM(biggest.endMin)).replace(/:00/, "").replace(/\s/g, "").toLowerCase()}` : undefined,
        today: d.date === today,
      };
    }),
  };
}

/** One day as a strip from wake to sleep. */
export function dayImage(plan: DayPlan, user: UserRecord, label: string): ImageCard {
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
  return {
    type: "image",
    variant: "day",
    title: label,
    subtitle: prettyDate(plan.date),
    date: plan.date,
    fromMin: from,
    toMin: Math.max(to, from + 60),
    nowMin: isToday ? now.getHours() * 60 + now.getMinutes() : undefined,
    blocks,
    footer: `${hours(s.workMinutes)} work · ${hours(s.socialMinutes)} people · ${hours(s.freeMinutes)} free`,
  };
}
