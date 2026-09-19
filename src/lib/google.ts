import { createHmac, timingSafeEqual } from "node:crypto";
import type { CalendarEvent, UserRecord } from "./types";
import { hmToMinutes, minutesToHM } from "./time";

/**
 * Google Calendar, written to directly. Once someone connects (OAuth, offline
 * access), every plan Buffer saves is mirrored into their primary calendar,
 * and edits and undos follow. Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, with
 * `<origin>/api/google/callback` registered as a redirect URI on that client.
 */

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const API = "https://www.googleapis.com/calendar/v3";

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** A signature over the user id, so the connect link cannot be pointed at someone else's record. */
export function signUser(userId: string): string {
  return createHmac("sha256", process.env.GOOGLE_CLIENT_SECRET || process.env.WA_VERIFY_TOKEN || "buffer").update(userId).digest("base64url").slice(0, 24);
}

export function verifyUser(userId: string, sig: string): boolean {
  const a = Buffer.from(signUser(userId));
  const b = Buffer.from(sig || "");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The link the bot hands out; it redirects to Google's consent screen. */
export function googleConnectUrl(origin: string, userId: string): string {
  return `${origin.replace(/\/$/, "")}/api/google/connect?u=${encodeURIComponent(userId)}&s=${signUser(userId)}`;
}

export function googleConsentUrl(origin: string, userId: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: `${origin.replace(/\/$/, "")}/api/google/callback`,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: `${userId}.${signUser(userId)}`,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(origin: string, code: string): Promise<{ refreshToken?: string; accessToken?: string } | undefined> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: `${origin.replace(/\/$/, "")}/api/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    console.warn("[buffer] google code exchange failed", res.status, (await res.text()).slice(0, 300));
    return undefined;
  }
  const data = (await res.json()) as { refresh_token?: string; access_token?: string };
  return { refreshToken: data.refresh_token, accessToken: data.access_token };
}

async function accessToken(refreshToken: string): Promise<string | undefined> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    console.warn("[buffer] google token refresh failed", res.status, (await res.text()).slice(0, 300));
    return undefined;
  }
  return ((await res.json()) as { access_token?: string }).access_token;
}

/** Who the connected account is, for the confirmation line. */
export async function googleEmail(token: string): Promise<string | undefined> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
  if (!res?.ok) return undefined;
  return ((await res.json()) as { email?: string }).email;
}

const fingerprint = (e: CalendarEvent) => [e.title, e.date, e.start, e.durationMinutes, e.kind, e.starred ? 1 : 0].join("|");

function body(e: CalendarEvent, tz: string) {
  const endMin = hmToMinutes(e.start) + e.durationMinutes;
  const endDate = endMin >= 24 * 60 ? nextDay(e.date) : e.date;
  return {
    summary: e.starred ? `★ ${e.title}` : e.title,
    description: `Buffer · ${e.kind}`,
    start: { dateTime: `${e.date}T${e.start}:00`, timeZone: tz },
    end: { dateTime: `${endDate}T${minutesToHM(endMin % (24 * 60))}:00`, timeZone: tz },
    extendedProperties: { private: { buffer: e.id } },
    reminders: { useDefault: false, overrides: [] },
  };
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Bring Google in line with the user's events: insert new ones, patch changed
 * ones, delete the ones that are gone. Returns the user with the sync map
 * updated (the caller saves). Quiet on failure; the chat never waits on Google.
 */
export async function syncGoogle(user: UserRecord): Promise<UserRecord> {
  if (!user.google?.refreshToken || !googleConfigured()) return user;
  const token = await accessToken(user.google.refreshToken);
  if (!token) return user;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const tz = user.settings.timezone || "UTC";
  const synced: Record<string, { gid: string; hash: string }> = { ...(user.googleSynced ?? {}) };
  const live = new Set(user.events.map((e) => e.id));

  for (const e of user.events) {
    const hash = fingerprint(e);
    const have = synced[e.id];
    if (have && have.hash === hash) continue;
    try {
      if (have) {
        const res = await fetch(`${API}/calendars/primary/events/${encodeURIComponent(have.gid)}`, { method: "PATCH", headers, body: JSON.stringify(body(e, tz)) });
        if (res.ok) synced[e.id] = { gid: have.gid, hash };
        else if (res.status === 404 || res.status === 410) delete synced[e.id]; // recreate next pass
        else console.warn("[buffer] google patch failed", res.status);
      } else {
        const res = await fetch(`${API}/calendars/primary/events`, { method: "POST", headers, body: JSON.stringify(body(e, tz)) });
        if (res.ok) synced[e.id] = { gid: ((await res.json()) as { id: string }).id, hash };
        else console.warn("[buffer] google insert failed", res.status, (await res.text()).slice(0, 200));
      }
    } catch (err) {
      console.warn("[buffer] google sync error", err instanceof Error ? err.message : err);
    }
  }
  for (const [id, { gid }] of Object.entries(synced)) {
    if (live.has(id)) continue;
    try {
      const res = await fetch(`${API}/calendars/primary/events/${encodeURIComponent(gid)}`, { method: "DELETE", headers });
      if (res.ok || res.status === 404 || res.status === 410) delete synced[id];
    } catch {
      /* next pass */
    }
  }
  return { ...user, googleSynced: synced };
}

/** Forget Google: drop the token (events already in the calendar stay there). */
export function disconnectGoogle(user: UserRecord): UserRecord {
  const next = { ...user };
  delete next.google;
  delete next.googleSynced;
  return next;
}

/** A one-line page in Buffer's colours for the browser tab the connect flow ends in. */
export function plainPage(message: string, status = 200): Response {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Buffer</title>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b0b;color:#f2f2f2;font:18px/1.5 system-ui,sans-serif;text-align:center;padding:24px">
<div><div style="font-size:64px;color:#8B84E8;font-weight:700;letter-spacing:-2px">[ ]</div><p style="max-width:32ch">${message}</p></div></body>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
