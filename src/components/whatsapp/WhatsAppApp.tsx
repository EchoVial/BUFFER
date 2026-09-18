"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Mic,
  MoreVertical,
  Phone,
  Plus,
  Search,
  Send,
  Smile,
  Video,
  X,
} from "lucide-react";
import { AppSettings, ChatMessage, ReplyButton, UserRecord } from "@/lib/types";
import { formatMessageTime } from "@/lib/time";
import { formatMessageDay } from "@/lib/day-label";
import { downloadIcs, eventToIcs, googleCalendarUrl, outlookEventUrl } from "@/lib/calendar";
import { CalendarConnect } from "@/components/calendar/CalendarConnect";
import { MessageCards } from "./cards";
import { WhatsAppText } from "./wa-text";
import { ListTrigger, ReplyButtons, WhatsAppListSheet } from "./interactive";
import { ThemeSheet } from "./theme-sheet";
import { useAppearance } from "@/lib/theme";
import { cn } from "@/lib/utils";

const LS = "balance.user.cache";
const EMOJIS = ["😀", "😂", "❤️", "🔥", "✨", "🙏", "✅", "📅", "😅", "💪", "☕", "🌙"];

type Tab = "chats" | "status" | "calls";

export function WhatsAppApp() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [storage, setStorage] = useState<string | undefined>(undefined);
  const [user, setUser] = useState<UserRecord | null>(null);
  const [awaitingName, setAwaitingName] = useState(true);
  const [bootMsgs, setBootMsgs] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [tab, setTab] = useState<Tab>("chats");
  const [mobileChat, setMobileChat] = useState(true);
  const [search, setSearch] = useState("");
  const [msgSearch, setMsgSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [listFor, setListFor] = useState<ChatMessage | null>(null);
  const [calOpen, setCalOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [appearance, setAppearance] = useAppearance();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  const persist = useCallback((u: UserRecord) => {
    localStorage.setItem(LS, JSON.stringify(u));
  }, []);

  const startIntro = useCallback(() => {
    setAwaitingName(true);
    setMobileChat(true);
    setBootMsgs([
      {
        id: "boot-1",
        role: "bot",
        text: "hey, i'm Buffer. tell me when you work and i'll show you when you're actually free, then nudge you to spend some of it with the people you love.\n\nfirst: what should i call you?",
        createdAt: new Date().toISOString(),
        status: "delivered",
      },
    ]);
    window.setTimeout(() => composer.current?.focus(), 50);
  }, []);

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    (async () => {
      try {
        const cached = localStorage.getItem(LS);
        const res = await fetch("/api/session");
        const data = await res.json();
        setSettings(data.settings);
        setStorage(data.storage);
        if (data.user) {
          let u = data.user as UserRecord;
          if (cached) {
            try {
              const c = JSON.parse(cached) as UserRecord;
              if (c.id === u.id && new Date(c.updatedAt) > new Date(u.updatedAt)) {
                u = c;
                await fetch("/api/chat", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ user: c }),
                });
              }
            } catch {
              /* ignore */
            }
          }
          setUser(u);
          setAwaitingName(false);
          setMobileChat(true);
          persist(u);
        } else if (cached) {
          try {
            const c = JSON.parse(cached) as UserRecord;
            const r = await fetch("/api/session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: c.name, timezone: tz }),
            });
            const d = await r.json();
            if (d.user) {
              setUser(d.user);
              setAwaitingName(false);
              setMobileChat(true);
              persist(d.user);
              setSettings(d.settings);
            } else {
              startIntro();
            }
          } catch {
            startIntro();
          }
        } else {
          startIntro();
        }
      } catch {
        startIntro();
      }
    })();
  }, [persist, startIntro]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [user?.messages.length, bootMsgs.length, typing]);

  useEffect(() => {
    if (!user) return;
    const t = setInterval(async () => {
      // Send our copy: the server forgets users between cold starts, the browser does not.
      const res = await fetch("/api/chat", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user, poll: true }) });
      if (!res.ok) return;
      const data = (await res.json()) as { user: UserRecord; reminders?: ChatMessage[] };
      if (data.reminders?.length) {
        setUser(data.user);
        persist(data.user);
        if (data.user.notify && typeof Notification !== "undefined" && Notification.permission === "granted") {
          for (const m of data.reminders) {
            const body = m.text.replace(/\*/g, "").split("\n")[0].slice(0, 140);
            try {
              new Notification("Buffer", { body, tag: m.id, icon: "/favicon.ico" });
            } catch {
              /* the page is not allowed to show one right now */
            }
          }
        }
      }
    }, 30000);
    return () => clearInterval(t);
  }, [user, persist]);

  const messages = useMemo(
    () => (awaitingName ? bootMsgs : user?.messages || []),
    [awaitingName, bootMsgs, user?.messages],
  );
  const botName = settings?.botDisplayName || "Buffer";

  async function submitName(name: string) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setTyping(true);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, timezone: tz }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Couldn't sign you in.");
        setBootMsgs((m) => [
          ...m,
          {
            id: `boot-err-${Date.now()}`,
            role: "bot",
            text: data.error || "that name didn't work. try again?",
            createdAt: new Date().toISOString(),
            status: "delivered",
          },
        ]);
        return;
      }
      setSettings(data.settings);
      setUser(data.user);
      setAwaitingName(false);
      setMobileChat(true);
      persist(data.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't sign you in.");
    } finally {
      setTyping(false);
      window.setTimeout(() => composer.current?.focus(), 50);
    }
  }

  const sendingRef = useRef(false);

  function composerValue() {
    return (composer.current?.value ?? draft ?? "").replace(/^\s+|\s+$/g, "");
  }

  function resizeComposer() {
    const el = composer.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  async function send(text?: string) {
    const trimmed = (text ?? composerValue()).trim();
    if (!trimmed) {
      composer.current?.focus();
      return;
    }
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setDraft("");
    setSearch("");
    if (composer.current) {
      composer.current.value = "";
      composer.current.style.height = "44px";
    }
    setEmojiOpen(false);
    setPlusOpen(false);
    setError(null);
    setMobileChat(true);
    try {
      if (awaitingName) {
        setBootMsgs((m) => [
          ...m,
          {
            id: `boot-u-${Date.now()}`,
            role: "user",
            text: trimmed,
            createdAt: new Date().toISOString(),
            status: "read",
          },
        ]);
        await submitName(trimmed);
        return;
      }
      if (!user) return;
      const optimistic: UserRecord = {
        ...user,
        messages: [
          ...user.messages,
          {
            id: `tmp_${crypto.randomUUID()}`,
            role: "user",
            text: trimmed,
            createdAt: new Date().toISOString(),
            status: "sent",
          },
        ],
      };
      setUser(optimistic);
      setTyping(true);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, user }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "send failed");
      setUser(data.user);
      persist(data.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send");
    } finally {
      sendingRef.current = false;
      setTyping(false);
      setSending(false);
      window.setTimeout(() => composer.current?.focus(), 50);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  async function signOut() {
    await fetch("/api/session", { method: "DELETE" });
    localStorage.removeItem(LS);
    setUser(null);
    startIntro();
    setMenuOpen(false);
  }

  const last = messages[messages.length - 1];
  const preview = last?.text.replace(/\n/g, " ").slice(0, 48) || "hey, what's your name?";
  const grouped = useMemo(() => {
    const tz = user?.settings.timezone || "UTC";
    const out: Array<{ day: string; msgs: ChatMessage[] }> = [];
    for (const m of messages) {
      if (msgSearch && !m.text.toLowerCase().includes(msgSearch.toLowerCase())) continue;
      const day = formatMessageDay(m.createdAt, tz);
      const g = out[out.length - 1];
      if (!g || g.day !== day) out.push({ day, msgs: [m] });
      else g.msgs.push(m);
    }
    return out;
  }, [messages, user?.settings.timezone, msgSearch]);

  const lastBot = [...messages].reverse().find((m) => m.role === "bot");
  const chips =
    awaitingName || lastBot?.buttons?.length || lastBot?.list
      ? []
      : last?.card?.type === "proposal"
        ? ["lock it", "nah, cancel", "make it 30m later"]
        : [
            "rundown",
            "give options",
            user?.calendarConnectedAt ? "add to calendar" : "connect calendar",
          ];

  function handleReplyButton(message: ChatMessage, button: ReplyButton) {
    const tz = user?.settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const event =
      user?.events.find((e) => e.id === message.calendarEventId) ||
      user?.events[user.events.length - 1];
    if (button.action === "google-cal") {
      if (!event) {
        void send("add to calendar");
        return;
      }
      window.open(googleCalendarUrl(event, tz), "_blank", "noopener,noreferrer");
      return;
    }
    if (button.action === "ics") {
      if (!event) {
        void send("add to calendar");
        return;
      }
      downloadIcs(event.title, eventToIcs(event, tz));
      return;
    }
    if (button.action === "outlook-cal") {
      if (!event) {
        void send("add to calendar");
        return;
      }
      window.open(outlookEventUrl(event), "_blank", "noopener,noreferrer");
      return;
    }
    if (button.action === "connect-feed") {
      setCalOpen(true);
      return;
    }
    if (button.action === "notify") {
      void (async () => {
        let granted = false;
        try {
          if (typeof Notification !== "undefined") {
            const result = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
            granted = result === "granted";
          }
        } catch {
          granted = false;
        }
        await send(granted ? "notifications on" : "notifications off");
      })();
      return;
    }
    void send(button.payload || button.title);
  }

  return (
    <div className="wa-app flex h-[100dvh] flex-col bg-(--wa-bg) text-(--wa-text)">
      <div className="mx-auto flex h-full w-full max-w-[1600px] overflow-hidden shadow-[0_0_80px_rgba(0,0,0,.45)]">
        <aside
          className={cn(
            "flex w-full flex-col border-r border-(--wa-divider) bg-(--wa-panel) md:w-[380px] md:min-w-[320px]",
            mobileChat ? "hidden md:flex" : "flex",
          )}
        >
          <header className="flex items-center gap-3 bg-(--wa-bar) px-4 py-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#6a7175] text-sm font-semibold">
              {(user?.name || "?").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">{user?.name || "Not signed in"}</p>
              <p className="truncate text-[12px] text-(--wa-muted)">
                {awaitingName ? "Buffer wants your name" : "Work-life chat is live"}
              </p>
            </div>
            <Link
              href="/"
              className="rounded-full px-2 py-1 text-[11px] text-(--wa-muted) hover:bg-(--wa-hover)"
            >
              Site
            </Link>
          </header>
          <div className="flex border-b border-(--wa-divider) bg-(--wa-panel) text-[13px] font-medium">
            {(["chats", "status", "calls"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "flex-1 py-3 capitalize",
                  tab === t
                    ? "border-b-2 border-(--wa-accent) text-(--wa-accent)"
                    : "text-(--wa-muted)",
                )}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === "chats" && (
            <>
              <div className="px-3 py-2">
                <div className="flex items-center gap-2 rounded-lg bg-(--wa-bar) px-3 py-1.5">
                  <Search className="size-4 text-(--wa-muted)" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      if (awaitingName && search.trim()) {
                        void send(search);
                      } else {
                        setMobileChat(true);
                      }
                    }}
                    placeholder={awaitingName ? "Type your name to start…" : "Search chats"}
                    className="w-full bg-transparent text-[14px] outline-none placeholder:text-(--wa-muted)"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileChat(true)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-(--wa-hover)"
              >
                <div className="relative">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-(--wa-accent) text-lg font-bold text-(--wa-accent-ink)">
                    B
                  </div>
                  <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-(--wa-panel) bg-(--wa-accent)" />
                </div>
                <div className="min-w-0 flex-1 border-b border-(--wa-divider) pb-3">
                  <div className="flex items-baseline justify-between">
                    <p className="text-[16px] font-medium">{botName}</p>
                    <p className="text-[12px] text-(--wa-accent)">
                      {last ? formatMessageTime(last.createdAt) : ""}
                    </p>
                  </div>
                  <p className="truncate text-[13px] text-(--wa-muted)">{preview}</p>
                </div>
              </button>
            </>
          )}
          {tab === "status" && (
            <div className="space-y-3 p-4 text-[14px]">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-(--wa-muted)">
                My status
              </p>
              <div className="flex gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-(--wa-accent) bg-(--wa-bar)">
                  {(user?.name || "Y").slice(0, 1)}
                </div>
                <div>
                  <p>Today&apos;s buffer</p>
                  <p className="text-[13px] text-(--wa-muted)">
                    {user
                      ? `Off the clock after ${user.settings.protectEveningsAfter}${user.people?.length ? ` · calls: ${user.people.join(", ")}` : ""}`
                      : "Sign in to post a status"}
                  </p>
                </div>
              </div>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-(--wa-muted)">
                Recent
              </p>
              <p className="text-(--wa-muted)">
                Buffer · say &quot;today&quot; or &quot;my week&quot; in the chat for a picture of your time.
              </p>
            </div>
          )}
          {tab === "calls" && (
            <div className="p-4 text-[14px] text-(--wa-muted)">
              <p className="mb-3 text-(--wa-text)">Scheduled</p>
              {(user?.events || [])
                .slice()
                .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
                .slice(0, 8)
                .map((e) => (
                  <div key={e.id} className="flex items-center gap-3 border-b border-(--wa-divider) py-3">
                    <Phone className="size-4 text-(--wa-accent)" />
                    <div>
                      <p className="text-(--wa-text)">{e.title}</p>
                      <p className="text-[12px]">
                        {e.date} · {e.start} · {e.kind}
                      </p>
                    </div>
                  </div>
                ))}
              {!user?.events.length && <p>No events yet. Text Buffer to plan one.</p>}
            </div>
          )}
        </aside>

        <section
          className={cn(
            "relative min-w-0 flex-1 flex-col bg-(--wa-wall) text-(--wa-text)",
            mobileChat ? "flex" : "hidden md:flex",
          )}
        >
          <header className="z-10 flex items-center gap-3 bg-(--wa-bar) px-3 py-2">
            <button className="md:hidden" onClick={() => setMobileChat(false)} aria-label="Back">
              <ArrowLeft className="size-5" />
            </button>
            <button
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              onClick={() => setInfoOpen(true)}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-(--wa-accent) font-bold text-(--wa-accent-ink)">
                B
              </div>
              <div className="min-w-0">
                <p className="truncate text-[16px] font-medium">{botName}</p>
                <p className={cn("truncate text-[12px]", typing ? "text-(--wa-accent)" : "text-(--wa-muted)")}>
                  {typing ? "typing…" : "online · tap for info"}
                </p>
              </div>
            </button>
            <button onClick={() => setShowSearch((s) => !s)} aria-label="Search">
              <Search className="size-5 text-(--wa-icon)" />
            </button>
            <Video className="size-5 text-(--wa-icon) opacity-50" />
            <Phone className="size-5 text-(--wa-icon) opacity-50" />
            <div className="relative">
              <button onClick={() => setMenuOpen((s) => !s)} aria-label="Menu">
                <MoreVertical className="size-5 text-(--wa-icon)" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 z-20 mt-2 w-48 rounded bg-(--wa-pop) py-2 text-[14px] shadow-xl">
                  <button
                    className="block w-full px-4 py-2 text-left hover:bg-(--wa-hover)"
                    onClick={() => {
                      setInfoOpen(true);
                      setMenuOpen(false);
                    }}
                  >
                    Contact info
                  </button>
                  <button
                    className="block w-full px-4 py-2 text-left hover:bg-(--wa-hover)"
                    onClick={() => void send("rundown")}
                  >
                    Today&apos;s rundown
                  </button>
                  <button
                    className="block w-full px-4 py-2 text-left hover:bg-(--wa-hover)"
                    onClick={() => {
                      setCalOpen(true);
                      setMenuOpen(false);
                    }}
                  >
                    Connect calendar
                  </button>
                  <button
                    className="block w-full px-4 py-2 text-left hover:bg-(--wa-hover)"
                    onClick={() => {
                      setThemeOpen(true);
                      setMenuOpen(false);
                    }}
                  >
                    Theme and wallpaper
                  </button>
                  <button
                    className="block w-full px-4 py-2 text-left hover:bg-(--wa-hover)"
                    onClick={() => void signOut()}
                  >
                    Switch person
                  </button>
                </div>
              )}
            </div>
          </header>
          {showSearch && (
            <div className="flex items-center gap-2 bg-(--wa-bar) px-3 pb-2">
              <input
                value={msgSearch}
                onChange={(e) => setMsgSearch(e.target.value)}
                placeholder="Search this chat"
                className="w-full rounded bg-(--wa-input) px-3 py-1.5 text-sm outline-none"
              />
              <button onClick={() => setShowSearch(false)}>
                <X className="size-4" />
              </button>
            </div>
          )}

          <div
            ref={scroller}
            className="wa-wallpaper relative flex-1 overflow-y-auto px-3 py-3 md:px-10"
          >
            {grouped.map((g) => (
              <div key={g.day}>
                <div className="sticky top-2 z-[1] mb-3 flex justify-center">
                  <span className="rounded-[7px] bg-(--wa-chip) px-3 py-1 text-[12.5px] text-(--wa-muted) shadow">
                    {g.day}
                  </span>
                </div>
                {g.msgs.map((m, i) => (
                  <Bubble
                    key={m.id}
                    message={m}
                    tail={i === 0 || g.msgs[i - 1].role !== m.role}
                    onButton={(button) => handleReplyButton(m, button)}
                    onList={() => setListFor(m)}
                  />
                ))}
              </div>
            ))}
            {typing && (
              <div className="mb-2 flex justify-start">
                <div className="wa-bubble wa-in wa-tail rounded-lg rounded-tl-none bg-(--wa-in) px-3 py-2 text-(--wa-muted)">
                  <span className="inline-flex gap-1">
                    <i className="wa-dot" />
                    <i className="wa-dot" />
                    <i className="wa-dot" />
                  </span>
                </div>
              </div>
            )}
            {error && <p className="text-center text-xs text-red-400">{error}</p>}
          </div>

          {chips.length > 0 && (
            <div className="flex gap-2 overflow-x-auto bg-(--wa-bg) px-3 pb-1">
              {chips.map((c) => (
                <button
                  key={c}
                  onClick={() =>
                    c === "connect calendar" ? setCalOpen(true) : void send(c)
                  }
                  className="shrink-0 rounded-full border border-(--wa-accent) bg-(--wa-bar) px-3 py-1 text-[13px] text-(--wa-accent)"
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="relative z-30 flex items-end gap-2 bg-(--wa-bar) px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:px-4"
          >
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setEmojiOpen((s) => !s);
                  setPlusOpen(false);
                }}
                aria-label="Emoji"
              >
                <Smile className="mb-2 size-6 text-(--wa-muted)" />
              </button>
              {emojiOpen && (
                <div className="absolute bottom-12 left-0 z-10 grid w-56 grid-cols-6 gap-1 rounded-xl bg-(--wa-pop) p-2 shadow-xl">
                  {EMOJIS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      className="text-xl"
                      onClick={() => {
                        if (composer.current) {
                          composer.current.value += e;
                          setDraft(composer.current.value);
                          composer.current.focus();
                        }
                      }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setPlusOpen((s) => !s);
                  setEmojiOpen(false);
                }}
                aria-label="Attach"
              >
                <Plus className="mb-2 size-6 text-(--wa-muted)" />
              </button>
              {plusOpen && (
                <div className="absolute bottom-12 left-0 z-10 w-52 rounded-xl bg-(--wa-pop) py-2 text-[14px] shadow-xl">
                  {[
                    ["📅 New event", "plan "],
                    ["✅ New to-do", "remind me to "],
                    ["📋 Today's rundown", "rundown"],
                    user?.calendarConnectedAt
                      ? ["📆 Add to calendar", "add to calendar"]
                      : ["📆 Connect calendar", "connect calendar"],
                    ["⚖️ My rules", "i want "],
                  ].map(([label, fill]) => (
                    <button
                      key={label}
                      type="button"
                      className="block w-full px-4 py-2 text-left hover:bg-(--wa-hover)"
                      onClick={() => {
                        if (fill === "rundown") void send("rundown");
                        else if (fill === "connect calendar") {
                          setCalOpen(true);
                          setPlusOpen(false);
                          return;
                        }
                        else if (composer.current) {
                          composer.current.value = fill;
                          setDraft(fill);
                          composer.current.focus();
                        }
                        setPlusOpen(false);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <textarea
              ref={composer}
              name="message"
              rows={1}
              autoComplete="off"
              enterKeyHint="send"
              autoFocus
              defaultValue=""
              onChange={(e) => {
                setDraft(e.target.value);
                resizeComposer();
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                if (e.shiftKey || e.nativeEvent.isComposing) return;
                e.preventDefault();
                e.stopPropagation();
                void send();
              }}
              placeholder={
                awaitingName ? "Your name, then send" : "Message"
              }
              className="max-h-40 min-h-[44px] flex-1 resize-none rounded-[22px] bg-(--wa-input) px-4 py-2.5 text-[15px] text-(--wa-text) outline-none placeholder:text-(--wa-muted)"
            />
            <button
              type="button"
              aria-label={draft.trim() ? "Send" : "Voice message (not in this demo)"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (draft.trim()) void send();
              }}
              className="relative z-40 mb-0.5 flex size-12 shrink-0 touch-manipulation items-center justify-center rounded-full bg-(--wa-accent) text-(--wa-accent-ink) transition-transform active:scale-95"
              aria-busy={sending}
            >
              {draft.trim() ? <Send className="pointer-events-none size-5" /> : <Mic className="pointer-events-none size-5" />}
            </button>
          </form>
        </section>
      </div>

      {themeOpen && <ThemeSheet appearance={appearance} onChange={setAppearance} onClose={() => setThemeOpen(false)} />}
      {infoOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => setInfoOpen(false)}>
          <div
            className="h-full w-full max-w-md overflow-y-auto bg-(--wa-panel)"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-4 bg-(--wa-bar) px-4 py-4">
              <button onClick={() => setInfoOpen(false)}>
                <X />
              </button>
              <p>Contact info</p>
            </div>
            <div className="flex flex-col items-center gap-2 py-8">
              <div className="flex h-28 w-28 items-center justify-center rounded-full bg-(--wa-accent) text-4xl font-bold text-(--wa-accent-ink)">
                B
              </div>
              <p className="text-xl">{botName}</p>
              <p className="text-sm text-(--wa-muted)">Bot · always online</p>
            </div>
            <div className="space-y-2 bg-(--wa-bg) p-4 text-[14px]">
              <p className="text-(--wa-muted)">About</p>
              <p>{settings?.botAbout}</p>
            </div>
            {user && (
              <div className="mt-2 space-y-2 bg-(--wa-bg) p-4 text-[13px] leading-6">
                <p className="text-(--wa-muted)">Your rules</p>
                <p>Wake {user.settings.wakeTime} · Sleep {user.settings.sleepTime}</p>
                <p>
                  Work {user.settings.workStart}–{user.settings.workEnd} · cap{" "}
                  {Math.round(user.settings.maxWorkMinutesPerDay / 60)}h
                </p>
                <p>
                  Off the clock after {user.settings.protectEveningsAfter}
                  {user.people?.length ? ` · nudges to call ${user.people.join(", ")}` : ""}
                </p>
                <p className="text-(--wa-muted)">Chat kept as {user.name}</p>
                <p>
                  {user.messages.length} messages · {user.events.length} events · {user.todos.length}{" "}
                  to-dos
                </p>
                <button
                  type="button"
                  className="mt-2 text-(--wa-accent)"
                  onClick={() => {
                    setInfoOpen(false);
                    setCalOpen(true);
                  }}
                >
                  Connect Google / Apple / Android / Outlook
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {calOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 md:items-center"
          onClick={() => setCalOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-(--wa-panel) p-5 md:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {user ? (
              <CalendarConnect
                user={user}
                storage={storage}
                origin={typeof window === "undefined" ? "" : window.location.origin}
                onConnected={(via) => {
                  setCalOpen(false);
                  void send(`connected ${via} calendar`);
                }}
              />
            ) : (
              <p className="text-sm text-(--wa-muted)">
                Say your name in chat first so we can mint a private feed.
              </p>
            )}
            <button
              type="button"
              className="mt-4 w-full rounded-lg bg-(--wa-bar) py-2.5 text-[14px]"
              onClick={() => setCalOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
      {listFor?.list && (
        <WhatsAppListSheet
          message={listFor}
          onClose={() => setListFor(null)}
          onPick={(row) => {
            setListFor(null);
            if (row.payload.endsWith(" ")) {
              if (composer.current) {
                composer.current.value = row.payload;
                setDraft(row.payload);
                composer.current.focus();
              }
            } else {
              void send(row.payload);
            }
          }}
        />
      )}
    </div>
  );
}

function Bubble({
  message,
  tail,
  onButton,
  onList,
}: {
  message: ChatMessage;
  tail: boolean;
  onButton: (button: ReplyButton) => void;
  onList: () => void;
}) {
  const mine = message.role === "user";
  return (
    <div className={cn("mb-1.5 flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "wa-bubble max-w-[min(85%,32rem)] rounded-lg",
          mine ? "wa-out rounded-tr-none bg-(--wa-out)" : "wa-in rounded-tl-none bg-(--wa-in)",
          tail && "wa-tail",
        )}
      >
        <div className={cn("px-2 pt-1.5 pb-1", message.card?.type === "image" && "px-1 pt-1")}>
          {message.card?.type === "image" ? (
            <>
              <MessageCards message={message} />
              {message.text.trim() ? (
                <div className="mt-1 whitespace-pre-wrap break-words px-1 text-[14.2px] leading-[19px] text-(--wa-text) [overflow-wrap:anywhere]">
                  <WhatsAppText text={message.text} />
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="whitespace-pre-wrap break-words text-[14.2px] leading-[19px] text-(--wa-text) [overflow-wrap:anywhere]">
                <WhatsAppText text={message.text} />
              </div>
              <MessageCards message={message} />
            </>
          )}
          <p className={cn("mt-0.5 flex items-center justify-end gap-1 text-[11px] text-(--wa-time)", message.card?.type === "image" && "px-1")}>
            {formatMessageTime(message.createdAt)}
            {mine &&
              (message.status === "read" ? (
                <CheckCheck className="size-3.5 text-(--wa-tick)" />
              ) : (
                <Check className="size-3.5" />
              ))}
          </p>
        </div>
        {!mine && message.buttons?.length ? (
          <ReplyButtons buttons={message.buttons} onPress={onButton} />
        ) : null}
        {!mine && message.list ? (
          <ListTrigger label={message.list.button} onPress={onList} />
        ) : null}
      </div>
    </div>
  );
}
