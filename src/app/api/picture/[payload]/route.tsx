import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import type { ImageCard } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The day and week pictures as PNG, for WhatsApp (which cannot show our live SVG).
 * The card travels base64url-encoded in the URL, so the image needs no store lookup.
 * Same monochrome look as the chat: greys for structure, purple for saved blocks.
 */

const W = 800;
const INK = "#f2f2f2";
const MUTED = "#9a9a9a";
const BG = "#101010";
const FREE = "#e8e8e8";
const WORK = "#4a4a4a";
const BLOCK = "#5c5c5c";
const BLOCK_DIM = "#333333";
const ACCENT = "#8B84E8";

const clock = (min: number) => {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h = h24 % 12 || 12;
  return `${h}${m ? `:${String(m).padStart(2, "0")}` : ""}${h24 >= 12 ? "pm" : "am"}`;
};
const clockRange = (a: number, b: number) => {
  const sameHalf = Math.floor(a / 60) % 24 >= 12 === Math.floor(b / 60) % 24 >= 12;
  const left = sameHalf ? clock(a).replace(/am|pm$/, "") : clock(a);
  return `${left} to ${clock(b)}`;
};
const blockColor = (b: { kind: string; movable?: boolean; id?: string }) => (b.movable && b.id ? ACCENT : b.kind === "todo" ? BLOCK_DIM : b.kind === "work" ? WORK : BLOCK);
const kindWord = (k: string) => (k === "work" ? "work" : k === "social" ? "people" : k === "health" ? "health" : k === "personal" ? "you" : k === "todo" ? "to-do" : "");

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 40, color: INK }}>{title}</div>
        <div style={{ fontSize: 24, color: MUTED, marginTop: 4 }}>{subtitle}</div>
      </div>
      <div style={{ fontSize: 22, color: MUTED, letterSpacing: 1 }}>Buffer</div>
    </div>
  );
}

