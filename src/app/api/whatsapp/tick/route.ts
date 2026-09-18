import { NextRequest, NextResponse } from "next/server";
import { listUsers } from "@/lib/store";
import { proactive } from "@/lib/proactive";
import { originFromRequest } from "@/lib/calendar";
import { deliver, waConfigured } from "@/lib/wa";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Called every few minutes by a scheduler (the GitHub Action in .github/workflows/tick.yml).
 * Sends whatever is due to every WhatsApp user: event reminders, the morning digest,
 * the evening "you're off the clock" nudge. Idempotent: each has its own once-only guard.
 */
export async function GET(req: NextRequest) {
  if (!waConfigured()) return NextResponse.json({ ok: false, reason: "WA_TOKEN / WA_PHONE_ID not set" });
  const origin = originFromRequest(req);
  const users = (await listUsers()).filter((u) => u.waPhone);
  let sent = 0;
  for (const user of users) {
    try {
      const { user: saved, reminders } = await proactive(user);
      for (const m of reminders) {
        await deliver(saved, m, origin);
        sent++;
      }
    } catch (err) {
      console.warn("[buffer] tick failed for", user.id, err instanceof Error ? err.message : err);
    }
  }
  return NextResponse.json({ ok: true, users: users.length, sent });
}
