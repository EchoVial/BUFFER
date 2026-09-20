"use client";

import { useEffect, useState } from "react";
import type { StudyDay, StudyRow } from "@/lib/study";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

type Line = { id: string; role: string; text: string; createdAt: string; intent?: string; tag?: string; buttons?: string[]; picture?: string };
type Intent = { intent: string; count: number };

const ACCENT = "#8B84E8";
const ACCENT_DIM = "#3a3766";
const GRID = "#27272a";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const INTENT_WORDS: Record<string, string> = {
  fast: "button or command",
  setup: "setup answer",
  add_event: "add a plan",
  add_work: "mark work",
  set_pref: "change hours or settings",
  week: "see the week",
  schedule: "see a day",
  plan_free: "plan people time",
  protect: "reserve time",
  question: "ask Buffer something",
  chitchat: "chat",
  greet: "hello",
  day_off: "a day off",
  calendar: "calendar",
  add_todo: "add a to-do",
  edit_item: "change a plan",
  complete_todo: "finish a to-do",
  unknown: "not understood",
};

/** A single number with its label: the dashboard's atoms. */
function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-zinc-500">{sub}</div> : null}
    </div>
  );
}

/** Messages from participants per day: one series, thin columns, hover for the rest. */
function DailyChart({ days }: { days: StudyDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 180;
  const padL = 32;
  const padB = 26;
  const padT = 14;
  const max = Math.max(4, ...days.map((d) => d.userMessages));
  const tick = max <= 8 ? 2 : max <= 20 ? 5 : max <= 50 ? 10 : 25;
  const top = Math.ceil(max / tick) * tick;
  const slot = (W - padL) / days.length;
  const bw = Math.min(24, slot - 6);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  const peak = days.reduce((best, d, i) => (d.userMessages > days[best].userMessages ? i : best), 0);
  const h = hover !== null ? days[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Participant messages per day">
        {Array.from({ length: top / tick + 1 }, (_, i) => i * tick).map((v) => (
          <g key={v}>
            <line x1={padL} x2={W} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth="1" />
            <text x={padL - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#71717a">
              {v}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = padL + i * slot + (slot - bw) / 2;
          const hgt = Math.max(0, y(0) - y(d.userMessages));
          const isHover = hover === i;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + i * slot} y={padT} width={slot} height={H - padT - padB} fill="transparent" />
              {d.userMessages > 0 ? (
                <path
                  d={`M${x},${y(0)} v${-(hgt - 4)} a4,4 0 0 1 4,-4 h${bw - 8} a4,4 0 0 1 4,4 v${hgt - 4} z`}
                  fill={isHover || i === peak ? ACCENT : ACCENT_DIM}
                />
              ) : null}
              {i === peak && d.userMessages > 0 ? (
                <text x={x + bw / 2} y={y(d.userMessages) - 5} textAnchor="middle" fontSize="10" fill="#d4d4d8">
                  {d.userMessages}
                </text>
              ) : null}
              <text x={padL + i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize="10" fill={i === days.length - 1 ? "#d4d4d8" : "#71717a"}>
                {i % 2 === days.length % 2 ? dayLabel(d.date).split(" ")[0] : ""}
              </text>
            </g>
          );
        })}
      </svg>
      {h ? (
        <div className="pointer-events-none absolute right-2 top-0 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 shadow">
          <div className="font-medium">{dayLabel(h.date)}</div>
          <div>{h.userMessages} messages from {h.activePeople} {h.activePeople === 1 ? "person" : "people"}</div>
          <div className="text-zinc-400">
            {h.botMessages} from Buffer · {h.nudges} nudges, {h.nudgeReplies} answered
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** What people asked for, most to least: horizontal bars, value at the tip. */
function IntentBars({ intents }: { intents: Intent[] }) {
  const top = intents.slice(0, 8);
  const max = Math.max(1, ...top.map((i) => i.count));
  return (
    <div className="space-y-2">
      {top.map((i) => (
        <div key={i.intent} className="grid grid-cols-[150px_1fr_36px] items-center gap-3 text-xs">
          <div className="truncate text-zinc-300" title={i.intent}>
            {INTENT_WORDS[i.intent] ?? i.intent}
          </div>
          <div className="h-3 rounded-r-[4px] bg-zinc-800">
            <div className="h-3 rounded-r-[4px]" style={{ width: `${Math.max(2, (i.count / max) * 100)}%`, background: ACCENT }} />
          </div>
          <div className="tabular-nums text-zinc-400">{i.count}</div>
        </div>
      ))}
      {!top.length ? <div className="text-xs text-zinc-500">nothing yet</div> : null}
    </div>
  );
}

/** How participants are using Buffer: numbers, a fortnight of activity, one row each, transcripts, CSV. */
export function StudyPanel({ password }: { password: string }) {
  const [rows, setRows] = useState<StudyRow[]>([]);
  const [hidden, setHidden] = useState<StudyRow[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [daily, setDaily] = useState<StudyDay[]>([]);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [open, setOpen] = useState<StudyRow | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [activeCount, setActiveCount] = useState(0);
  const [nudgeReport, setNudgeReport] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sendState, setSendState] = useState<string | null>(null);
  const headers = { "x-admin-password": password };

  async function load() {
    const res = await fetch("/api/admin?study=1", { headers });
    if (!res.ok) return setError("could not load the study data");
    const data = (await res.json()) as { rows: StudyRow[]; hidden: StudyRow[]; daily: StudyDay[]; intents: Intent[] };
    setRows(data.rows);
    setHidden(data.hidden);
    setDaily(data.daily);
    setIntents(data.intents);
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    setActiveCount(data.rows.filter((r) => new Date(r.lastSeen).getTime() > dayAgo).length);
  }
  useEffect(() => {
    // Same shape as the dashboard: load after the first paint, not inside the effect body.
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  async function openRow(r: StudyRow) {
    setOpen(r);
    const res = await fetch(`/api/admin?userId=${r.id}&transcript=1`, { headers });
    if (res.ok) setLines(((await res.json()) as { messages: Line[] }).messages);
  }

  async function setHiddenFor(r: StudyRow, value: boolean) {
    await fetch("/api/admin", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ action: "study-hide", userId: r.id, hidden: value }) });
    if (open?.id === r.id) setOpen(null);
    await load();
  }

  async function nudgeSetup() {
    const unfinished = rows.filter((r) => r.setup !== "done");
    if (!unfinished.length) return setNudgeReport("everyone has finished setup.");
    if (!window.confirm(`send ${unfinished.length} ${unfinished.length === 1 ? "person" : "people"} their open setup question on WhatsApp?`)) return;
    setNudgeReport("sending...");
    const res = await fetch("/api/admin", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ action: "nudge-setup" }) });
    const data = (await res.json()) as { results?: Array<{ name: string; how: string }>; error?: string };
    setNudgeReport(data.error ?? (data.results ?? []).map((r) => `${r.name}: ${r.how}`).join(" · "));
    await load();
  }

  async function sendMessage() {
    if (!open || !draft.trim()) return;
    if (!window.confirm(`send this to ${open.name} on WhatsApp, as Buffer?\n\n${draft.trim()}`)) return;
    setSendState("sending...");
    const res = await fetch("/api/admin", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ action: "send-message", userId: open.id, text: draft.trim() }) });
    const data = (await res.json()) as { error?: string };
    if (data.error) return setSendState(data.error);
    setSendState("sent");
    setDraft("");
    await openRow(open);
  }

  async function downloadCsv() {
    const res = await fetch("/api/admin?csv=1", { headers });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `buffer-transcripts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const t = rows.reduce(
    (acc, r) => ({
      msgs: acc.msgs + r.userMessages,
      nudges: acc.nudges + r.nudges,
      replies: acc.replies + r.nudgeReplies,
      calls: acc.calls + r.nudgeCalls,
      social: acc.social + r.socialEvents,
      reserved: acc.reserved + r.reservedEvents,
      setup: acc.setup + (r.setup === "done" ? 1 : 0),
    }),
    { msgs: 0, nudges: 0, replies: 0, calls: 0, social: 0, reserved: 0, setup: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs text-zinc-400">messages from participants</div>
          <div className="text-5xl font-semibold tabular-nums text-zinc-100">{t.msgs}</div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800" onClick={() => void load()}>
            Refresh
          </Button>
          <Button variant="outline" className="border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800" onClick={() => void nudgeSetup()}>
            Nudge unfinished setups
          </Button>
          <Button onClick={() => void downloadCsv()}>Download CSV</Button>
        </div>
      </div>
      {nudgeReport && <p className="text-sm text-zinc-300">{nudgeReport}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="participants" value={rows.length} sub={`${t.setup} finished setup`} />
        <Stat label="active in last 24h" value={activeCount} />
        <Stat label="nudges sent" value={t.nudges} />
        <Stat label="nudges answered" value={t.replies} sub={t.nudges ? `${Math.round((t.replies / t.nudges) * 100)}% of sent` : undefined} />
        <Stat label="calls from a nudge" value={t.calls} />
        <Stat label="plans with people" value={t.social} sub={`${t.reserved} reserved blocks`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle className="text-zinc-100">Messages per day</CardTitle>
              <CardDescription className="text-zinc-400">from participants, last 14 days. hover a day for the rest.</CardDescription>
            </div>
            <Button variant="outline" size="sm" className="border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800" onClick={() => setShowTable((v) => !v)}>
              {showTable ? "Chart" : "Table"}
            </Button>
          </CardHeader>
          <CardContent>
            {showTable ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-zinc-400">Day</TableHead>
                    <TableHead className="text-zinc-400">From people</TableHead>
                    <TableHead className="text-zinc-400">From Buffer</TableHead>
                    <TableHead className="text-zinc-400">Nudges</TableHead>
                    <TableHead className="text-zinc-400">Answered</TableHead>
                    <TableHead className="text-zinc-400">People active</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {daily.map((d) => (
                    <TableRow key={d.date}>
                      <TableCell className="text-zinc-200">{dayLabel(d.date)}</TableCell>
                      <TableCell className="text-zinc-200">{d.userMessages}</TableCell>
                      <TableCell className="text-zinc-200">{d.botMessages}</TableCell>
                      <TableCell className="text-zinc-200">{d.nudges}</TableCell>
                      <TableCell className="text-zinc-200">{d.nudgeReplies}</TableCell>
                      <TableCell className="text-zinc-200">{d.activePeople}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <DailyChart days={daily} />
            )}
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader>
            <CardTitle className="text-zinc-100">What they ask for</CardTitle>
            <CardDescription className="text-zinc-400">what Buffer made of each message, all participants.</CardDescription>
          </CardHeader>
          <CardContent>
            <IntentBars intents={intents} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader>
            <CardTitle className="text-zinc-100">Participants</CardTitle>
            <CardDescription className="text-zinc-400">
              whatsapp only. click a row for the whole conversation; Hide keeps researchers and test accounts out of every number here.
              {hidden.length ? (
                <button className="ml-2 underline" onClick={() => setShowHidden((v) => !v)}>
                  {showHidden ? "hide the hidden" : `show ${hidden.length} hidden`}
                </button>
              ) : null}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-zinc-400">Who</TableHead>
                  <TableHead className="text-zinc-400">Setup</TableHead>
                  <TableHead className="text-zinc-400">Msgs</TableHead>
                  <TableHead className="text-zinc-400">Days</TableHead>
                  <TableHead className="text-zinc-400">Work / people / reserved</TableHead>
                  <TableHead className="text-zinc-400">Nudges</TableHead>
                  <TableHead className="text-zinc-400">People</TableHead>
                  <TableHead className="text-zinc-400">Last seen</TableHead>
                  <TableHead className="text-zinc-400"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...rows, ...(showHidden ? hidden : [])].map((r) => (
                  <TableRow key={r.id} className={`cursor-pointer hover:bg-zinc-800/60 ${open?.id === r.id ? "bg-zinc-800/60" : ""} ${r.hidden ? "opacity-50" : ""}`} onClick={() => void openRow(r)}>
                    <TableCell className="text-zinc-200">
                      <div className="font-medium text-zinc-100">{r.name}</div>
                      <div className="text-xs text-zinc-500">{r.phone ?? "web"}</div>
                    </TableCell>
                    <TableCell className="text-zinc-200">
                      <Badge variant="outline" className={r.setup === "done" ? "border-zinc-600 bg-zinc-800 text-zinc-100" : "border-amber-700 bg-transparent text-amber-300"}>{r.setup}</Badge>
                      <div className="text-xs text-zinc-500">
                        {r.workHours} · off {r.switchOff}
                      </div>
                    </TableCell>
                    <TableCell className="text-zinc-200">
                      {r.userMessages}
                      <div className="text-xs text-zinc-500">{r.buttonTaps} taps</div>
                    </TableCell>
                    <TableCell className="text-zinc-200">{r.activeDays}</TableCell>
                    <TableCell className="text-zinc-200">
                      {r.workEvents} / <span style={{ color: ACCENT }}>{r.socialEvents}</span> / {r.reservedEvents}
                    </TableCell>
                    <TableCell className="text-zinc-200">
                      {r.nudges} sent · {r.nudgeReplies} answered · {r.nudgeCalls} calls
                      <div className="text-xs text-zinc-500">
                        nudges {r.notify} · {r.digests} morning pictures · calendar {r.calendar}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-zinc-200">{r.people.join(", ") || "none"}</TableCell>
                    <TableCell className="text-xs text-zinc-400">{when(r.lastSeen)}</TableCell>
                    <TableCell className="text-xs text-zinc-200">
                      <button
                        className="text-zinc-400 underline hover:text-zinc-200"
                        onClick={(e) => {
                          e.stopPropagation();
                          void setHiddenFor(r, !r.hidden);
                        }}
                      >
                        {r.hidden ? "Show" : "Hide"}
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader>
            <CardTitle className="text-zinc-100">{open ? `${open.name}'s chat` : "Pick a participant"}</CardTitle>
            <CardDescription className="text-zinc-400">
              {open
                ? `${open.channel} · ${Object.entries(open.intents)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([k, v]) => `${INTENT_WORDS[k] ?? k} ${v}`)
                    .join(" · ")}`
                : "every message with what Buffer made of it."}
            </CardDescription>
          </CardHeader>
          <CardContent className="max-h-[70vh] space-y-2 overflow-y-auto text-sm">
            {open ? (
              <div className="mb-3 rounded-lg border border-zinc-700 p-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={`a message to ${open.name}, sent as Buffer`}
                  rows={2}
                  className="w-full resize-none bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
                />
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs text-zinc-500">{sendState ?? "lands in their chat and in this transcript, tagged nudge"}</span>
                  <Button size="sm" onClick={() => void sendMessage()} disabled={!draft.trim()}>
                    Send
                  </Button>
                </div>
              </div>
            ) : null}
            {lines.map((m) => (
              <div key={m.id} className={m.role === "user" ? "ml-10 rounded-lg bg-emerald-900/40 p-2" : "mr-10 rounded-lg bg-zinc-800 p-2"}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                  <span>{when(m.createdAt)}</span>
                  {m.intent && <Badge variant="outline" className="border-zinc-600 bg-transparent text-zinc-200">{INTENT_WORDS[m.intent] ?? m.intent}</Badge>}
                  {m.tag && <Badge variant="outline" className="border-violet-500 bg-violet-950 text-violet-200">{m.tag}</Badge>}
                  {m.picture && <Badge variant="outline" className="border-zinc-600 bg-transparent text-zinc-200">picture: {m.picture}</Badge>}
                </div>
                <div className="whitespace-pre-wrap text-zinc-100">{m.text}</div>
                {m.buttons?.length ? <div className="mt-1 text-xs text-zinc-500">[{m.buttons.join("] [")}]</div> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
