"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Download, Smartphone } from "lucide-react";
import {
  detectCalendarPlatform,
  downloadIcs,
  googleSubscribeUrl,
  icsHttpUrl,
  icsWebcalUrl,
  outlookSubscribeUrl,
  platformLabel,
  userFeedIcs,
} from "@/lib/calendar";
import { UserRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

export function CalendarConnect({
  user,
  origin,
  compact,
  onConnected,
}: {
  user: UserRecord;
  origin: string;
  compact?: boolean;
  onConnected?: (via: "google" | "apple" | "outlook" | "copy" | "snapshot") => void;
}) {
  const token = user.calendarToken;
  const platform = useMemo(
    () => detectCalendarPlatform(typeof navigator === "undefined" ? "" : navigator.userAgent),
    [],
  );
  const [copied, setCopied] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  if (!token) {
    return (
      <p className="text-sm text-[#8696a0]">
        Sign in through chat first so we can mint a private calendar feed for you.
      </p>
    );
  }

  const httpsUrl = icsHttpUrl(origin, token);
  const webcal = icsWebcalUrl(origin, token);
  const google = googleSubscribeUrl(origin, token);
  const outlook = outlookSubscribeUrl(origin, token, `Balance — ${user.name}`);
  const name = platformLabel(platform);

  async function copyFeed() {
    try {
      await navigator.clipboard.writeText(httpsUrl);
      setCopied(true);
      setHint("Copied. Paste this URL in your calendar app — you're connected once it accepts the subscribe.");
      onConnected?.("copy");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setHint("Couldn’t copy — select the URL below.");
    }
  }

  function openApple() {
    window.location.href = webcal;
    setHint("Opening Apple Calendar to subscribe. You're connected once it asks to add the calendar.");
    onConnected?.("apple");
  }

  function snapshot() {
    downloadIcs(`balance-${user.nameKey}`, userFeedIcs(user));
    setHint("Downloaded. Import the file in your calendar app — that's a snapshot, not a live subscribe.");
    onConnected?.("snapshot");
  }

  const primary =
    platform === "ios" || platform === "mac"
      ? { label: `Subscribe on ${name}`, onClick: openApple }
      : platform === "android"
        ? { label: "Add in Google Calendar", href: google }
        : platform === "windows"
          ? { label: "Add in Outlook", href: outlook }
          : { label: "Add in Google Calendar", href: google };

  return (
    <div className={cn("space-y-4", compact && "space-y-3")}>
      <div>
        <p className={cn("font-medium text-[#e9edef]", compact ? "text-[15px]" : "text-lg")}>
          Connect {name} calendar
        </p>
        <p className="mt-1 text-[13px] leading-5 text-[#8696a0]">
          Browsers can’t silently write into Google, Apple, or Android calendars. Subscribe to your
          live Balance feed instead — locked events and open to-dos refresh about every 15 minutes.
        </p>
      </div>

      {"href" in primary ? (
        <a
          href={primary.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            const via = platform === "windows" ? "outlook" : "google";
            setHint(`Opened ${via === "outlook" ? "Outlook" : "Google Calendar"} to subscribe. You're connected once you confirm Add.`);
            onConnected?.(via);
          }}
          className="flex w-full items-center justify-center rounded-full bg-[#00a884] px-4 py-3 text-[15px] font-semibold text-[#111b21]"
        >
          {primary.label}
        </a>
      ) : (
        <button
          type="button"
          onClick={primary.onClick}
          className="flex w-full items-center justify-center rounded-full bg-[#00a884] px-4 py-3 text-[15px] font-semibold text-[#111b21]"
        >
          {primary.label}
        </button>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <OsLink
          href={google}
          title="Google Calendar"
          detail="Works on the web, Android, and Chromebooks"
          onClick={() => {
            setHint("Opened Google Calendar to subscribe. You're connected once you confirm Add.");
            onConnected?.("google");
          }}
        />
        <button
          type="button"
          onClick={openApple}
          className="rounded-xl border border-white/10 bg-[#202c33] px-3 py-3 text-left hover:bg-white/5"
        >
          <p className="text-[14px] font-medium text-[#e9edef]">Apple Calendar</p>
          <p className="text-[12px] text-[#8696a0]">iPhone, iPad, and Mac via webcal</p>
        </button>
        <OsLink
          href={outlook}
          title="Outlook"
          detail="Outlook on the web and Windows"
          onClick={() => {
            setHint("Opened Outlook to subscribe. You're connected once you confirm Add.");
            onConnected?.("outlook");
          }}
        />
        <button
          type="button"
          onClick={snapshot}
          className="rounded-xl border border-white/10 bg-[#202c33] px-3 py-3 text-left hover:bg-white/5"
        >
          <p className="flex items-center gap-2 text-[14px] font-medium text-[#e9edef]">
            <Download className="size-4" />
            Download .ics snapshot
          </p>
          <p className="text-[12px] text-[#8696a0]">One-time import if subscribe isn’t available</p>
        </button>
      </div>

      <div className="rounded-xl bg-[#202c33] p-3">
        <p className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-[#8696a0]">
          <Smartphone className="size-3.5" />
          Private feed URL
        </p>
        <p className="break-all text-[12px] text-[#e9edef]">{httpsUrl}</p>
        <button
          type="button"
          onClick={() => void copyFeed()}
          className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#53bdeb]"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy URL"}
        </button>
        <p className="mt-2 text-[12px] leading-5 text-[#8696a0]">
          Anyone with this URL can read your schedule. Don’t post it publicly. On Android you can
          also paste it in Google Calendar → Settings → Add calendar → From URL.
        </p>
      </div>

      {hint ? <p className="text-[13px] leading-5 text-[#00a884]">{hint}</p> : null}
    </div>
  );
}

function OsLink({
  href,
  title,
  detail,
  onClick,
}: {
  href: string;
  title: string;
  detail: string;
  onClick?: () => void;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className="rounded-xl border border-white/10 bg-[#202c33] px-3 py-3 text-left hover:bg-white/5"
    >
      <p className="text-[14px] font-medium text-[#e9edef]">{title}</p>
      <p className="text-[12px] text-[#8696a0]">{detail}</p>
    </a>
  );
}
