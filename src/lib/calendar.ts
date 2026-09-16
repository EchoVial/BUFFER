import { CalendarEvent, TodoItem } from "./types";
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
