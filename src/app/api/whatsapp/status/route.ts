import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Plumbing check for the WhatsApp side, using the server's own token so nobody
 * has to paste it anywhere else:
 *   GET /api/whatsapp/status              what Meta says about the number and the app subscription
 *   GET /api/whatsapp/status?subscribe=1  subscribe this app to the WhatsApp Business Account
 *   (add &waba=<id> when the account id cannot be discovered from the token)
 *                                         (Cloud API only delivers webhooks to subscribed apps)
 * Nothing secret is returned.
 */
export async function GET(req: NextRequest) {
  const token = process.env.WA_TOKEN;
  const phoneId = process.env.WA_PHONE_ID;
  if (!token || !phoneId) return NextResponse.json({ ok: false, reason: "WA_TOKEN / WA_PHONE_ID not set" });
  const headers = { Authorization: `Bearer ${token}` };
  const out: Record<string, unknown> = { ok: true, phoneId };

  const phone = await fetch(`${GRAPH}/${phoneId}?fields=display_phone_number,verified_name,quality_rating,platform_type`, { headers });
  out.phone = phone.ok ? await phone.json() : { error: phone.status, body: (await phone.text()).slice(0, 300) };

  // The WABA that owns this number, then whether our app is subscribed to it.
  const waba = req.nextUrl.searchParams.get("waba") || process.env.WA_WABA_ID || (await wabaFor(phoneId, headers));
  out.wabaId = waba ?? null;
  if (waba) {
    if (req.nextUrl.searchParams.get("subscribe")) {
      const sub = await fetch(`${GRAPH}/${waba}/subscribed_apps`, { method: "POST", headers });
      out.subscribeResult = sub.ok ? await sub.json() : { error: sub.status, body: (await sub.text()).slice(0, 300) };
    }
    const subs = await fetch(`${GRAPH}/${waba}/subscribed_apps`, { headers });
    out.subscribedApps = subs.ok ? await subs.json() : { error: subs.status, body: (await subs.text()).slice(0, 300) };
  }
  return NextResponse.json(out);
}

async function wabaFor(phoneId: string, headers: Record<string, string>): Promise<string | undefined> {
  // debug_token on our own token lists the WABA ids it was granted; the phone belongs to one of them.
  const me = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(process.env.WA_TOKEN || "")}`, { headers });
  if (!me.ok) return undefined;
  const data = (await me.json()) as { data?: { granular_scopes?: Array<{ scope: string; target_ids?: string[] }> } };
  const ids = new Set<string>();
  for (const s of data.data?.granular_scopes ?? []) for (const id of s.target_ids ?? []) ids.add(id);
  for (const id of ids) {
    const r = await fetch(`${GRAPH}/${id}/phone_numbers?fields=id`, { headers });
    if (!r.ok) continue;
    const d = (await r.json()) as { data?: Array<{ id: string }> };
    if (d.data?.some((p) => p.id === phoneId)) return id;
  }
  return [...ids][0];
}
