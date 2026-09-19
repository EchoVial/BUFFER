import type { NextRequest } from "next/server";
import { GET as tick } from "../route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The same tick under a second path, because Vercel wants one path per cron:
 * 02:30 UTC is 8 am in India (the morning picture), 14:30 UTC is 8 pm (the
 * evening nudge). The 15-minute GitHub Action, when enabled, covers everyone else.
 */
export function GET(req: NextRequest) {
  return tick(req);
}
