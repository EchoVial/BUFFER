import { dateISO, nowInZone, addDaysISO } from "./time";

export function formatMessageDay(iso: string, tz: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const today = dateISO(nowInZone(tz));
  if (parts === today) return "TODAY";
  if (parts === addDaysISO(today, -1)) return "YESTERDAY";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "short",
    day: "numeric",
  })
    .format(d)
    .toUpperCase();
}
