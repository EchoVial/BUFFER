import { NextRequest } from "next/server";
import { originFromRequest } from "@/lib/calendar";
import { exchangeCode, googleConfigured, googleEmail, plainPage, syncGoogle, verifyUser } from "@/lib/google";
import { getUserById, refreshStore, upsertUser, withLock } from "@/lib/store";
import { botText } from "@/lib/bot";
import { deliver } from "@/lib/wa";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Google sends them back here with a code; we keep the refresh token, mirror what they already have, and say so in the chat. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (!googleConfigured()) return plainPage("google calendar is not set up on this Buffer yet.", 503);
  if (q.get("error")) return plainPage("no problem, nothing was connected. you can close this.");
  const [userId = "", sig = ""] = (q.get("state") || "").split(".");
  const code = q.get("code");
  if (!code || !userId || !verifyUser(userId, sig)) return plainPage("that link is not valid.", 400);
  const origin = originFromRequest(req);
  const tokens = await exchangeCode(origin, code);
  if (!tokens?.refreshToken) return plainPage("google did not give me a lasting key. try the link again and tick every box it shows.", 502);
  const email = tokens.accessToken ? await googleEmail(tokens.accessToken) : undefined;

  // Same lock the WhatsApp webhook takes (keyed by phone), so a turn in flight cannot overwrite the token.
  const pre = await getUserById(userId);
  if (!pre) return plainPage("i don't know that person any more. say hi to Buffer again first.", 404);
  const saved = await withLock(pre.waPhone || userId, async () => {
    await refreshStore();
    const user = await getUserById(userId);
    if (!user) return undefined;
    const connected = {
      ...user,
      google: { refreshToken: tokens.refreshToken!, email, connectedAt: new Date().toISOString() },
      calendarConnectedAt: new Date().toISOString(),
      calendarConnectedVia: "google",
    };
    const synced = await syncGoogle(connected);
    const note = botText(`google calendar connected${email ? ` (${email})` : ""}. everything i save goes there now.`);
    return upsertUser({ ...synced, messages: [...synced.messages, note], updatedAt: new Date().toISOString() });
  });
  if (!saved) return plainPage("i don't know that person any more. say hi to Buffer again first.", 404);
  if (saved.waPhone) await deliver(saved, saved.messages[saved.messages.length - 1], origin);
  return plainPage(`connected${email ? ` as ${email}` : ""}. your plans from Buffer now land in google calendar. you can close this and go back to the chat.`);
}
