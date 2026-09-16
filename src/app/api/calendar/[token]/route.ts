import { NextRequest, NextResponse } from "next/server";
import { userFeedIcs } from "@/lib/calendar";
import { getUserByCalendarToken } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const user = await getUserByCalendarToken(token);
  if (!user) {
    return new NextResponse("Calendar feed not found.", { status: 404 });
  }
  const body = userFeedIcs(user);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="balance-${user.nameKey}.ics"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export async function HEAD(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const res = await GET(req, ctx);
  return new NextResponse(null, { status: res.status, headers: res.headers });
}
