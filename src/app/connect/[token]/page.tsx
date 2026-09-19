import type { Metadata } from "next";
import { headers } from "next/headers";
import { googleSubscribeUrl, icsHttpUrl, icsWebcalUrl, outlookSubscribeUrl } from "@/lib/calendar";
import { getUserByCalendarToken } from "@/lib/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Buffer · connect your calendar" };

const button: React.CSSProperties = {
  display: "block",
  padding: "16px 20px",
  borderRadius: 14,
  background: "#f2f2f2",
  color: "#0b0b0b",
  textDecoration: "none",
  fontWeight: 600,
  fontSize: 17,
  textAlign: "center",
};

/**
 * One tap from a WhatsApp link: subscribe Apple Calendar (or Google, Outlook)
 * to this person's Buffer feed. WhatsApp will not open webcal:// links itself,
 * so this https page does it.
 */
export default async function ConnectPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getUserByCalendarToken(token);
  const h = await headers();
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  const origin = `${proto}://${host}`;
  const ua = h.get("user-agent") || "";
  const apple = /iPhone|iPad|Macintosh/i.test(ua);
  return (
    <main style={{ minHeight: "100vh", background: "#0b0b0b", color: "#f2f2f2", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ fontSize: 56, color: "#8B84E8", fontWeight: 700, letterSpacing: -2, textAlign: "center" }}>[ ]</div>
        {!user ? (
          <p style={{ textAlign: "center", lineHeight: 1.5 }}>that link is not valid any more. ask Buffer for a new one with <b>connect calendar</b>.</p>
        ) : (
          <>
            <p style={{ textAlign: "center", lineHeight: 1.5, marginBottom: 28 }}>
              everything Buffer saves for you, as a calendar you subscribe to once. new plans show up on their own.
            </p>
            <div style={{ display: "grid", gap: 12 }}>
              <a style={{ ...button, background: apple ? "#8B84E8" : "#f2f2f2", color: apple ? "#0b0b0b" : "#0b0b0b" }} href={icsWebcalUrl(origin, token)}>
                Apple Calendar (iPhone, Mac)
              </a>
              <a style={button} href={googleSubscribeUrl(origin, token)}>
                Google Calendar
              </a>
              <a style={button} href={outlookSubscribeUrl(origin, token, "Buffer")}>
                Outlook
              </a>
            </div>
            <p style={{ color: "#9a9a9a", fontSize: 14, lineHeight: 1.5, marginTop: 24, textAlign: "center" }}>
              apple refreshes subscribed calendars about hourly; google only every day or so, which is why Buffer can also write to google directly (say <b>connect google</b>).
              <br />
              feed address, if you need it: <span style={{ wordBreak: "break-all" }}>{icsHttpUrl(origin, token)}</span>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
