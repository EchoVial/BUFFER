"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { AppSettings, NlpDebug, UserSettings } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { StudyPanel } from "@/components/admin/StudyPanel";

type UserRow = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  messages: number;
  events: number;
  todos: number;
  lastNlp?: NlpDebug;
  notes?: string;
  settings: UserSettings;
};

export function AdminDashboard() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [hint, setHint] = useState("");
  const [newName, setNewName] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(pw: string) {
    const res = await fetch("/api/admin", { headers: { "x-admin-password": pw } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "auth failed");
    setUsers(data.users);
    setSettings(data.settings);
    setHint(data.env?.persistHint || "");
    setPassword(pw);
    setAuthed(true);
    sessionStorage.setItem("balance.admin", pw);
  }

  useEffect(() => {
    const saved = sessionStorage.getItem("balance.admin");
    if (!saved) return;
    const t = window.setTimeout(() => {
      load(saved).catch(() => sessionStorage.removeItem("balance.admin"));
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await load(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": password,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      await load(password);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function openUser(id: string) {
    setSelected(id);
    const res = await fetch(`/api/admin?userId=${id}`, {
      headers: { "x-admin-password": password },
    });
    const data = await res.json();
    setDetail(data.user);
  }

  if (!authed) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-zinc-950 p-4 text-zinc-100">
        <Card className="w-full max-w-md border-zinc-800 bg-zinc-900">
          <CardHeader>
            <CardTitle>Buffer admin</CardTitle>
            <CardDescription>
              Debug users, chats, and default life-balance parameters.
              Local password is <code>balance123</code>. On Vercel, use the{" "}
              <code>ADMIN_PASSWORD</code> you set in Project → Settings → Environment
              Variables.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pw">Password</Label>
                <Input
                  id="pw"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <Button type="submit" className="w-full">
                Enter
              </Button>
              <Link href="/" className="block text-center text-sm text-zinc-400">
                ← back to chat
              </Link>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div>
          <p className="text-sm text-zinc-400">Buffer console</p>
          <h1 className="text-lg font-semibold">Users, parameters, NLP debug</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" render={<Link href="/" />}>
            Open chat
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              sessionStorage.removeItem("balance.admin");
              setAuthed(false);
            }}
          >
            Lock
          </Button>
        </div>
      </header>
      <p className="border-b border-zinc-800 px-4 py-2 text-xs text-zinc-500">{hint}</p>
      {error && <p className="px-4 py-2 text-sm text-red-400">{error}</p>}

      <Tabs defaultValue="study" className="p-4">
        <TabsList>
          <TabsTrigger value="study">Study</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="settings">Parameters</TabsTrigger>
          <TabsTrigger value="debug">Last NLP</TabsTrigger>
        </TabsList>

        <TabsContent value="study" className="mt-4">
          <StudyPanel password={password} />
        </TabsContent>

        <TabsContent value="users" className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <Card className="border-zinc-800 bg-zinc-900">
            <CardHeader>
              <CardTitle>Directory</CardTitle>
              <CardDescription>
                Create a person first, or let them auto-join by typing their name in chat
                (toggle below).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act({
                    action: "create-user",
                    name: newName,
                    notes: newNotes,
                  }).then(() => {
                    setNewName("");
                    setNewNotes("");
                  });
                }}
              >
                <Input
                  placeholder="Name (must match what they type)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                />
                <Input
                  placeholder="Internal note"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                />
                <Button type="submit" disabled={busy}>
                  Create
                </Button>
              </form>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Chat</TableHead>
                    <TableHead>Life</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id} className="cursor-pointer" onClick={() => void openUser(u.id)}>
                      <TableCell>
                        <p className="font-medium">{u.name}</p>
                        <p className="text-xs text-zinc-500">
                          seen {new Date(u.lastSeenAt).toLocaleString()}
                        </p>
                      </TableCell>
                      <TableCell>{u.messages} msgs</TableCell>
                      <TableCell>
                        {u.events} events · {u.todos} todos
                      </TableCell>
                      <TableCell className="space-x-1">
                        <Button size="sm" variant="secondary" onClick={() => void openUser(u.id)}>
                          Inspect
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            void act({ action: "reset-user", userId: u.id });
                          }}
                        >
                          Reset
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            void act({ action: "delete-user", userId: u.id });
                          }}
                        >
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!users.length && (
                <p className="text-sm text-zinc-500">No users yet. Create one or open the chat.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900">
            <CardHeader>
              <CardTitle>{selected ? "User payload" : "Pick a user"}</CardTitle>
              <CardDescription>Full chat + calendar JSON for debugging.</CardDescription>
            </CardHeader>
            <CardContent>
              {detail ? (
                <pre className="max-h-[70vh] overflow-auto rounded bg-black/40 p-3 text-[11px] leading-4 text-emerald-200">
                  {JSON.stringify(detail, null, 2)}
                </pre>
              ) : (
                <p className="text-sm text-zinc-500">Inspect a row to dump their WhatsApp-style thread.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          {settings && (
            <Card className="border-zinc-800 bg-zinc-900">
              <CardHeader>
                <CardTitle>Global defaults</CardTitle>
                <CardDescription>
                  New users inherit these. People can still override in chat (“i want 2 hrs of
                  social every day”).
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Bot display name"
                  value={settings.botDisplayName}
                  onChange={(v) => setSettings({ ...settings, botDisplayName: v })}
                />
                <div className="sm:col-span-2 space-y-2">
                  <Label>About</Label>
                  <Textarea
                    value={settings.botAbout}
                    onChange={(e) => setSettings({ ...settings, botAbout: e.target.value })}
                  />
                </div>
                {(
                  [
                    ["wakeTime", "Wake"],
                    ["sleepTime", "Sleep"],
                    ["workStart", "Work start"],
                    ["workEnd", "Work end"],
                    ["protectEveningsAfter", "Protect evenings after"],
                    ["noWorkAfter", "No work after"],
                  ] as const
                ).map(([key, label]) => (
                  <Field
                    key={key}
                    label={label}
                    value={String(settings.defaultUserSettings[key] ?? "")}
                    onChange={(v) =>
                      setSettings({
                        ...settings,
                        defaultUserSettings: {
                          ...settings.defaultUserSettings,
                          [key]: v || null,
                        },
                      })
                    }
                  />
                ))}
                <Field
                  label="Social minutes / day"
                  type="number"
                  value={String(settings.defaultUserSettings.socialMinutesPerDay)}
                  onChange={(v) =>
                    setSettings({
                      ...settings,
                      defaultUserSettings: {
                        ...settings.defaultUserSettings,
                        socialMinutesPerDay: Number(v),
                      },
                    })
                  }
                />
                <Field
                  label="Max work minutes / day"
                  type="number"
                  value={String(settings.defaultUserSettings.maxWorkMinutesPerDay)}
                  onChange={(v) =>
                    setSettings({
                      ...settings,
                      defaultUserSettings: {
                        ...settings.defaultUserSettings,
                        maxWorkMinutesPerDay: Number(v),
                      },
                    })
                  }
                />
                <Field
                  label="Reminder lead (min)"
                  type="number"
                  value={String(settings.defaultUserSettings.reminderLeadMinutes)}
                  onChange={(v) =>
                    setSettings({
                      ...settings,
                      defaultUserSettings: {
                        ...settings.defaultUserSettings,
                        reminderLeadMinutes: Number(v),
                      },
                    })
                  }
                />
                <div className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2">
                  <Label>Auto-create users from chat names</Label>
                  <Switch
                    checked={settings.allowAutoCreateUsers}
                    onCheckedChange={(v) =>
                      setSettings({ ...settings, allowAutoCreateUsers: v })
                    }
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2">
                  <Label>Show NLP debug cards in chat</Label>
                  <Switch
                    checked={settings.debugNlpInChat}
                    onCheckedChange={(v) =>
                      setSettings({ ...settings, debugNlpInChat: v })
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void act({
                        action: "patch-settings",
                        appSettings: {
                          botDisplayName: settings.botDisplayName,
                          botAbout: settings.botAbout,
                          debugNlpInChat: settings.debugNlpInChat,
                          allowAutoCreateUsers: settings.allowAutoCreateUsers,
                        },
                        defaultUserSettings: settings.defaultUserSettings,
                      })
                    }
                  >
                    Save parameters
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="debug" className="mt-4 grid gap-3">
          {users.map((u) => (
            <Card key={u.id} className="border-zinc-800 bg-zinc-900">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{u.name}</CardTitle>
                <CardDescription>
                  {u.lastNlp ? (
                    <Badge variant="secondary">{u.lastNlp.intent}</Badge>
                  ) : (
                    "no parse yet"
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {u.lastNlp ? (
                  <pre className="overflow-auto text-[11px] text-emerald-200">
                    {JSON.stringify(u.lastNlp, null, 2)}
                  </pre>
                ) : (
                  <p className="text-sm text-zinc-500">They haven&apos;t texted yet.</p>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
