import { NextRequest, NextResponse } from "next/server";
import { beginChat, processTurn } from "@/lib/bot";
import { createWhatsAppUser, deleteUser, getUserByPhone, upsertUser } from "@/lib/store";
import { originFromRequest } from "@/lib/calendar";
import { deliver, incomingText, markRead, sendText, timezoneForPhone, waConfigured, type WaWebhook } from "@/lib/wa";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Meta calls this once when you save the webhook URL: echo the challenge if the verify token matches. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const expected = process.env.WA_VERIFY_TOKEN || "buffer-verify-2026";
  if (q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === expected) {
    return new NextResponse(q.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("forbidden", { status: 403 });
}

/** Every message someone sends the test number lands here. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as WaWebhook | null;
  if (!body || body.object !== "whatsapp_business_account") return NextResponse.json({ ok: true });
  const origin = originFromRequest(req);
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages?.length) continue; // delivery/read statuses: nothing to do
      const profileName = value.contacts?.[0]?.profile?.name;
      for (const message of value.messages) {
        try {
          await handle(message, profileName, origin);
        } catch (err) {
          console.warn("[buffer] whatsapp handle failed", err instanceof Error ? err.message : err);
        }
      }
    }
  }
  return NextResponse.json({ ok: true });
}

async function handle(message: Parameters<typeof incomingText>[0], profileName: string | undefined, origin: string) {
  const phone = message.from;
  if (!phone) return;
  let user = await getUserByPhone(phone);
  if (user?.waSeen?.includes(message.id)) return; // Meta retries webhooks; answer each message once
  await markRead(message.id);

  if (!user) {
    // First contact: WhatsApp already told us their name, so setup starts straight away.
    user = beginChat(await createWhatsAppUser(phone, profileName || "there", timezoneForPhone(phone)));
    user.waSeen = [message.id];
    user = await upsertUser(user);
    for (const m of user.messages.filter((m) => m.role === "bot")) await deliver(user, m, origin);
    const text = incomingText(message);
    if (!text || /^(hi|hello|hey|hii|start|yo|namaste)\b/i.test(text)) return;
    // They opened with something real ("9 to 5"); treat it as the first answer.
    const turn = await processTurn(user, text);
    user = await upsertUser({ ...turn.user, waSeen: [...(turn.user.waSeen ?? []), message.id].slice(-30) });
    for (const m of turn.replies) await deliver(user, m, origin);
    return;
  }

  const text = incomingText(message);
  if (!text) {
    await sendText(phone, "i can only read text for now. type it the way you'd say it.");
    return;
  }
  if (!waConfigured()) return;
  if (/^(delete|forget|erase) (my )?(data|everything|me)$/i.test(text.trim())) {
    await deleteUser(user.id);
    await sendText(phone, "done. everything i had about you is gone. if you message me again we start from scratch.");
    return;
  }
  const turn = await processTurn(user, text);
  const saved = await upsertUser({ ...turn.user, waSeen: [...(turn.user.waSeen ?? []), message.id].slice(-30) });
  for (const m of turn.replies) await deliver(saved, m, origin);
}
