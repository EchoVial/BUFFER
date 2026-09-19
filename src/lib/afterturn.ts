import { syncGoogle } from "./google";
import { upsertUser } from "./store";
import type { UserRecord } from "./types";

/** Save a finished turn and mirror the events into Google Calendar when it is connected. */
export async function saveTurn(user: UserRecord): Promise<UserRecord> {
  const saved = await upsertUser(user);
  if (!saved.google) return saved;
  const synced = await syncGoogle(saved);
  return synced.googleSynced === saved.googleSynced ? saved : upsertUser(synced);
}
