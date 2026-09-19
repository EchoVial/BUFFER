const DAY_MS = 24 * 60 * 60 * 1000;

export function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export function dateISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nowInZone(timeZone: string): Date {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return new Date(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
}

export function parseHM(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(":").map((x) => Number(x));
  return { h: h || 0, m: m || 0 };
}

export function hmToMinutes(hm: string): number {
  const { h, m } = parseHM(hm);
  return h * 60 + m;
}

export function minutesToHM(mins: number): string {
  const n = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
}

export function formatClock(hm: string): string {
  const { h, m } = parseHM(hm);
  const suffix = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return m === 0 ? `${hr} ${suffix}` : `${hr}:${pad(m)} ${suffix}`;
}

/** "7 pm", "7:30 am": the way people write times in a chat. */
export function shortClock(hm: string): string {
  const { h, m } = parseHM(hm);
  const suffix = h >= 12 ? "pm" : "am";
  const hr = h % 12 || 12;
  return m === 0 ? `${hr} ${suffix}` : `${hr}:${pad(m)} ${suffix}`;
}

export function addDaysISO(iso: string, days: number): string {
  const [y, mo, d] = iso.split("-").map(Number);
  const dt = new Date(y, mo - 1, d);
  dt.setTime(dt.getTime() + days * DAY_MS);
  return dateISO(dt);
}

export function weekdayIndex(iso: string): number {
  const [y, mo, d] = iso.split("-").map(Number);
  return new Date(y, mo - 1, d).getDay();
}

export function prettyDate(iso: string): string {
  const [y, mo, d] = iso.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function isWeekend(iso: string): boolean {
  const i = weekdayIndex(iso);
  return i === 0 || i === 6;
}

export function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function durationLabel(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export const WEEKDAYS = [1, 2, 3, 4, 5];
const DAY_SHORT = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Does the standing block fall on this date? Monday to Friday unless the person said otherwise. */
export function isStandingDay(days: number[] | undefined, iso: string): boolean {
  return (days ?? WEEKDAYS).includes(weekdayIndex(iso));
}

/** "every weekday", "mon to thu", "mon, wed and fri". */
export function describeDays(days: number[] | undefined): string {
  const d = [...new Set(days ?? WEEKDAYS)].sort((a, b) => a - b);
  if (d.length === 5 && d.every((x, i) => x === i + 1)) return "every weekday";
  if (d.length === 7) return "every day";
  if (!d.length) return "no days";
  const contiguous = d.length >= 3 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  if (contiguous) return `${DAY_SHORT[d[0]]} to ${DAY_SHORT[d[d.length - 1]]}`;
  const names = d.map((x) => DAY_SHORT[x]);
  return names.length === 1 ? `${names[0]}s` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Day numbers named in a phrase: "fridays" -> [5], "mon and wed" -> [1, 3], "mon to thu" -> [1, 2, 3, 4]. */
export function dayNumbersIn(text: string): number[] {
  const t = text.toLowerCase();
  const idx = (w: string) => DAY_SHORT.indexOf(w.slice(0, 3));
  const span = t.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s*(?:to|-|through|thru|till|until)\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
  if (span) {
    const a = idx(span[1]);
    const b = idx(span[2]);
    const out: number[] = [];
    for (let i = a; ; i = (i + 1) % 7) {
      out.push(i);
      if (i === b || out.length > 7) break;
    }
    return out;
  }
  const out = new Set<number>();
  for (const m of t.matchAll(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/g)) out.add(idx(m[1]));
  return [...out].sort((a, b) => a - b);
}
