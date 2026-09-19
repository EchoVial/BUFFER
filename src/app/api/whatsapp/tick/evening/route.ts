import type { NextRequest } from "next/server";
import { GET as tick } from "../route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The same tick under a second path, because Vercel wants one path per cron:
 * 02:30 UTC is 8 am in India (the morning picture), 15:30 UTC is 9 pm (the
 * evening nudge, whose window is three hours after switch-off, so 6 to 9 pm
 * switch-offs are all caught). The 15-minute GitHub Action, when enabled, covers everyone else.
 */
export function GET(req: NextRequest) {
  return tick(req);
}
