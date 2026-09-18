import { NextRequest, NextResponse } from "next/server";
import { originFromRequest } from "@/lib/calendar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Plumbing check for the WhatsApp side, using the server's own token so nobody
 * has to paste it anywhere else. Nothing secret is returned.
 *   GET /api/whatsapp/status                the number, Meta's health verdict, app subscription
 *   GET /api/whatsapp/status?subscribe=1    subscribe this app to the WhatsApp Business Account
 *   GET /api/whatsapp/status?ping=<digits>  send a one-line text to that number and show Meta's answer
 *   GET /api/whatsapp/status?profile=1      set the number's profile: Buffer's logo, about, description, website
 *   (add &waba=<id> when the account id cannot be discovered from the token)
 */
export async function GET(req: NextRequest) {
  const token = process.env.WA_TOKEN;
  const phoneId = process.env.WA_PHONE_ID;
  if (!token || !phoneId) return NextResponse.json({ ok: false, reason: "WA_TOKEN / WA_PHONE_ID not set" });
  const headers = { Authorization: `Bearer ${token}` };
  const q = req.nextUrl.searchParams;
  const out: Record<string, unknown> = { ok: true, phoneId };

  const phone = await fetch(
    `${GRAPH}/${phoneId}?fields=display_phone_number,verified_name,name_status,status,quality_rating,messaging_limit_tier,platform_type,account_mode,code_verification_status,throughput`,
    { headers },
  );
  out.phone = phone.ok ? await phone.json() : { error: phone.status, body: (await phone.text()).slice(0, 300) };

  // Meta's own verdict on whether this number can send right now, with the reason per entity when it cannot.
  const health = await fetch(`${GRAPH}/${phoneId}?fields=health_status`, { headers });
  out.health = health.ok
    ? ((await health.json()) as { health_status?: unknown }).health_status
    : { error: health.status, body: (await health.text()).slice(0, 300) };

  const profile = await fetch(`${GRAPH}/${phoneId}/whatsapp_business_profile?fields=about,description,websites,vertical,profile_picture_url`, { headers });
  out.profile = profile.ok ? await profile.json() : { error: profile.status, body: (await profile.text()).slice(0, 300) };

  // The WABA that owns this number, then whether our app is subscribed to it.
  const waba = q.get("waba") || process.env.WA_WABA_ID || (await wabaFor(phoneId, headers));
  out.wabaId = waba ?? null;
  if (waba) {
    if (q.get("subscribe")) {
      const sub = await fetch(`${GRAPH}/${waba}/subscribed_apps`, { method: "POST", headers });
      out.subscribeResult = sub.ok ? await sub.json() : { error: sub.status, body: (await sub.text()).slice(0, 300) };
    }
    const subs = await fetch(`${GRAPH}/${waba}/subscribed_apps`, { headers });
    out.subscribedApps = subs.ok ? await subs.json() : { error: subs.status, body: (await subs.text()).slice(0, 300) };
  }

  const ping = q.get("ping")?.replace(/\D/g, "");
  if (ping) {
    const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: ping,
        type: "text",
        text: { body: "ping from buffer. if you can read this, the line is open." },
      }),
    });
    out.ping = { status: res.status, body: (await res.text()).slice(0, 600) };
  }

  if (q.get("profile")) out.profileResult = await setProfile(phoneId, token, originFromRequest(req));

  return NextResponse.json(out);
}

/** Logo, about line, description and website on the number's WhatsApp profile (the name itself is Meta's to set). */
async function setProfile(phoneId: string, token: string, origin: string): Promise<unknown> {
  const appId = await appIdFor(token);
  if (!appId) return { error: "could not read the app id from the token" };
  const png = await fetch(`${origin}/api/logo`);
  if (!png.ok) return { error: `logo fetch ${png.status}` };
  const bytes = Buffer.from(await png.arrayBuffer());

  // Resumable Upload API: open a session for the file, send the bytes, get back a handle for the profile.
  const open = await fetch(`${GRAPH}/${appId}/uploads?file_name=buffer-logo.png&file_length=${bytes.length}&file_type=image/png`, {
    method: "POST",
    headers: { Authorization: `OAuth ${token}` },
  });
  if (!open.ok) return { step: "open upload", error: open.status, body: (await open.text()).slice(0, 400) };
  const { id } = (await open.json()) as { id: string };
  const up = await fetch(`${GRAPH}/${id}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${token}`, file_offset: "0", "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  if (!up.ok) return { step: "upload bytes", error: up.status, body: (await up.text()).slice(0, 400) };
  const { h } = (await up.json()) as { h: string };

  const res = await fetch(`${GRAPH}/${phoneId}/whatsapp_business_profile`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      profile_picture_handle: h,
      about: "keeps your evenings for people, not just work.",
      description:
        "Buffer is a small assistant that learns when you work, shows you when you are free, and nudges you to spend some of it with friends and family. Say hi to start.",
      vertical: "OTHER",
      websites: [origin],
    }),
  });
  return { status: res.status, body: (await res.text()).slice(0, 400), bytes: bytes.length };
}

type TokenInfo = { app_id?: string; granular_scopes?: Array<{ scope: string; target_ids?: string[] }> };

async function debugToken(token: string): Promise<TokenInfo | undefined> {
  const me = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!me.ok) return undefined;
  return ((await me.json()) as { data?: TokenInfo }).data;
}

async function appIdFor(token: string): Promise<string | undefined> {
  return process.env.WA_APP_ID || (await debugToken(token))?.app_id;
}

async function wabaFor(phoneId: string, headers: Record<string, string>): Promise<string | undefined> {
  // debug_token on our own token lists the WABA ids it was granted; the phone belongs to one of them.
  const data = await debugToken(process.env.WA_TOKEN || "");
  const ids = new Set<string>();
  for (const s of data?.granular_scopes ?? []) for (const id of s.target_ids ?? []) ids.add(id);
  for (const id of ids) {
    const r = await fetch(`${GRAPH}/${id}/phone_numbers?fields=id`, { headers });
    if (!r.ok) continue;
    const d = (await r.json()) as { data?: Array<{ id: string }> };
    if (d.data?.some((p) => p.id === phoneId)) return id;
  }
  return [...ids][0];
}
