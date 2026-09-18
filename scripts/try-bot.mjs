// Drive Buffer's brain from the terminal, no server needed.
//   npx tsx scripts/try-bot.mjs "how's my week" "keep thursday evening free" ...
// With ANTHROPIC_API_KEY set the Claude layer is used; otherwise the rule parser.
const { processTurn, welcomeIfEmpty } = await import("../src/lib/bot.ts");
const { setUnderstandingEngine } = await import("../src/lib/understand.ts");
// BUFFER_FAKE_LLM=path.json: a map of message -> Understanding (and "setup:<step>:<message>" -> SetupUnderstanding)
// to exercise the Claude branches without a key.
if (process.env.BUFFER_FAKE_LLM) {
  const { readFileSync } = await import("node:fs");
  const fixtures = JSON.parse(readFileSync(process.env.BUFFER_FAKE_LLM, "utf8"));
  setUnderstandingEngine(async (raw) => fixtures[raw] ?? null, async (step, raw) => fixtures[`setup:${step}:${raw}`] ?? null);
}
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
  : ["i usually work 9 to 6", "7pm", "mum, dad", "i have work from 7pm - 10 pm today, mark it", "today", "my week", "dinner with sam friday 8pm", "remind me to renew my passport", "undo", "thanks!"];

for (const text of inputs) {
  const r = await processTurn(user, text);
  user = r.user;
  console.log(`\n> ${text}   [${user.lastNlp?.intent} · ${user.lastNlp?.notes.filter((n) => n.startsWith("engine")).join("")}]`);
  for (const m of r.replies) {
    console.log(m.text.split("\n").map((l) => "  " + l).join("\n"));
    if (m.card?.type === "schedule") console.log(m.card.lines.map((l) => "    | " + l).join("\n"));
    if (m.card?.type === "image") console.log(`    [picture: ${m.card.variant} · ${m.card.title} · ${m.card.subtitle}${m.card.variant === "day" ? " · " + m.card.blocks.filter((b) => b.kind !== "free").map((b) => `${b.title} ${b.startMin}-${b.endMin}`).join(", ") : ""}]`);
    if (m.card?.type === "todos") console.log(m.card.lines.map((l) => "    | " + l).join("\n"));
    if (m.buttons?.length) console.log("  [" + m.buttons.map((b) => b.title).join("] [") + "]");
  }
}
