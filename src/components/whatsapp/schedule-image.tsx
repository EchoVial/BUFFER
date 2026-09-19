"use client";

import { useRef, useState } from "react";
import { Download, X } from "lucide-react";
import type { ImageCard } from "@/lib/types";

/**
 * The week and the day as a picture, the way a friend would screenshot their
 * calendar for you. Drawn as SVG at phone-bubble size (400 wide) so the text
 * stays readable inside the chat; "Save" rasterises it to PNG in the browser.
 */
const W = 400;

/*
 * Monochrome on purpose: black, white and greys carry the structure; purple is the one accent
 * and it means "you can move this" (saved blocks) or "this just changed".
 */
const INK = "#f2f2f2";
const MUTED = "#9a9a9a";
const BG_A = "#161616";
const BG_B = "#0b0b0b";
const FREE = "#e8e8e8";
const WORK = "#4a4a4a";
const BLOCK = "#5c5c5c";
const BLOCK_DIM = "#333333";
const ACCENT = "#8B84E8";
const ACCENT_INK = "#1b1748";
const FONT = "Google Sans, Segoe UI, system-ui, sans-serif";

/** Grey for what is fixed; purple for what you can drag. */
const blockColor = (b: { kind: string; movable?: boolean; id?: string }) => (b.movable && b.id ? ACCENT : b.kind === "todo" ? BLOCK_DIM : b.kind === "work" ? WORK : BLOCK);
const kindWord = (k: string) => (k === "work" ? "work" : k === "social" ? "people" : k === "health" ? "health" : k === "personal" ? "you" : k === "todo" ? "to-do" : "");

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

function Frame({ h, title, subtitle, children }: { h: number; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <>
      <defs>
        <linearGradient id="bufbg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={BG_A} />
          <stop offset="1" stopColor={BG_B} />
        </linearGradient>
      </defs>
      <rect width={W} height={h} rx="16" fill="url(#bufbg)" />
      <text x="20" y="34" fill={INK} fontSize="20" fontWeight="600" fontFamily={FONT}>
        {title}
      </text>
      <text x="20" y="56" fill={MUTED} fontSize="12.5" fontFamily={FONT}>
        {subtitle}
      </text>
      <text x={W - 20} y="34" textAnchor="end" fill={MUTED} fontSize="11.5" fontWeight="700" fontFamily={FONT} letterSpacing="0.4">
        Buffer
      </text>
      {children}
    </>
  );
}

const WEEK_H = 236;

/** Seven columns: free (green) stacked on work (grey). No numbers; the shape is the point. */
function WeekSvg({ card }: { card: Extract<ImageCard, { variant: "week" }> }) {
  const days = card.days;
  const left = 20;
  const top = 92;
  const bottom = WEEK_H - 44;
  const colW = (W - left * 2) / days.length;
  const maxMin = Math.max(6 * 60, ...days.map((d) => d.freeMinutes + d.workMinutes + (d.goneMinutes ?? 0)));
  const scale = (bottom - top) / maxMin;
  return (
    <Frame h={WEEK_H} title={card.title} subtitle={card.subtitle}>
      <defs>
        {/* the part of today that has already passed: dim, with slanted marks */}
        <pattern id="gone" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
          <rect width="7" height="7" fill={BLOCK_DIM} />
          <line x1="0" y1="0" x2="0" y2="7" stroke={MUTED} strokeWidth="1.6" strokeOpacity="0.55" />
        </pattern>
      </defs>
      <g transform={`translate(${W - 20 - 118}, 66)`}>
        <rect width="9" height="9" rx="2" fill={FREE} y="1" />
        <text x="14" y="9" fill={MUTED} fontSize="11" fontFamily={FONT}>
          free
        </text>
        <rect width="9" height="9" rx="2" fill={WORK} x="48" y="1" />
        <text x="62" y="9" fill={MUTED} fontSize="11" fontFamily={FONT}>
          work
        </text>
      </g>
      <line x1={left} x2={W - left} y1={bottom} y2={bottom} stroke="#ffffff" strokeOpacity="0.12" />
      {days.map((d, i) => {
        const x = left + i * colW + colW * 0.2;
        const bw = colW * 0.6;
        const workH = d.workMinutes * scale;
        const freeH = d.freeMinutes * scale;
        const goneH = (d.goneMinutes ?? 0) * scale;
        const yWork = bottom - workH;
        const yFree = yWork - freeH;
        const yGone = yFree - goneH;
        return (
          <g key={d.date}>
            {workH > 0 && <rect x={x} y={yWork} width={bw} height={Math.max(2, workH)} fill={WORK} opacity="0.9" rx="3" />}
            {freeH > 0 && <rect x={x} y={yFree} width={bw} height={Math.max(2, freeH)} fill={FREE} rx="3" />}
            {goneH > 0 && <rect x={x} y={yGone} width={bw} height={Math.max(2, goneH)} fill="url(#gone)" rx="3" />}
            {!d.freeMinutes && !d.workMinutes && !d.goneMinutes && <rect x={x} y={bottom - 3} width={bw} height="3" fill="#ffffff" fillOpacity="0.15" rx="1.5" />}
            <text x={x + bw / 2} y={bottom + 18} textAnchor="middle" fill={INK} fontSize="12.5" fontWeight={d.today ? 700 : 500} fontFamily={FONT}>
              {d.label}
            </text>
            {d.today && <circle cx={x + bw / 2} cy={bottom + 28} r="2" fill={INK} />}
          </g>
        );
      })}
    </Frame>
  );
}

