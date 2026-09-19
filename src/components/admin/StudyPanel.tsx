"use client";

import { useEffect, useState } from "react";
import type { StudyRow } from "@/lib/study";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

type Line = { id: string; role: string; text: string; createdAt: string; intent?: string; tag?: string; buttons?: string[]; picture?: string };

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/** How participants are using Buffer: one row each, a readable transcript on click, CSV of everything. */
export function StudyPanel({ password }: { password: string }) {
  const [rows, setRows] = useState<StudyRow[]>([]);
  const [open, setOpen] = useState<StudyRow | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const headers = { "x-admin-password": password };

  async function load() {
    const res = await fetch("/api/admin?study=1", { headers });
    if (!res.ok) return setError("could not load the study rows");
    setRows(((await res.json()) as { rows: StudyRow[] }).rows);
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

  async function downloadCsv() {
    const res = await fetch("/api/admin?csv=1", { headers });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `buffer-transcripts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const totals = rows.reduce(
    (t, r) => ({ msgs: t.msgs + r.userMessages, nudges: t.nudges + r.nudges, replies: t.replies + r.nudgeReplies, social: t.social + r.socialEvents }),
    { msgs: 0, nudges: 0, replies: 0, social: 0 },
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card className="border-zinc-800 bg-zinc-900">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Participants</CardTitle>
            <CardDescription>
              {rows.length} people · {totals.msgs} messages from them · {totals.nudges} nudges sent, {totals.replies} answered · {totals.social} plans with people
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void load()}>
              Refresh
            </Button>
            <Button onClick={() => void downloadCsv()}>Download CSV</Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Who</TableHead>
                <TableHead>Setup</TableHead>
                <TableHead>Msgs</TableHead>
                <TableHead>Days</TableHead>
                <TableHead>Work / people / reserved</TableHead>
                <TableHead>Nudges</TableHead>
                <TableHead>People</TableHead>
                <TableHead>Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer hover:bg-zinc-800/60" onClick={() => void openRow(r)}>
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-zinc-500">{r.phone ?? "web"}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.setup === "done" ? "secondary" : "outline"}>{r.setup}</Badge>
                    <div className="text-xs text-zinc-500">{r.workHours} · off {r.switchOff}</div>
                  </TableCell>
                  <TableCell>
                    {r.userMessages}
                    <div className="text-xs text-zinc-500">{r.buttonTaps} taps</div>
                  </TableCell>
                  <TableCell>{r.activeDays}</TableCell>
                  <TableCell>
                    {r.workEvents} / <span className="text-violet-300">{r.socialEvents}</span> / {r.reservedEvents}
                  </TableCell>
                  <TableCell>
                    {r.nudges} sent · {r.nudgeReplies} answered · {r.nudgeCalls} calls
                    <div className="text-xs text-zinc-500">
                      nudges {r.notify} · {r.digests} morning pictures
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{r.people.join(", ") || "none"}</TableCell>
                  <TableCell className="text-xs text-zinc-400">{when(r.lastSeen)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-900">
        <CardHeader>
          <CardTitle>{open ? `${open.name}'s chat` : "Pick a participant"}</CardTitle>
          <CardDescription>
            {open
              ? `${open.channel} · calendar: ${open.calendar} · intents: ${Object.entries(open.intents)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => `${k} ${v}`)
                  .join(", ")}`
              : "Every message with what Buffer made of it."}
          </CardDescription>
        </CardHeader>
        <CardContent className="max-h-[70vh] space-y-2 overflow-y-auto text-sm">
          {lines.map((m) => (
            <div key={m.id} className={m.role === "user" ? "ml-10 rounded-lg bg-emerald-900/40 p-2" : "mr-10 rounded-lg bg-zinc-800 p-2"}>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                <span>{when(m.createdAt)}</span>
                {m.intent && <Badge variant="outline">{m.intent}</Badge>}
                {m.tag && <Badge variant="secondary">{m.tag}</Badge>}
                {m.picture && <Badge variant="outline">picture: {m.picture}</Badge>}
              </div>
              <div className="whitespace-pre-wrap">{m.text}</div>
              {m.buttons?.length ? <div className="mt-1 text-xs text-zinc-500">[{m.buttons.join("] [")}]</div> : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
