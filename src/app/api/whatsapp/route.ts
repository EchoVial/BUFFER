import { NextRequest, NextResponse, after } from "next/server";
import { beginChat, processTurn } from "@/lib/bot";
import { createWhatsAppUser, deleteUser, getUserByPhone, refreshStore, upsertUser, withLock } from "@/lib/store";
import { saveTurn } from "@/lib/afterturn";
import { originFromRequest } from "@/lib/calendar";
import { deliver, incomingText, markRead, sendContact, sendText, timezoneForPhone, waConfigured, type WaWebhook } from "@/lib/wa";

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

/**
 * Every message someone sends the test number lands here. Meta wants a 200
 * within a few seconds and retries (then backs off) when it does not get one,
 * so the answer is sent first and the thinking happens after the response.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as WaWebhook | null;
  if (!body || body.object !== "whatsapp_business_account") return NextResponse.json({ ok: true });
  const origin = originFromRequest(req);
  const work: Array<{ message: WaMessage; profileName?: string }> = [];
  let statuses = 0;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      statuses += value?.statuses?.length ?? 0;
      if (!value?.messages?.length) continue; // delivery/read statuses: nothing to do
      const profileName = value.contacts?.[0]?.profile?.name;
      for (const message of value.messages) work.push({ message, profileName });
    }
  }
  console.log(`[buffer] wa webhook: ${work.length} message(s), ${statuses} status(es)`);
  if (work.length) {
    after(async () => {
      for (const { message, profileName } of work) {
        try {
          if (!message.from) continue;
          // One turn at a time per person: Meta may deliver a backlog as parallel calls.
          await withLock(message.from, async () => {
            await refreshStore();
            await handle(message, profileName, origin);
          });
        } catch (err) {
          console.warn("[buffer] whatsapp handle failed", err instanceof Error ? err.message : err);
        }
      }
    });
  }
  return NextResponse.json({ ok: true });
}

type WaMessage = Parameters<typeof incomingText>[0];

/** Send the bubbles of one turn in order, with a beat between them so it reads like a person, not a burst. */
async function sendAll(user: Parameters<typeof deliver>[0], msgs: Parameters<typeof deliver>[1][], origin: string) {
  for (let i = 0; i < msgs.length; i++) {
    if (i) await new Promise((r) => setTimeout(r, msgs[i - 1].card?.type === "image" ? 1200 : 450));
    await deliver(user, msgs[i], origin);
  }
}

async function handle(message: WaMessage, profileName: string | undefined, origin: string) {
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
    await sendAll(user, user.messages.filter((m) => m.role === "bot"), origin);
    // The test number shows as digits until it is saved; hand them the card to save.
    await new Promise((r) => setTimeout(r, 450));
    await sendText(phone, "save this so the chat says *Buffer* instead of the number.");
    await sendContact(phone, origin);
    const text = incomingText(message);
    if (!text || /^(hi|hello|hey|hii|start|yo|namaste)\b/i.test(text)) return;
    // They opened with something real ("9 to 5"); treat it as the first answer.
    const turn = await processTurn(user, text);
    user = await saveTurn({ ...turn.user, waSeen: [...(turn.user.waSeen ?? []), message.id].slice(-30) });
    await sendAll(user, turn.replies, origin);
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
  const saved = await saveTurn({ ...turn.user, waSeen: [...(turn.user.waSeen ?? []), message.id].slice(-30) });
  await sendAll(saved, turn.replies, origin);
}
