import { CalendarEvent, TodoItem, UserRecord } from "./types";
import { pad, parseHM } from "./time";

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function stamp(date: string, hm: string): string {
  const [y, mo, d] = date.split("-");
  const { h, m } = parseHM(hm);
  return `${y}${mo}${d}T${pad(h)}${pad(m)}00`;
}

function endStamp(date: string, hm: string, durationMinutes: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const { h, m } = parseHM(hm);
  const start = new Date(y, mo - 1, d, h, m);
  start.setMinutes(start.getMinutes() + durationMinutes);
  return `${start.getFullYear()}${pad(start.getMonth() + 1)}${pad(start.getDate())}T${pad(start.getHours())}${pad(start.getMinutes())}00`;
}

export function googleCalendarUrl(event: CalendarEvent, timeZone: string): string {
  const dates = `${stamp(event.date, event.start)}/${endStamp(event.date, event.start, event.durationMinutes)}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates,
    ctz: timeZone || "UTC",
    details: `Logged from Balance chat · ${event.kind}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function eventToIcs(event: CalendarEvent, timeZone: string): string {
  const tz = timeZone || "UTC";
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Balance//Chat//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.id}@balance.chat`,
    `DTSTAMP:${stamp(event.date, event.start)}`,
    `DTSTART;TZID=${tz}:${stamp(event.date, event.start)}`,
    `DTEND;TZID=${tz}:${endStamp(event.date, event.start, event.durationMinutes)}`,
    `SUMMARY:${icsEscape(event.title)}`,
    `DESCRIPTION:${icsEscape(`Balance · ${event.kind}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

export function todosToIcs(todos: TodoItem[], timeZone: string): string {
  const tz = timeZone || "UTC";
  const items = todos
    .filter((t) => !t.done)
    .map((t) => {
      const due = t.dueDate ? `DUE;VALUE=DATE:${t.dueDate.replace(/-/g, "")}` : null;
      return [
        "BEGIN:VTODO",
        `UID:${t.id}@balance.chat`,
        `SUMMARY:${icsEscape(t.title)}`,
        `PRIORITY:${t.priority === "p0" ? 1 : t.priority === "p1" ? 3 : 5}`,
        due,
        `DESCRIPTION:${icsEscape(`${t.kind} · ${tz}`)}`,
        "END:VTODO",
      ]
        .filter(Boolean)
        .join("\r\n");
    });
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Balance//Chat//EN", ...items, "END:VCALENDAR", ""].join(
    "\r\n",
  );
}

export function downloadIcs(filename: string, ics: string) {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function utcStamp(d = new Date()): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export function userFeedIcs(user: Pick<UserRecord, "name" | "settings" | "events" | "todos">): string {
  const tz = user.settings.timezone || "UTC";
  const dtstamp = utcStamp();
  const vevents = user.events.map((event) =>
    [
      "BEGIN:VEVENT",
      `UID:${event.id}@balance.chat`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;TZID=${tz}:${stamp(event.date, event.start)}`,
      `DTEND;TZID=${tz}:${endStamp(event.date, event.start, event.durationMinutes)}`,
      `SUMMARY:${icsEscape(event.title)}`,
      `DESCRIPTION:${icsEscape(`Balance · ${event.kind}${event.notes ? ` · ${event.notes}` : ""}`)}`,
      `CATEGORIES:${icsEscape(event.kind)}`,
      "END:VEVENT",
    ].join("\r\n"),
  );
  const vtodos = user.todos
    .filter((t) => !t.done)
    .map((t) => {
      const due = t.dueDate ? `DUE;VALUE=DATE:${t.dueDate.replace(/-/g, "")}` : null;
      return [
        "BEGIN:VTODO",
        `UID:${t.id}@balance.chat`,
        `DTSTAMP:${dtstamp}`,
        `SUMMARY:${icsEscape(t.title)}`,
        `PRIORITY:${t.priority === "p0" ? 1 : t.priority === "p1" ? 3 : 5}`,
        due,
        `STATUS:NEEDS-ACTION`,
        `DESCRIPTION:${icsEscape(`${t.kind} · ${tz}`)}`,
        "END:VTODO",
      ]
        .filter(Boolean)
        .join("\r\n");
    });
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Balance//Work Life Chat//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(`Balance — ${user.name}`)}`,
    `X-WR-TIMEZONE:${tz}`,
    "X-WR-CALDESC:Live schedule from Balance chat. Refresh to pick up locked events.",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
    ...vevents,
    ...vtodos,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

export function originFromRequest(req: { headers: Headers; nextUrl?: URL }): string {
  const proto = req.headers.get("x-forwarded-proto");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host) return `${proto || (req.nextUrl?.protocol.replace(":", "") ?? "https")}://${host}`;
  const env =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL;
  if (env) return env.startsWith("http") ? env : `https://${env}`;
  return "http://127.0.0.1:43177";
}

export function icsHttpUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/api/calendar/${encodeURIComponent(token)}`;
}

export function icsWebcalUrl(origin: string, token: string): string {
  return icsHttpUrl(origin, token).replace(/^https?:/i, "webcal:");
}

export function googleSubscribeUrl(origin: string, token: string): string {
  return `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(icsWebcalUrl(origin, token))}`;
}

export function outlookSubscribeUrl(origin: string, token: string, calendarName: string): string {
  const url = icsHttpUrl(origin, token);
  return `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=${encodeURIComponent(calendarName)}`;
}

export type CalendarPlatform = "ios" | "mac" | "android" | "windows" | "other";

export function detectCalendarPlatform(ua = ""): CalendarPlatform {
  const s = ua.toLowerCase();
  if (/iphone|ipad|ipod/.test(s)) return "ios";
  if (/macintosh|mac os x/.test(s) && !/mobile/.test(s)) return "mac";
  if (/android/.test(s)) return "android";
  if (/windows/.test(s)) return "windows";
  return "other";
}

export function platformLabel(platform: CalendarPlatform): string {
  switch (platform) {
    case "ios":
      return "iPhone / iPad";
    case "mac":
      return "Mac";
    case "android":
      return "Android";
    case "windows":
      return "Windows";
    default:
      return "this device";
  }
}
