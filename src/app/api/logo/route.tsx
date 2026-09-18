import { ImageResponse } from "next/og";

export const dynamic = "force-static";

const ACCENT = "#8B84E8";
const BG = "#0b0b0b";

/**
 * Buffer's mark as a 640x640 PNG: two purple square brackets on near-black,
 * nothing else. The space between them is the point.
 */
export async function GET() {
  const stroke = 44;
  const height = 330;
  const width = 118;
  const gap = 112;
  const bracket = (side: "left" | "right") => ({
    width,
    height,
    display: "flex",
    borderTop: `${stroke}px solid ${ACCENT}`,
    borderBottom: `${stroke}px solid ${ACCENT}`,
    ...(side === "left" ? { borderLeft: `${stroke}px solid ${ACCENT}` } : { borderRight: `${stroke}px solid ${ACCENT}` }),
  });
  return new ImageResponse(
    (
      <div style={{ width: 640, height: 640, display: "flex", alignItems: "center", justifyContent: "center", background: BG }}>
        <div style={bracket("left")} />
        <div style={{ width: gap, display: "flex" }} />
        <div style={bracket("right")} />
      </div>
    ),
    { width: 640, height: 640 },
  );
}
