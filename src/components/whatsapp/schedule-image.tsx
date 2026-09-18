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

const INK = "#e9edef";
const MUTED = "#98a7b0";
const BG_A = "#10302b";
const BG_B = "#0b141a";
const FREE = "#25d366";
const WORK = "#64778a";
const SOCIAL = "#f5b942";
const HEALTH = "#5ad1c4";
const PERSONAL = "#c39bf0";
const TODO = "#6fa8ff";
const OTHER = "#9aa8b3";
const FONT = "Google Sans, Segoe UI, system-ui, sans-serif";

const kindColor = (k: string) =>
  k === "work" ? WORK : k === "social" ? SOCIAL : k === "health" ? HEALTH : k === "personal" ? PERSONAL : k === "todo" ? TODO : k === "free" ? FREE : OTHER;
const kindWord = (k: string) => (k === "work" ? "work" : k === "social" ? "people" : k === "health" ? "health" : k === "personal" ? "you" : k === "todo" ? "to-do" : "");

function hours(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
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
      <text x={W - 20} y="34" textAnchor="end" fill={FREE} fontSize="11.5" fontWeight="700" fontFamily={FONT} letterSpacing="0.4">
        Buffer
      </text>
      {children}
    </>
  );
}

const WEEK_H = 270;

/** Seven columns: free (green) stacked on work (grey), free hours on each. */
function WeekSvg({ card }: { card: Extract<ImageCard, { variant: "week" }> }) {
  const days = card.days;
  const left = 20;
  const top = 92;
  const bottom = WEEK_H - 56;
  const colW = (W - left * 2) / days.length;
  const maxMin = Math.max(6 * 60, ...days.map((d) => d.freeMinutes + d.workMinutes));
  const scale = (bottom - top) / maxMin;
  return (
    <Frame h={WEEK_H} title={card.title} subtitle={card.subtitle}>
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
        const yWork = bottom - workH;
        const yFree = yWork - freeH;
        const label = d.freeMinutes ? hours(d.freeMinutes) : "";
        return (
          <g key={d.date}>
            {workH > 0 && <rect x={x} y={yWork} width={bw} height={Math.max(2, workH)} fill={WORK} opacity="0.9" rx="3" />}
            {freeH > 0 && <rect x={x} y={yFree} width={bw} height={Math.max(2, freeH)} fill={FREE} rx="3" />}
            {label &&
              (freeH >= 20 ? (
                <text x={x + bw / 2} y={yFree + 14} textAnchor="middle" fill="#052e16" fontSize="11" fontWeight="700" fontFamily={FONT}>
                  {label}
                </text>
              ) : (
                <text x={x + bw / 2} y={yFree - 5} textAnchor="middle" fill={FREE} fontSize="11" fontWeight="700" fontFamily={FONT}>
                  {label}
                </text>
              ))}
            {!d.freeMinutes && !d.workMinutes && (
              <text x={x + bw / 2} y={bottom - 6} textAnchor="middle" fill={MUTED} fontSize="10" fontFamily={FONT}>
                open
              </text>
            )}
            <text x={x + bw / 2} y={bottom + 18} textAnchor="middle" fill={d.today ? FREE : INK} fontSize="12.5" fontWeight={d.today ? 700 : 500} fontFamily={FONT}>
              {d.label}
            </text>
            {d.today && <circle cx={x + bw / 2} cy={bottom + 28} r="2" fill={FREE} />}
            {d.best && (
              <text x={x + bw / 2} y={bottom + 42} textAnchor="middle" fill={MUTED} fontSize="9.5" fontFamily={FONT}>
                {d.best.replace(/ to /, "–")}
              </text>
            )}
          </g>
        );
      })}
    </Frame>
  );
}

/** One day: a strip from wake to sleep, then the blocks as a short list. */
function DaySvg({ card, h }: { card: Extract<ImageCard, { variant: "day" }>; h: number }) {
  const left = 20;
  const right = W - 20;
  const from = card.fromMin;
  const to = card.toMin;
  const x = (min: number) => left + ((Math.min(Math.max(min, from), to) - from) / (to - from)) * (right - left);
  const laneY = 72;
  const laneH = 40;
  const ticks: number[] = [];
  for (let m = Math.ceil(from / 180) * 180; m <= to; m += 180) ticks.push(m);
  const blocks = card.blocks.filter((b) => b.endMin > from && b.startMin < to && b.kind !== "free" && b.kind !== "sleep").sort((a, b) => a.startMin - b.startMin);
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
        const bx = x(b.startMin);
        const bw = Math.max(4, x(b.endMin) - bx);
        const hi = card.highlight && b.title === card.highlight;
        return (
          <rect
            key={`${b.title}-${i}`}
            x={bx + 1}
            y={laneY + 5}
            width={bw - 2}
            height={laneH - 10}
            rx="5"
            fill={kindColor(b.kind)}
            opacity={b.kind === "work" ? 0.9 : 0.95}
            stroke={hi ? "#ffffff" : "none"}
            strokeWidth={hi ? 2 : 0}
          />
        );
      })}
      {card.nowMin !== undefined && card.nowMin >= from && card.nowMin <= to && (
        <g>
          <line x1={x(card.nowMin)} x2={x(card.nowMin)} y1={laneY - 6} y2={laneY + laneH + 2} stroke="#ff5a5f" strokeWidth="2" />
          <circle cx={x(card.nowMin)} cy={laneY - 7} r="3.5" fill="#ff5a5f" />
        </g>
      )}
      {rows.length === 0 && (
        <text x={left} y={rowY} fill={MUTED} fontSize="13" fontFamily={FONT}>
          nothing on yet
        </text>
      )}
      {rows.map((b, i) => {
        const y = rowY + i * 28;
        const hi = card.highlight && b.title === card.highlight;
        const word = kindWord(b.kind);
        const title = b.title.length > 26 ? `${b.title.slice(0, 25)}…` : b.title;
        return (
          <g key={`${b.title}-${i}-row`}>
            <circle cx={left + 5} cy={y - 4} r="4.5" fill={kindColor(b.kind)} />
            <text x={left + 18} y={y} fill={MUTED} fontSize="12" fontFamily={FONT}>
              {clockRange(b.startMin, b.endMin)}
            </text>
            <text x={left + 148} y={y} fill={INK} fontSize="13.5" fontWeight={hi ? 700 : 500} fontFamily={FONT}>
              {title}
            </text>
            {hi ? (
              <text x={right} y={y} textAnchor="end" fill={FREE} fontSize="11" fontWeight="700" fontFamily={FONT}>
                new
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
      <text x={left} y={h - 16} fill={INK} fontSize="12.5" fontWeight="600" fontFamily={FONT}>
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

export function ScheduleImage({ card }: { card: ImageCard }) {
  const [open, setOpen] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const h = card.variant === "week" ? WEEK_H : dayHeight(card);

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
    <svg ref={svgRef} viewBox={`0 0 ${W} ${h}`} width="100%" role="img" aria-label={card.title} xmlns="http://www.w3.org/2000/svg" style={{ display: "block", borderRadius: 8 }}>
      {card.variant === "week" ? <WeekSvg card={card} /> : <DaySvg card={card} h={h} />}
    </svg>
  );

  return (
    <>
      <button type="button" className="block w-full overflow-hidden rounded-lg" onClick={() => setOpen(true)} aria-label="Open image">
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