type DayBlock = Extract<ImageCard, { variant: "day" }>["blocks"][number];
type Drag = { id: string; startMin: number; moved: boolean };

/** One day: a strip from wake to sleep, then the blocks as a short list. Saved events can be dragged along the strip. */
function DaySvg({ card, h, drag, onDragStart }: { card: Extract<ImageCard, { variant: "day" }>; h: number; drag: Drag | null; onDragStart?: (b: DayBlock, e: React.PointerEvent) => void }) {
  const left = 20;
  const right = W - 20;
  const from = card.fromMin;
  const to = card.toMin;
  const x = (min: number) => left + ((Math.min(Math.max(min, from), to) - from) / (to - from)) * (right - left);
  const laneY = 72;
  const laneH = 40;
  const ticks: number[] = [];
  for (let m = Math.ceil(from / 180) * 180; m <= to; m += 180) ticks.push(m);
  // While a block is being dragged, draw it where the finger is.
  const live = (b: DayBlock): DayBlock => (drag && b.id && b.id === drag.id ? { ...b, startMin: drag.startMin, endMin: drag.startMin + (b.endMin - b.startMin) } : b);
  const blocks = card.blocks
    .filter((b) => b.endMin > from && b.startMin < to && b.kind !== "free" && b.kind !== "sleep")
    .map(live)
    .sort((a, b) => a.startMin - b.startMin);
  const rows = blocks.slice(0, 6);
  const rowY = laneY + laneH + 46;
  return (
    <Frame h={h} title={card.title} subtitle={card.subtitle}>
      <rect x={left} y={laneY} width={right - left} height={laneH} rx="8" fill="#ffffff" fillOpacity="0.06" />
      {ticks.map((m) => (
        <g key={m}>
          <line x1={x(m)} x2={x(m)} y1={laneY} y2={laneY + laneH} stroke="#ffffff" strokeOpacity="0.08" />
          <text x={x(m)} y={laneY + laneH + 16} textAnchor="middle" fill={MUTED} fontSize="11" fontFamily={FONT}>
            {clock(m)}
          </text>
        </g>
      ))}
      {blocks.map((b, i) => {
        if (b.endMin <= from || b.startMin >= to) return null; // outside the strip; still listed below
        const bx = x(Math.max(from, b.startMin));
        const bw = Math.max(4, x(Math.min(to, b.endMin)) - bx);
        const reserved = b.kind === "reserved";
        const dragging = Boolean(drag && b.id && drag.id === b.id);
        // Same title twice (a standing "Work" block and a marked one): the saved one is the new one.
        const hi = (card.highlight && b.title === card.highlight && (b.id || !blocks.some((o) => o.title === b.title && o.id))) || dragging;
        const grab = Boolean(b.movable && b.id && onDragStart);
        return (
          <g key={`${b.id ?? b.title}-${i}`}>
            <rect
              x={bx + 1}
              y={laneY + 5}
              width={bw - 2}
              height={laneH - 10}
              rx="5"
              fill={reserved ? "#1a1a1a" : blockColor(b)}
              opacity={dragging ? 1 : 0.95}
              stroke={hi ? INK : reserved ? ACCENT : b.kind === "todo" ? "#7a7a7a" : "none"}
              strokeWidth={hi ? 2 : reserved ? 2 : b.kind === "todo" ? 1 : 0}
              strokeDasharray={!hi && b.kind === "todo" ? "3 3" : undefined}
              style={grab ? { cursor: dragging ? "grabbing" : "grab", touchAction: "none" } : undefined}
              onPointerDown={grab ? (e) => onDragStart!(b, e) : undefined}
            />
            {grab && bw > 26 && (
              <g pointerEvents="none" opacity="0.7">
                <line x1={bx + bw - 9} x2={bx + bw - 9} y1={laneY + 14} y2={laneY + laneH - 14} stroke={ACCENT_INK} strokeWidth="1.5" />
                <line x1={bx + bw - 5} x2={bx + bw - 5} y1={laneY + 14} y2={laneY + laneH - 14} stroke={ACCENT_INK} strokeWidth="1.5" />
              </g>
            )}
            {dragging && (
              <text x={Math.min(Math.max(bx + bw / 2, left + 40), right - 40)} y={laneY - 12} textAnchor="middle" fill={ACCENT} fontSize="12.5" fontWeight="700" fontFamily={FONT}>
                {clockRange(b.startMin, b.endMin)}
              </text>
            )}
          </g>
        );
      })}
      {card.nowMin !== undefined && card.nowMin >= from && card.nowMin <= to && (
        <g>
          <line x1={x(card.nowMin)} x2={x(card.nowMin)} y1={laneY - 6} y2={laneY + laneH + 2} stroke={INK} strokeWidth="2" />
          <circle cx={x(card.nowMin)} cy={laneY - 7} r="3.5" fill={INK} />
        </g>
      )}
      {rows.length === 0 && (
        <text x={left} y={rowY} fill={MUTED} fontSize="13" fontFamily={FONT}>
          nothing on yet
        </text>
      )}
      {rows.map((b, i) => {
        const y = rowY + i * 28;
        const dragging = Boolean(drag && b.id && drag.id === b.id);
        const hi = (card.highlight && b.title === card.highlight && (b.id || !blocks.some((o) => o.title === b.title && o.id))) || dragging;
        const word = kindWord(b.kind);
        const title = b.title.length > 26 ? `${b.title.slice(0, 25)}…` : b.title;
        return (
          <g key={`${b.title}-${i}-row`}>
            <circle cx={left + 5} cy={y - 4} r="4.5" fill={blockColor(b)} stroke={b.kind === "todo" ? "#7a7a7a" : "none"} strokeWidth={b.kind === "todo" ? 1 : 0} />
            <text x={left + 18} y={y} fill={MUTED} fontSize="12" fontFamily={FONT}>
              {clockRange(b.startMin, b.endMin)}
            </text>
            <text x={left + 148} y={y} fill={INK} fontSize="13.5" fontWeight={hi ? 700 : 500} fontFamily={FONT}>
              {title}
            </text>
            {hi ? (
              <text x={right} y={y} textAnchor="end" fill={ACCENT} fontSize="11" fontWeight="700" fontFamily={FONT}>
                {dragging ? "moving" : "new"}
              </text>
            ) : (
              word && (
                <text x={right} y={y} textAnchor="end" fill={MUTED} fontSize="11" fontFamily={FONT}>
                  {word}
                </text>
              )
            )}
          </g>
        );
      })}
      {blocks.length > rows.length && (
        <text x={left + 18} y={rowY + rows.length * 28} fill={MUTED} fontSize="12" fontFamily={FONT}>
          +{blocks.length - rows.length} more
        </text>
      )}
      <line x1={left} x2={right} y1={h - 36} y2={h - 36} stroke="#ffffff" strokeOpacity="0.1" />
      {blocks.some((b) => b.movable && b.id) && onDragStart ? (
        <g>
          <rect x={left} y={h - 25} width="9" height="9" rx="2" fill={ACCENT} />
          <text x={left + 14} y={h - 17} fill={MUTED} fontSize="11.5" fontFamily={FONT}>
            purple blocks: drag to move
          </text>
        </g>
      ) : null}
      <text x={right} y={h - 16} textAnchor="end" fill={INK} fontSize="12.5" fontWeight="600" fontFamily={FONT}>
        {card.footer}
      </text>
    </Frame>
  );
}

