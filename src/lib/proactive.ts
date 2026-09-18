import { dailyDigest, dueReminders, unwindNudge } from "./bot";
import { upsertUser } from "./store";
import type { ChatMessage, UserRecord } from "./types";

/** Reminders, the morning digest and the evening nudge that are due right now; saved onto the user. */
export async function proactive(user: UserRecord): Promise<{ user: UserRecord; reminders: ChatMessage[] }> {
  const extra = dueReminders(user);
  const digest = dailyDigest(user);
  if (digest.message) extra.unshift(digest.message);
  const nudge = unwindNudge(user);
  if (nudge.message) extra.push(nudge.message);
  if (extra.length || nudge.patch) {
    const extraIds = new Set(user.remindedEventIds);
    for (const e of user.events) {
      if (extra.some((m) => m.text.includes(`*${e.title}*`))) {
        extraIds.add(e.id);
        extraIds.add(`pre:${e.id}`);
      }
    }
    const saved = await upsertUser({
      ...user,
      ...(digest.patch ?? {}),
      ...(nudge.patch ?? {}),
      messages: [...user.messages, ...extra],
      remindedEventIds: [...extraIds],
      updatedAt: new Date().toISOString(),
    });
    return { user: saved, reminders: extra };
  }
  return { user, reminders: [] };
}