function DayCard({ card }: { card: Extract<ImageCard, { variant: "day" }> }) {
  const pad = 40;
  const lane = W - pad * 2;
  const from = card.fromMin;
  const to = card.toMin;
  const x = (m: number) => ((Math.min(Math.max(m, from), to) - from) / (to - from)) * lane;
  const blocks = card.blocks.filter((b) => b.endMin > from && b.startMin < to && b.kind !== "free" && b.kind !== "sleep").sort((a, b) => a.startMin - b.startMin);
  const rows = blocks.slice(0, 6);
  const ticks: number[] = [];
  for (let m = Math.ceil(from / 180) * 180; m <= to; m += 180) ticks.push(m);
  const dupTitle = (b: { title: string; id?: string }) => blocks.some((o) => o.title === b.title && o.id && o !== b);
  const movable = blocks.some((b) => b.movable && b.id);
  return (
    <div style={{ width: W, height: dayHeight(card), background: BG, display: "flex", flexDirection: "column", padding: pad, color: INK, fontFamily: "Noto Sans" }}>
      <Header title={card.title} subtitle={card.subtitle} />
      <div style={{ position: "relative", display: "flex", width: lane, height: 84, marginTop: 30, background: "rgba(255,255,255,0.06)", borderRadius: 16 }}>
        {blocks.map((b, i) => {
          if (b.endMin <= from || b.startMin >= to) return null; // outside the strip; still listed below
          const hi = card.highlight && b.title === card.highlight && (b.id || !dupTitle(b));
          const reserved = b.kind === "reserved";
          const left = x(Math.max(from, b.startMin));
          const width = Math.max(8, x(Math.min(to, b.endMin)) - left - 4);
          return (
            <div
              key={`${b.title}-${i}`}
              style={{
                position: "absolute",
                left: left + 2,
                top: 10,
                width,
                height: 64,
                borderRadius: 10,
                background: reserved ? "#1a1a1a" : blockColor(b),
                display: "flex",
                border: hi ? `4px solid ${INK}` : reserved ? `3px solid ${ACCENT}` : b.kind === "todo" ? "2px dashed #7a7a7a" : "none",
              }}
            />
          );
        })}
        {card.nowMin !== undefined && card.nowMin >= from && card.nowMin <= to ? <div style={{ position: "absolute", left: x(card.nowMin) - 2, top: -10, width: 4, height: 104, background: INK, borderRadius: 2, display: "flex" }} /> : null}
      </div>
      <div style={{ position: "relative", display: "flex", width: lane, height: 34, marginTop: 8 }}>
        {ticks.map((m) => (
          <div key={m} style={{ position: "absolute", left: x(m) - 40, width: 80, display: "flex", justifyContent: "center", fontSize: 21, color: MUTED }}>
            {clock(m)}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 26 }}>
        {rows.length === 0 ? <div style={{ fontSize: 26, color: MUTED, display: "flex" }}>nothing on yet</div> : null}
        {rows.map((b, i) => {
          const hi = card.highlight && b.title === card.highlight && (b.id || !dupTitle(b));
          const title = b.title.length > 26 ? `${b.title.slice(0, 25)}…` : b.title;
          return (
            <div key={`${b.title}-${i}-row`} style={{ display: "flex", alignItems: "center", height: 56 }}>
              <div style={{ width: 18, height: 18, borderRadius: 9, background: blockColor(b), display: "flex", border: b.kind === "todo" ? "2px solid #7a7a7a" : "none" }} />
              <div style={{ width: 250, marginLeft: 16, fontSize: 24, color: MUTED, display: "flex" }}>{clockRange(b.startMin, b.endMin)}</div>
              <div style={{ flex: 1, fontSize: 27, color: INK, display: "flex" }}>{title}</div>
              <div style={{ fontSize: 22, color: hi ? ACCENT : MUTED, display: "flex" }}>{hi ? "new" : kindWord(b.kind)}</div>
            </div>
          );
        })}
        {blocks.length > rows.length ? <div style={{ fontSize: 24, color: MUTED, display: "flex", marginLeft: 34 }}>+{blocks.length - rows.length} more</div> : null}
      </div>
      <div style={{ display: "flex", flex: 1 }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 18 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {movable ? <div style={{ width: 18, height: 18, borderRadius: 4, background: ACCENT, display: "flex", marginRight: 12 }} /> : null}
          <div style={{ fontSize: 22, color: MUTED, display: "flex" }}>{movable ? "purple: your plans. text me to move one" : ""}</div>
        </div>
        <div style={{ fontSize: 25, color: INK, display: "flex" }}>{card.footer}</div>
      </div>
    </div>
  );
}

function dayHeight(card: Extract<ImageCard, { variant: "day" }>): number {
  const n = card.blocks.filter((b) => b.kind !== "free" && b.kind !== "sleep").length;
  const rows = Math.max(1, Math.min(6, n) + (n > 6 ? 1 : 0));
  return 316 + rows * 56 + 96;
}

const WEEK_H = 472;

function WeekCard({ card }: { card: Extract<ImageCard, { variant: "week" }> }) {
  const pad = 40;
  const chartH = 220;
  const maxMin = Math.max(6 * 60, ...card.days.map((d) => d.freeMinutes + d.workMinutes + (d.goneMinutes ?? 0)));
  // The part of today already behind you: dim with slanted marks, so today stands as tall as the other days.
  const gone = { backgroundColor: BLOCK_DIM, backgroundImage: `repeating-linear-gradient(135deg, ${MUTED}55 0px, ${MUTED}55 3px, transparent 3px, transparent 10px)` };
  return (
    <div style={{ width: W, height: WEEK_H, background: BG, display: "flex", flexDirection: "column", padding: pad, color: INK, fontFamily: "Noto Sans" }}>
      <Header title={card.title} subtitle={card.subtitle} />
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginTop: 14, fontSize: 21, color: MUTED }}>
        <div style={{ width: 16, height: 16, borderRadius: 4, background: FREE, display: "flex", marginRight: 8 }} />
        <div style={{ display: "flex", marginRight: 22 }}>free</div>
        <div style={{ width: 16, height: 16, borderRadius: 4, background: WORK, display: "flex", marginRight: 8 }} />
        <div style={{ display: "flex" }}>work</div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", height: chartH, marginTop: 10, borderBottom: "1px solid rgba(255,255,255,0.15)" }}>
        {card.days.map((d) => {
          const freeH = Math.round((d.freeMinutes / maxMin) * chartH);
          const workH = Math.round((d.workMinutes / maxMin) * chartH);
          const goneH = Math.round(((d.goneMinutes ?? 0) / maxMin) * chartH);
          return (
            <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: chartH }}>
              <div style={{ width: "58%", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                {goneH > 0 ? <div style={{ height: Math.max(3, goneH), ...gone, borderRadius: 6, display: "flex", marginBottom: 2 }} /> : null}
                {freeH > 0 ? <div style={{ height: Math.max(3, freeH), background: FREE, borderRadius: 6, display: "flex" }} /> : null}
                {workH > 0 ? <div style={{ height: Math.max(3, workH), background: WORK, borderRadius: 6, display: "flex", marginTop: 2 }} /> : null}
                {!d.freeMinutes && !d.workMinutes && !d.goneMinutes ? <div style={{ height: 4, background: "rgba(255,255,255,0.15)", borderRadius: 2, display: "flex" }} /> : null}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", marginTop: 12 }}>
        {card.days.map((d) => (
          <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ fontSize: 23, color: INK, display: "flex" }}>{d.label}</div>
            {d.today ? <div style={{ width: 6, height: 6, borderRadius: 3, background: INK, display: "flex", marginTop: 6 }} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ payload: string }> }) {
  const { payload } = await ctx.params;
  let card: ImageCard;
  try {
    card = JSON.parse(Buffer.from(payload.replace(/\.png$/i, ""), "base64url").toString("utf8")) as ImageCard;
    if (card.type !== "image") throw new Error("not a card");
  } catch {
    return new Response("bad card", { status: 400 });
  }
  const height = card.variant === "week" ? WEEK_H : dayHeight(card);
  return new ImageResponse(card.variant === "week" ? <WeekCard card={card} /> : <DayCard card={card} />, {
    width: W,
    height,
    headers: { "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
