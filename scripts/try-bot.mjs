// Drive Buffer's brain from the terminal, no server needed.
//   npx tsx scripts/try-bot.mjs "how's my week" "keep thursday evening free" ...
// With ANTHROPIC_API_KEY set the Claude layer is used; otherwise the rule parser.
const { processTurn, welcomeIfEmpty } = await import("../src/lib/bot.ts");
const { DEFAULT_USER_SETTINGS } = await import("../src/lib/types.ts");

const tz = "Asia/Kolkata";
const now = new Date();
const iso = (d) => d.toLocaleDateString("en-CA", { timeZone: tz });
const today = iso(now);
const tomorrow = iso(new Date(now.getTime() + 86400000));

let user = welcomeIfEmpty({
  id: "u_test",
  name: "Ved",
  nameKey: "ved",
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  lastSeenAt: now.toISOString(),
  settings: { ...DEFAULT_USER_SETTINGS, timezone: tz },
  events: [
    { id: "e1", title: "Studio class", kind: "work", date: today, start: "09:00", durationMinutes: 180, flexible: false, createdAt: now.toISOString() },
    { id: "e2", title: "Team meeting", kind: "work", date: tomorrow, start: "16:00", durationMinutes: 60, flexible: false, createdAt: now.toISOString() },
  ],
  todos: [{ id: "t1", title: "PAR report", priority: "p1", parentId: null, estimatedMinutes: 90, done: false, kind: "work", createdAt: now.toISOString() }],
  messages: [],
  draft: { type: "none", missing: [] },
  remindedEventIds: [],
});

const inputs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["how's my week", "what should i do with my free time", "keep thursday evening free for people", "gym tmrw 7pm for 1h", "lock it", "remind me to renew my passport", "rundown", "thanks!"];

for (const text of inputs) {
  const r = await processTurn(user, text);
  user = r.user;
  console.log(`\n> ${text}   [${user.lastNlp?.intent} · ${user.lastNlp?.notes.filter((n) => n.startsWith("engine")).join("")}]`);
  for (const m of r.replies) {
    console.log(m.text.split("\n").map((l) => "  " + l).join("\n"));
    if (m.card?.type === "schedule") console.log(m.card.lines.map((l) => "    | " + l).join("\n"));
    if (m.buttons?.length) console.log("  [" + m.buttons.map((b) => b.title).join("] [") + "]");
  }
}
