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
  MoreVertical,
  Paperclip,
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
import { downloadIcs, eventToIcs, googleCalendarUrl } from "@/lib/calendar";
import { CalendarConnect } from "@/components/calendar/CalendarConnect";
import { MessageCards } from "./cards";
import { WhatsAppText } from "./wa-text";
import { ListTrigger, ReplyButtons, WhatsAppListSheet } from "./interactive";
import { cn } from "@/lib/utils";

const LS = "balance.user.cache";
const EMOJIS = ["😀", "😂", "❤️", "🔥", "✨", "🙏", "✅", "📅", "😅", "💪", "☕", "🌙"];

type Tab = "chats" | "status" | "calls";

export function WhatsAppApp() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
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
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLInputElement>(null);

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
        text: "hey — i'm Balance, your work-life wingman in a WhatsApp skin.\n\nbefore i remember anything: what should i call you? first name is perfect.",
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
      const res = await fetch(`/api/chat?userId=${user.id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.reminders?.length) {
        setUser(data.user);
        persist(data.user);
      }
    }, 30000);
    return () => clearInterval(t);
  }, [user, persist]);

  const messages = useMemo(
    () => (awaitingName ? bootMsgs : user?.messages || []),
    [awaitingName, bootMsgs, user?.messages],
  );
  const botName = settings?.botDisplayName || "Balance";

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
    return (composer.current?.value ?? draft ?? search ?? "").trim();
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
    if (composer.current) composer.current.value = "";
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
        : ["rundown", "my todos", "connect calendar", "help"];

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
    if (button.action === "connect-feed") {
      setCalOpen(true);
      return;
    }
    void send(button.payload || button.title);
  }

  return (
    <div className="wa-app flex h-[100dvh] flex-col bg-[#0b141a] text-[#e9edef]">
      <div className="mx-auto flex h-full w-full max-w-[1600px] overflow-hidden shadow-[0_0_80px_rgba(0,0,0,.45)]">
        <aside
          className={cn(
            "flex w-full flex-col border-r border-white/5 bg-[#111b21] md:w-[380px] md:min-w-[320px]",
            mobileChat ? "hidden md:flex" : "flex",
          )}
        >
          <header className="flex items-center gap-3 bg-[#202c33] px-4 py-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#6a7175] text-sm font-semibold">
              {(user?.name || "?").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">{user?.name || "Not signed in"}</p>
              <p className="truncate text-[12px] text-[#8696a0]">
                {awaitingName ? "Balance wants your name" : "Work-life chat is live"}
              </p>
            </div>
            <Link
              href="/"
              className="rounded-full px-2 py-1 text-[11px] text-[#8696a0] hover:bg-white/5"
            >
              Site
            </Link>
            <Link
              href="/admin"
              className="rounded-full px-2 py-1 text-[11px] text-[#00a884] hover:bg-white/5"
            >
              Admin
            </Link>
          </header>
          <div className="flex border-b border-white/5 bg-[#111b21] text-[13px] font-medium">
            {(["chats", "status", "calls"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "flex-1 py-3 capitalize",
                  tab === t
                    ? "border-b-2 border-[#00a884] text-[#00a884]"
                    : "text-[#8696a0]",
                )}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === "chats" && (
            <>
              <div className="px-3 py-2">
                <div className="flex items-center gap-2 rounded-lg bg-[#202c33] px-3 py-1.5">
                  <Search className="size-4 text-[#8696a0]" />
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
                    className="w-full bg-transparent text-[14px] outline-none placeholder:text-[#8696a0]"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileChat(true)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-white/5"
              >
                <div className="relative">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#00a884] text-lg font-bold text-[#111b21]">
                    B
                  </div>
                  <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#111b21] bg-[#00a884]" />
                </div>
                <div className="min-w-0 flex-1 border-b border-white/5 pb-3">
                  <div className="flex items-baseline justify-between">
                    <p className="text-[16px] font-medium">{botName}</p>
                    <p className="text-[12px] text-[#00a884]">
                      {last ? formatMessageTime(last.createdAt) : ""}
                    </p>
                  </div>
                  <p className="truncate text-[13px] text-[#8696a0]">{preview}</p>
                </div>
              </button>
            </>
          )}
          {tab === "status" && (
            <div className="space-y-3 p-4 text-[14px]">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-[#8696a0]">
                My status
              </p>
              <div className="flex gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#00a884] bg-[#202c33]">
                  {(user?.name || "Y").slice(0, 1)}
                </div>
                <div>
                  <p>Today&apos;s balance</p>
                  <p className="text-[13px] text-[#8696a0]">
                    {user
                      ? `Social goal ${Math.round(user.settings.socialMinutesPerDay / 60)}h · work cap ${Math.round(user.settings.maxWorkMinutesPerDay / 60)}h`
                      : "Sign in to post a status"}
                  </p>
                </div>
              </div>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-[#8696a0]">
                Recent
              </p>
              <p className="text-[#8696a0]">
                Balance · tap the chat and say &quot;how am i doing&quot; for a burnout check.
              </p>
            </div>
          )}
          {tab === "calls" && (
            <div className="p-4 text-[14px] text-[#8696a0]">
              <p className="mb-3 text-[#e9edef]">Scheduled</p>
              {(user?.events || [])
                .slice()
                .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
                .slice(0, 8)
                .map((e) => (
                  <div key={e.id} className="flex items-center gap-3 border-b border-white/5 py-3">
                    <Phone className="size-4 text-[#00a884]" />
                    <div>
                      <p className="text-[#e9edef]">{e.title}</p>
                      <p className="text-[12px]">
                        {e.date} · {e.start} · {e.kind}
                      </p>
                    </div>
                  </div>
                ))}
              {!user?.events.length && <p>No events yet. Text Balance to plan one.</p>}
            </div>
          )}
        </aside>

        <section
          className={cn(
            "relative min-w-0 flex-1 flex-col bg-[#0b141a]",
            mobileChat ? "flex" : "hidden md:flex",
          )}
        >
          <header className="z-10 flex items-center gap-3 bg-[#202c33] px-3 py-2">
            <button className="md:hidden" onClick={() => setMobileChat(false)} aria-label="Back">
              <ArrowLeft className="size-5" />
            </button>
            <button
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              onClick={() => setInfoOpen(true)}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#00a884] font-bold text-[#111b21]">
                B
              </div>
              <div className="min-w-0">
                <p className="truncate text-[16px] font-medium">{botName}</p>
                <p className="truncate text-[12px] text-[#00a884]">
                  {typing ? "typing…" : "online"}
                </p>
              </div>
            </button>
            <button onClick={() => setShowSearch((s) => !s)} aria-label="Search">
              <Search className="size-5 text-[#aebac1]" />
            </button>
            <Video className="size-5 text-[#aebac1] opacity-50" />
            <Phone className="size-5 text-[#aebac1] opacity-50" />
            <div className="relative">
              <button onClick={() => setMenuOpen((s) => !s)} aria-label="Menu">
                <MoreVertical className="size-5 text-[#aebac1]" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 z-20 mt-2 w-48 rounded bg-[#233138] py-2 text-[14px] shadow-xl">
                  <button
                    className="block w-full px-4 py-2 text-left hover:bg-white/5"
                    onClick={() => {
                      setInfoOpen(true);
                      setMenuOpen(false);
                    }}
                  >
                    Contact info
                  </button>
                  <button
                    className="block w-full px-4 py-2 text-left hover:bg-white/5"
                    onClick={() => void send("rundown")}
                  >
                    Today&apos;s rundown
                  </button>
                  <button
                    className="block w-full px-4 py-2 text-left hover:bg-white/5"
                    onClick={() => {
                      setCalOpen(true);
                      setMenuOpen(false);
                    }}
                  >
                    Connect calendar
                  </button>
                  <button
                    className="block w-full px-4 py-2 text-left hover:bg-white/5"
                    onClick={() => void signOut()}
                  >
                    Switch person
                  </button>
                  <Link href="/admin" className="block px-4 py-2 hover:bg-white/5">
                    Admin console
                  </Link>
                </div>
              )}
            </div>
          </header>
          {showSearch && (
            <div className="flex items-center gap-2 bg-[#202c33] px-3 pb-2">
              <input
                value={msgSearch}
                onChange={(e) => setMsgSearch(e.target.value)}
                placeholder="Search this chat"
                className="w-full rounded bg-[#2a3942] px-3 py-1.5 text-sm outline-none"
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
                  <span className="rounded-[7px] bg-[#182229] px-3 py-1 text-[12.5px] text-[#8696a0] shadow">
                    {g.day}
                  </span>
                </div>
                {g.msgs.map((m) => (
                  <Bubble
                    key={m.id}
                    message={m}
                    onButton={(button) => handleReplyButton(m, button)}
                    onList={() => setListFor(m)}
                  />
                ))}
              </div>
            ))}
            {typing && (
              <div className="mb-2 flex justify-start">
                <div className="rounded-lg rounded-tl-none bg-[#202c33] px-3 py-2 text-[#8696a0]">
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
            <div className="flex gap-2 overflow-x-auto bg-[#0b141a] px-3 pb-1">
              {chips.map((c) => (
                <button
                  key={c}
                  onClick={() => (c === "connect calendar" ? setCalOpen(true) : void send(c))}
                  className="shrink-0 rounded-full border border-[#00a884]/40 bg-[#202c33] px-3 py-1 text-[13px] text-[#00a884]"
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={onSubmit}
            className="relative z-30 flex items-end gap-2 bg-[#202c33] px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:px-4"
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
                <Smile className="mb-2 size-6 text-[#8696a0]" />
              </button>
              {emojiOpen && (
                <div className="absolute bottom-12 left-0 z-10 grid w-56 grid-cols-6 gap-1 rounded-xl bg-[#233138] p-2 shadow-xl">
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
                <Plus className="mb-2 size-6 text-[#8696a0]" />
              </button>
              {plusOpen && (
                <div className="absolute bottom-12 left-0 z-10 w-52 rounded-xl bg-[#233138] py-2 text-[14px] shadow-xl">
                  {[
                    ["📅 New event", "plan "],
                    ["✅ New to-do", "remind me to "],
                    ["📋 Today's rundown", "rundown"],
                    ["📆 Connect calendar", "connect calendar"],
                    ["⚖️ My rules", "i want "],
                  ].map(([label, fill]) => (
                    <button
                      key={label}
                      type="button"
                      className="block w-full px-4 py-2 text-left hover:bg-white/5"
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
            <Paperclip className="mb-2 hidden size-5 text-[#8696a0] md:block" />
            <input
              ref={composer}
              type="text"
              name="message"
              autoComplete="off"
              enterKeyHint="send"
              autoFocus
              defaultValue=""
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={awaitingName ? "Type your name, then send" : "Type a message"}
              className="h-11 min-h-[44px] flex-1 rounded-lg bg-[#2a3942] px-3 text-[15px] outline-none placeholder:text-[#8696a0]"
            />
            <button
              type="button"
              aria-label="Send"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void send();
              }}
              className="relative z-40 mb-0.5 flex size-12 shrink-0 touch-manipulation items-center justify-center rounded-full bg-[#00a884] text-[#111b21]"
              aria-busy={sending}
            >
              <Send className="pointer-events-none size-5" />
            </button>
          </form>
        </section>
      </div>

      {infoOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => setInfoOpen(false)}>
          <div
            className="h-full w-full max-w-md overflow-y-auto bg-[#111b21]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-4 bg-[#202c33] px-4 py-4">
              <button onClick={() => setInfoOpen(false)}>
                <X />
              </button>
              <p>Contact info</p>
            </div>
            <div className="flex flex-col items-center gap-2 py-8">
              <div className="flex h-28 w-28 items-center justify-center rounded-full bg-[#00a884] text-4xl font-bold text-[#111b21]">
                B
              </div>
              <p className="text-xl">{botName}</p>
              <p className="text-sm text-[#8696a0]">Bot · always online</p>
            </div>
            <div className="space-y-2 bg-[#0b141a] p-4 text-[14px]">
              <p className="text-[#8696a0]">About</p>
              <p>{settings?.botAbout}</p>
            </div>
            {user && (
              <div className="mt-2 space-y-2 bg-[#0b141a] p-4 text-[13px] leading-6">
                <p className="text-[#8696a0]">Your rules</p>
                <p>Wake {user.settings.wakeTime} · Sleep {user.settings.sleepTime}</p>
                <p>
                  Work {user.settings.workStart}–{user.settings.workEnd} · cap{" "}
                  {Math.round(user.settings.maxWorkMinutesPerDay / 60)}h
                </p>
                <p>
                  Social {Math.round(user.settings.socialMinutesPerDay / 60)}h / day · no work after{" "}
                  {user.settings.noWorkAfter || "—"}
                </p>
                <p className="text-[#8696a0]">Chat kept as {user.name}</p>
                <p>
                  {user.messages.length} messages · {user.events.length} events · {user.todos.length}{" "}
                  to-dos
                </p>
                <button
                  type="button"
                  className="mt-2 text-[#00a884]"
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
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-[#111b21] p-5 md:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {user ? (
              <CalendarConnect
                user={user}
                origin={typeof window === "undefined" ? "" : window.location.origin}
              />
            ) : (
              <p className="text-sm text-[#8696a0]">
                Say your name in chat first so we can mint a private feed.
              </p>
            )}
            <button
              type="button"
              className="mt-4 w-full rounded-lg bg-[#202c33] py-2.5 text-[14px]"
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
  onButton,
  onList,
}: {
  message: ChatMessage;
  onButton: (button: ReplyButton) => void;
  onList: () => void;
}) {
  const mine = message.role === "user";
  return (
    <div className={cn("mb-1.5 flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[min(85%,32rem)] overflow-hidden rounded-lg shadow",
          mine ? "rounded-tr-none bg-[#005c4b]" : "rounded-tl-none bg-[#202c33]",
        )}
      >
        <div className="px-2 pt-1.5 pb-1">
          <div className="whitespace-pre-wrap break-words text-[14.2px] leading-[19px] text-[#e9edef] [overflow-wrap:anywhere]">
            <WhatsAppText text={message.text} />
          </div>
          <MessageCards message={message} />
          <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-[#ffffff99]">
            {formatMessageTime(message.createdAt)}
            {mine &&
              (message.status === "read" ? (
                <CheckCheck className="size-3.5 text-[#53bdeb]" />
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
