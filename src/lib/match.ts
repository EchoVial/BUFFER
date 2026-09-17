import { CalendarEvent, TodoItem, UserRecord } from "./types";

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function score(title: string, hint: string): number {
  const t = norm(title);
  const h = norm(hint);
  if (!t || !h || h.length < 2) return 0;
  if (t === h) return 120;
  if (t.includes(h) && h.length >= 3) return 90 + Math.min(h.length, 20);
  if (h.includes(t) && t.length >= 3) return 80 + Math.min(t.length, 20);
  const tWords = new Set(t.split(" ").filter((w) => w.length > 2));
  const hWords = h.split(" ").filter((w) => w.length > 2);
  if (!hWords.length) return 0;
  const hits = hWords.filter((w) => tWords.has(w) || t.includes(w)).length;
  if (!hits) return 0;
  return 40 + hits * 15;
}

export type NamedHit =
  | { kind: "event"; event: CalendarEvent; todo?: undefined; score: number }
  | { kind: "todo"; todo: TodoItem; event?: undefined; score: number };

export function findNamedItem(user: UserRecord, hint: string): NamedHit | undefined {
  const h = hint.trim();
  if (h.length < 2) return undefined;
  const ranked: NamedHit[] = [];
  for (const event of user.events) {
    const s = score(event.title, h);
    if (s >= 55) ranked.push({ kind: "event", event, score: s });
  }
  for (const todo of user.todos) {
    const s = score(todo.title, h);
    if (s >= 55) ranked.push({ kind: "todo", todo, score: s });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0];
}

export function hintFromText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(
      /\b(please|can you|could you|star|unstar|favourite|favorite|prioritize|pin|unpin|change|move|rename|update|reschedule|shift|push|delay|make|switch|set|call|the|this|event|todo|to-do|task|work)\b/g,
      " ",
    )
    .replace(/\b(to|at|on|for|from|until)\b/g, " ")
    .replace(/\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g, " ")
    .replace(/\b\d{1,2}(?::\d{2})?\s*(am|pm)?\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(hours|hour|minutes|minute|hrs|hr|h|m)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