function dayHeight(card: Extract<ImageCard, { variant: "day" }>): number {
  const n = Math.min(6, card.blocks.filter((b) => b.kind !== "free" && b.kind !== "sleep").length);
  const extra = card.blocks.filter((b) => b.kind !== "free" && b.kind !== "sleep").length > 6 ? 1 : 0;
  return 158 + Math.max(1, n + extra) * 28 + 48;
}

export function ScheduleImage({ card, onMove }: { card: ImageCard; onMove?: (block: DayBlock, newStartMin: number) => void }) {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ block: DayBlock; x0: number; start0: number; pxPerMin: number; last: number } | null>(null);
  const justDragged = useRef(false);
  const h = card.variant === "week" ? WEEK_H : dayHeight(card);

  function startDrag(block: DayBlock, e: React.PointerEvent) {
    if (card.variant !== "day" || !block.id) return;
    const svg = svgRef.current;
    if (!svg) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const laneWidth = (svg.getBoundingClientRect().width / W) * (W - 40);
    dragRef.current = { block, x0: e.clientX, start0: block.startMin, pxPerMin: laneWidth / (card.toMin - card.fromMin), last: block.startMin };
    setDrag({ id: block.id, startMin: block.startMin, moved: false });
  }

  function moveDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || card.variant !== "day") return;
    const len = d.block.endMin - d.block.startMin;
    const raw = d.start0 + (e.clientX - d.x0) / d.pxPerMin;
    const snapped = Math.round(raw / 15) * 15;
    const start = Math.min(card.toMin - len, Math.max(card.fromMin, snapped));
    d.last = start;
    setDrag({ id: d.block.id!, startMin: start, moved: start !== d.start0 });
  }

  function endDrag() {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    // Any drag, moved or not, must not open the lightbox on the click that follows.
    justDragged.current = true;
    window.setTimeout(() => (justDragged.current = false), 400);
    if (d.last !== d.start0) onMove?.(d.block, d.last);
  }

  async function save() {
    const svg = svgRef.current;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("render"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = W * 3;
    canvas.height = h * 3;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `buffer-${card.variant}-${card.variant === "week" ? card.days[0]?.date : card.date}.png`;
    a.click();
  }

  const picture = (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${h}`}
      width="100%"
      role="img"
      aria-label={card.title}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", borderRadius: 8 }}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {card.variant === "week" ? <WeekSvg card={card} /> : <DaySvg card={card} h={h} drag={drag} onDragStart={onMove ? startDrag : undefined} />}
    </svg>
  );

  return (
    <>
      <button
        type="button"
        className="block w-full overflow-hidden rounded-lg"
        onClick={() => {
          if (justDragged.current) return;
          setOpen(true);
        }}
        aria-label="Open image"
      >
        {picture}
      </button>
      {open && (
        <div className="fixed inset-0 z-[90] flex flex-col bg-black/90" onClick={() => setOpen(false)}>
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <button type="button" onClick={() => setOpen(false)} aria-label="Close">
              <X className="size-6" />
            </button>
            <button
              type="button"
              className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[14px]"
              onClick={(e) => {
                e.stopPropagation();
                void save();
              }}
            >
              <Download className="size-4" /> Save
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center p-3" onClick={(e) => e.stopPropagation()}>
            <div className="w-full max-w-xl">{picture}</div>
          </div>
        </div>
      )}
    </>
  );
}
