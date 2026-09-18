"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Download, Smartphone } from "lucide-react";
import {
  detectCalendarPlatform,
  downloadIcs,
  googleSubscribeUrl,
  icsHttpUrl,
  icsWebcalUrl,
  isPublicHttpsOrigin,
  outlookEventUrl,
  outlookLiveSubscribeUrl,
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
  storage,
}: {
  user: UserRecord;
  origin: string;
  compact?: boolean;
  onConnected?: (via: "google" | "apple" | "outlook" | "copy" | "snapshot") => void;
  /** "kv" | "file" | "memory": where the server keeps users; a memory server forgets the feed on restart. */
  storage?: string;
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
      <p className="text-sm text-(--wa-muted)">
        Sign in through chat first so we can mint a private calendar feed for you.
      </p>
    );
  }

  const httpsUrl = icsHttpUrl(origin, token);
  const webcal = icsWebcalUrl(origin, token);
  const google = googleSubscribeUrl(origin, token);
  const calName = `Buffer — ${user.name}`;
  const outlook = outlookSubscribeUrl(origin, token, calName);
  const outlookLive = outlookLiveSubscribeUrl(origin, token, calName);
  const lastEvent = user.events[user.events.length - 1];
  const name = platformLabel(platform);
  const publicHttps = isPublicHttpsOrigin(origin);

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
    downloadIcs(`buffer-${user.nameKey}`, userFeedIcs(user));
    setHint("Downloaded. Import the file in your calendar app — that's a snapshot, not a live subscribe.");
    onConnected?.("snapshot");
  }

  function openOutlook() {
    const latest = lastEvent;
    if (publicHttps) {
      window.open(outlook, "_blank", "noopener,noreferrer");
      window.setTimeout(() => {
        window.open(outlookLive, "_blank", "noopener,noreferrer");
      }, 400);
      setHint("Opened Outlook’s add-from-web screen. Sign in if asked, then confirm Subscribe.");
      onConnected?.("outlook");
      return;
    }
    void copyFeed();
    snapshot();
    if (latest) {
      window.open(outlookEventUrl(latest), "_blank", "noopener,noreferrer");
    }
    setHint(
      "Outlook can’t subscribe to a local http address. I copied the feed URL, downloaded an .ics, and opened Outlook to add your latest event. After Buffer is on https, tap Outlook again to subscribe to the live feed.",
    );
    onConnected?.("outlook");
  }

  const primary =
    platform === "ios" || platform === "mac"
      ? { label: `Subscribe on ${name}`, onClick: openApple }
      : platform === "android"
        ? { label: "Add in Google Calendar", href: google }
        : platform === "windows"
          ? { label: "Add in Outlook", onClick: openOutlook }
          : { label: "Add in Google Calendar", href: google };

  return (
    <div className={cn("space-y-4", compact && "space-y-3")}>
      <div>
        <p className={cn("font-medium text-(--wa-text)", compact ? "text-[15px]" : "text-lg")}>
          Connect {name} calendar
        </p>
        <p className="mt-1 text-[13px] leading-5 text-(--wa-muted)">
          Browsers can&apos;t silently write into Google, Apple, or Android calendars. Subscribe to your
          live Buffer feed instead. Calendar apps refresh subscribed feeds on their own schedule, usually
          every few hours, so for one event right now use the Add to Google Cal button in the chat.
        </p>
        {storage === "memory" ? (
          <p className="mt-2 rounded-md bg-(--wa-bar) px-3 py-2 text-[12px] leading-5 text-(--wa-muted)">
            This deployment has no database yet, so the live feed goes blank whenever the server restarts.
            Per-event Add to Google Cal always works. To make the feed reliable, add a Redis store in
            Vercel (Storage tab, Upstash, free) and redeploy.
          </p>
        ) : null}
      </div>

      {"href" in primary ? (
        <a
          href={primary.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            const via = platform === "windows" ? "outlook" : "google";
            if (via === "outlook") {
              openOutlook();
              return;
            }
            setHint(`Opened Google Calendar to subscribe. You're connected once you confirm Add.`);
            onConnected?.(via);
          }}
          className="flex w-full items-center justify-center rounded-full bg-(--wa-accent) px-4 py-3 text-[15px] font-semibold text-(--wa-accent-ink)"
        >
          {primary.label}
        </a>
      ) : (
        <button
          type="button"
          onClick={primary.onClick}
          className="flex w-full items-center justify-center rounded-full bg-(--wa-accent) px-4 py-3 text-[15px] font-semibold text-(--wa-accent-ink)"
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
          className="rounded-xl border border-(--wa-divider) bg-(--wa-bar) px-3 py-3 text-left hover:bg-(--wa-hover)"
        >
          <p className="text-[14px] font-medium text-(--wa-text)">Apple Calendar</p>
          <p className="text-[12px] text-(--wa-muted)">iPhone, iPad, and Mac via webcal</p>
        </button>
        <button
          type="button"
          onClick={openOutlook}
          className="rounded-xl border border-(--wa-divider) bg-(--wa-bar) px-3 py-3 text-left hover:bg-(--wa-hover)"
        >
          <p className="text-[14px] font-medium text-(--wa-text)">Outlook</p>
          <p className="text-[12px] text-(--wa-muted)">
            {publicHttps
              ? "Outlook.com and Microsoft 365 subscribe-from-web"
              : "Adds the latest event + .ics (live subscribe needs https)"}
          </p>
        </button>
        <button
          type="button"
          onClick={snapshot}
          className="rounded-xl border border-(--wa-divider) bg-(--wa-bar) px-3 py-3 text-left hover:bg-(--wa-hover)"
        >
          <p className="flex items-center gap-2 text-[14px] font-medium text-(--wa-text)">
            <Download className="size-4" />
            Download .ics snapshot
          </p>
          <p className="text-[12px] text-(--wa-muted)">One-time import if subscribe isn’t available</p>
        </button>
      </div>

      <div className="rounded-xl bg-(--wa-bar) p-3">
        <p className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-(--wa-muted)">
          <Smartphone className="size-3.5" />
          Private feed URL
        </p>
        <p className="break-all text-[12px] text-(--wa-text)">{httpsUrl}</p>
        <button
          type="button"
          onClick={() => void copyFeed()}
          className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-(--wa-link)"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy URL"}
        </button>
        <p className="mt-2 text-[12px] leading-5 text-(--wa-muted)">
          Anyone with this URL can read your schedule. Don’t post it publicly. On Android you can
          also paste it in Google Calendar → Settings → Add calendar → From URL. In Outlook: Add
          calendar → Subscribe from web → paste this HTTPS .ics URL.
        </p>
      </div>

      {hint ? <p className="text-[13px] leading-5 text-(--wa-accent)">{hint}</p> : null}
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
      className="rounded-xl border border-(--wa-divider) bg-(--wa-bar) px-3 py-3 text-left hover:bg-(--wa-hover)"
    >
      <p className="text-[14px] font-medium text-(--wa-text)">{title}</p>
      <p className="text-[12px] text-(--wa-muted)">{detail}</p>
    </a>
  );
}
