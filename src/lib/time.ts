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
