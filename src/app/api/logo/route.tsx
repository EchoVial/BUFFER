import { ImageResponse } from "next/og";

export const dynamic = "force-static";

/**
 * Buffer's mark as a 640x640 PNG: the WhatsApp profile picture, and handy
 * anywhere else a square logo is needed. Same palette as the schedule
 * pictures: near-black, off-white, purple for the one thing that matters.
 */
export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 640,
          height: 640,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0b0b",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", gap: 22, marginBottom: 90 }}>
          {/* three bars: work, work, and the purple one you keep for people */}
          <div style={{ width: 70, height: 200, borderRadius: 18, background: "#4a4a4a" }} />
          <div style={{ width: 70, height: 290, borderRadius: 18, background: "#4a4a4a" }} />
          <div style={{ width: 70, height: 380, borderRadius: 18, background: "#8B84E8" }} />
        </div>
        <div style={{ position: "absolute", bottom: 64, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
          <span style={{ color: "#f2f2f2", fontSize: 72, fontWeight: 700, letterSpacing: -2 }}>Buffer</span>
        </div>
      </div>
    ),
    { width: 640, height: 640 },
  );
}
