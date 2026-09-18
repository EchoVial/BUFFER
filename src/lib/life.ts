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
    // Free time is what is left outside standing work hours on weekdays; weekends count whole.
    // A day that already has a work block on it uses the block, not the standing hours.
    const weekend = isWeekendISO(date);
    const standing = standingWork(user.settings);
    const hasWorkBlock = user.events.some((e) => e.date === date && e.kind === "work");
    const cut = !weekend && standing && !hasWorkBlock ? standing : null;
    const windows: FreeWindow[] = plan.blocks
      .filter((b) => b.kind === "free")
      .filter((b) => (i === 0 ? b.endMin > minutesNow + 15 : true))
      .flatMap((b) => {
        const start = i === 0 ? Math.max(b.startMin, Math.ceil(minutesNow / 15) * 15) : b.startMin;
        const parts: Array<[number, number]> = cut ? [[start, Math.min(b.endMin, cut.start)], [Math.max(start, cut.end), b.endMin]] : [[start, b.endMin]];
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
    const workMinutes = cut ? Math.max(plan.stats.workMinutes, cut.end - cut.start) : plan.stats.workMinutes;
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

/** "Fri evening", "Sat afternoon", "Sun morning": for button labels. */
export function slotName(w: FreeWindow): string {
  const h = Math.floor(w.startMin / 60);
  const part = h >= 17 ? "evening" : h >= 12 ? "afternoon" : "morning";
  return `${weekdayShort(w.date)} ${part}`;
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
  const people = user.people?.length ? user.people : friend ? [friend] : [];
  const cap = (n: string) => n.charAt(0).toUpperCase() + n.slice(1);
  pool.push({
    title: people[0] ? `Call ${cap(people[0])}` : "Dinner or a call with a friend",
    kind: "social",
    minutes: 45,
    why: socialGap ? "you have not had much people time this week" : "keeps the week from being only work",
    prefer: ["evening", "weekend"],
  });
  if (people[1]) {
    pool.push({ title: `Call ${cap(people[1])}`, kind: "social", minutes: 30, why: "a short one counts", prefer: ["evening", "weekend", "day"] });
  }
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
  if (!people.length) {
    pool.push({
      title: "Call home",
      kind: "social",
      minutes: 30,
      why: "a call home counts",
      prefer: ["weekend", "evening"],
    });
  }

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
  return `plan ${s.title.toLowerCase()} ${dayWord(s.window.date, tz)} at ${shortClock(minutesToHM(s.window.startMin))} for ${s.durationMinutes} minutes, ${s.kind}`;
}

export function protectPayload(w: FreeWindow, tz: string, forWhom: "people" | "me"): string {
  return `protect ${dayWord(w.date, tz)} at ${shortClock(minutesToHM(w.startMin))} for ${Math.min(120, w.endMin - w.startMin)} minutes for ${forWhom}`;
}

/** A held window: a real event so work cannot be scheduled over it. */
export function protectedEvent(date: string, start: string, durationMinutes: number, kind: EventKind, label?: string): Omit<CalendarEvent, "id" | "createdAt"> {
  return {
    title: label ?? (kind === "social" ? "Kept for people" : "Kept for you"),
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
    subtitle: freeSummary(view),
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
