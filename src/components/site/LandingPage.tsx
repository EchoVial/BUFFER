"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, MessageCircle, Shield, Smartphone } from "lucide-react";
import { CalendarConnect } from "@/components/calendar/CalendarConnect";
import { AppSettings, UserRecord } from "@/lib/types";

export function LandingPage() {
  const [user, setUser] = useState<UserRecord | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    (async () => {
      try {
        const res = await fetch("/api/session");
        const data = await res.json();
        setSettings(data.settings);
        if (data.user) setUser(data.user);
      } catch {
        /* stay signed out */
      }
    })();
  }, []);

  return (
    <div className="min-h-[100dvh] bg-[#0b141a] text-[#e9edef]">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <p className="text-[17px] font-semibold tracking-tight">Buffer</p>
        <nav className="flex items-center gap-3 text-[13px]">
          <Link href="/chat" className="rounded-full bg-[#00a884] px-4 py-2 font-semibold text-[#111b21]">
            Open chat
          </Link>
          <Link href="/admin" className="text-[#8696a0] hover:text-[#e9edef]">
            Admin
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-20">
        <section className="grid gap-10 py-10 md:grid-cols-[1.1fr_0.9fr] md:items-center md:py-16">
          <div>
            <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-[#00a884]">
              Work-life chat + your OS calendar
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
              Text like WhatsApp. Show up on Google, Apple, Android, and Outlook.
            </h1>
            <p className="mt-4 max-w-xl text-[16px] leading-7 text-[#aebac1]">
              {settings?.botAbout ||
                "Buffer plans events, stacks to-dos, and protects social time. This site publishes a live calendar feed each OS can subscribe to — websites still can’t silently write into the built-in calendar."}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/chat"
                className="inline-flex items-center gap-2 rounded-full bg-[#00a884] px-5 py-2.5 text-[15px] font-semibold text-[#111b21]"
              >
                <MessageCircle className="size-4" />
                {user ? `Continue as ${user.name}` : "Open the chat"}
              </Link>
              <a
                href="#calendars"
                className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-[15px] text-[#e9edef]"
              >
                <CalendarDays className="size-4" />
                Connect a calendar
              </a>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#111b21] p-5 shadow-[0_20px_80px_rgba(0,0,0,.35)]">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[#8696a0]">
              What you text
            </p>
            <ul className="mt-3 space-y-2 text-[14px] leading-6 text-[#aebac1]">
              <li>
                <span className="text-[#e9edef]">gym tmrw 7pm</span> — plans it, then offers Lock it
              </li>
              <li>
                <span className="text-[#e9edef]">i want 2 hrs of social every day</span> — becomes a rule
              </li>
              <li>
                <span className="text-[#e9edef]">rundown</span> — hour-by-hour without a spreadsheet
              </li>
              <li>
                <span className="text-[#e9edef]">connect calendar</span> — subscribe from this device
              </li>
            </ul>
          </div>
        </section>

        <section id="calendars" className="scroll-mt-8 rounded-2xl border border-white/10 bg-[#111b21] p-5 md:p-8">
          <div className="mb-6 flex items-start gap-3">
            <Smartphone className="mt-0.5 size-5 text-[#00a884]" />
            <div>
              <h2 className="text-xl font-semibold">Calendars for each OS</h2>
              <p className="mt-1 max-w-2xl text-[14px] leading-6 text-[#8696a0]">
                After you say your name in chat, Buffer mints a private ICS feed. Google Calendar,
                Apple Calendar, Android (via Google), and Outlook all know how to subscribe to that
                format. New locked events appear on the next refresh.
              </p>
            </div>
          </div>

          {user ? (
            <>
              <CalendarConnect
                user={user}
                origin={origin || (typeof window !== "undefined" ? window.location.origin : "")}
                onConnected={(via) => {
                  void (async () => {
                    try {
                      const res = await fetch("/api/chat", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          user,
                          text: `connected ${via} calendar`,
                        }),
                      });
                      const data = await res.json();
                      if (data.user) setUser(data.user);
                    } catch {
                      /* still show local confirm */
                    }
                  })();
                }}
              />
              {user.calendarConnectedAt ? (
                <p className="mt-4 rounded-xl bg-[#00a884]/15 px-4 py-3 text-[14px] text-[#00a884]">
                  Connected
                  {user.calendarConnectedVia ? ` via ${user.calendarConnectedVia}` : ""}. Open chat to
                  see Buffer&apos;s confirmation. Locked events will land on the next calendar refresh.
                </p>
              ) : null}
            </>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <OsCard title="Google / Android" body="Add by URL in Google Calendar, or tap Add in Google Calendar from chat. Android Calendar uses the same Google account." />
                <OsCard title="iPhone, iPad, Mac" body="Subscribe with webcal. Calendar.app asks once; after that it pulls the live feed." />
                <OsCard title="Windows / Outlook" body="Outlook on the web can add a calendar from the web. Desktop Outlook can also subscribe to the ICS URL." />
                <OsCard title="One-off import" body="Download a .ics snapshot if your work laptop blocks live subscriptions." />
              </div>
              <p className="text-[14px] text-[#aebac1]">
                Open chat, send your name, then come back here — or type{" "}
                <span className="text-[#e9edef]">connect calendar</span> in the thread.
              </p>
              <Link
                href="/chat"
                className="inline-flex rounded-full bg-[#00a884] px-5 py-2.5 text-[15px] font-semibold text-[#111b21]"
              >
                Start chat to get your feed
              </Link>
            </div>
          )}
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <Note
            icon={<Shield className="size-4" />}
            title="Private by design"
            body="The feed URL is a secret token, not your name. Don’t share it. Rotate by switching person in chat and asking an admin to reset you."
          />
          <Note
            icon={<CalendarDays className="size-4" />}
            title="Live, not silent write"
            body="OS vendors block websites from injecting events without you. Subscribe once; Buffer updates the feed when you lock plans in chat."
          />
          <Note
            icon={<MessageCircle className="size-4" />}
            title="Same chat you already use"
            body="Reply buttons and option lists stay WhatsApp-shaped. Calendar is a destination, not a second app to learn."
          />
        </section>
      </main>
    </div>
  );
}

function OsCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0b141a] p-4">
      <p className="text-[15px] font-medium">{title}</p>
      <p className="mt-1 text-[13px] leading-5 text-[#8696a0]">{body}</p>
    </div>
  );
}

function Note({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#111b21] p-4">
      <p className="flex items-center gap-2 text-[14px] font-medium text-[#00a884]">
        {icon}
        {title}
      </p>
      <p className="mt-2 text-[13px] leading-5 text-[#8696a0]">{body}</p>
    </div>
  );
}
