"use client";

import { useRef, useState } from "react";
import { Download, X } from "lucide-react";
import type { ImageCard } from "@/lib/types";

/**
 * The week and the day as a picture, the way a friend would screenshot their
 * calendar for you. Drawn as SVG so it is crisp at any size; "Save" rasterises
 * it to PNG in the browser.
 */
const W = 720;
const H = 405;

const INK = "#e9edef";
const MUTED = "#8fa3ad";
const BG_A = "#0e2a26";
const BG_B = "#0b141a";
const FREE = "#25d366";
const WORK = "#7f93a4";
const SOCIAL = "#f5b942";
const HEALTH = "#5ad1c4";
const PERSONAL = "#c39bf0";
const TODO = "#f5b942";

const kindColor = (k: string) => (k === "work" ? WORK : k === "social" ? SOCIAL : k === "health" ? HEALTH : k === "personal" ? PERSONAL : k === "todo" ? TODO : k === "free" ? FREE : MUTED);

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

function Frame({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <>
      <defs>
        <linearGradient id="bufbg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={BG_A} />
          <stop offset="1" stopColor={BG_B} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} rx="18" fill="url(#bufbg)" />
      <text x="28" y="44" fill={INK} fontSize="24" fontWeight="600" fontFamily="Google Sans, system-ui, sans-serif">
        {title}
      </text>
      <text x="28" y="70" fill={MUTED} fontSize="15" fontFamily="Google Sans, system-ui, sans-serif">
        {subtitle}
      </text>
      <text x={W - 28} y="44" textAnchor="end" fill={FREE} fontSize="14" fontWeight="600" fontFamily="Google Sans, system-ui, sans-serif">
        Buffer
      </text>
      {children}
    </>
  );
}

/** Seven columns: free (green) stacked on work (grey), best window under each day. */
function WeekSvg({ card }: { card: Extract<ImageCard, { variant: "week" }> }) {
  const days = card.days;
  const left = 28;
  const top = 96;
  const bottom = H - 62;
  const colW = (W - left * 2) / days.length;
  const maxMin = Math.max(6 * 60, ...days.map((d) => d.freeMinutes + d.workMinutes));
  const scale = (bottom - top) / maxMin;
  return (
    <Frame title={card.title} subtitle={card.subtitle}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={left} x2={W - left} y1={bottom - f * (bottom - top)} y2={bottom - f * (bottom - top)} stroke="#ffffff" strokeOpacity="0.07" />
      ))}
      {days.map((d, i) => {
        const x = left + i * colW + colW * 0.22;
        const bw = colW * 0.56;
        const workH = d.workMinutes * scale;
        const freeH = d.freeMinutes * scale;
        const yWork = bottom - workH;
        const yFree = yWork - freeH;
        return (
          <g key={d.date}>
            {workH > 0 && <rect x={x} y={yWork} width={bw} height={workH} fill={WORK} opacity="0.85" rx="4" />}
            {freeH > 0 && <rect x={x} y={yFree} width={bw} height={freeH} fill={FREE} rx="4" />}
            {freeH > 14 && (
              <text x={x + bw / 2} y={yFree + 16} textAnchor="middle" fill="#052e16" fontSize="12" fontWeight="700" fontFamily="Google Sans, system-ui, sans-serif">
                {hours(d.freeMinutes)}
              </text>
            )}
            <text x={x + bw / 2} y={bottom + 20} textAnchor="middle" fill={d.today ? FREE : INK} fontSize="14" fontWeight={d.today ? 700 : 500} fontFamily="Google Sans, system-ui, sans-serif">
              {d.label}
            </text>
            <text x={x + bw / 2} y={bottom + 38} textAnchor="middle" fill={MUTED} fontSize="11" fontFamily="Google Sans, system-ui, sans-serif">
              {d.best ?? "packed"}
            </text>
          </g>
        );
      })}
      <g transform={`translate(${W - 28 - 170}, 78)`}>
        <rect width="10" height="10" rx="2" fill={FREE} y="0" />
        <text x="16" y="9" fill={MUTED} fontSize="12" fontFamily="Google Sans, system-ui, sans-serif">
          free outside work
        </text>
        <rect width="10" height="10" rx="2" fill={WORK} x="122" y="0" opacity="0.85" />
        <text x="138" y="9" fill={MUTED} fontSize="12" fontFamily="Google Sans, system-ui, sans-serif">
          work
        </text>
      </g>
    </Frame>
  );
}

/** One day as a horizontal strip from wake to sleep, blocks coloured by kind. */
function DaySvg({ card }: { card: Extract<ImageCard, { variant: "day" }> }) {
  const left = 28;
  const right = W - 28;
  const from = card.fromMin;
  const to = card.toMin;
  const x = (min: number) => left + ((Math.min(Math.max(min, from), to) - from) / (to - from)) * (right - left);
  const laneY = 128;
  const laneH = 92;
  const ticks: number[] = [];
  for (let m = Math.ceil(from / 120) * 120; m <= to; m += 120) ticks.push(m);
  return (
    <Frame title={card.title} subtitle={card.subtitle}>
      <rect x={left} y={laneY} width={right - left} height={laneH} rx="10" fill="#ffffff" fillOpacity="0.05" />
      {ticks.map((m) => (
        <g key={m}>
          <line x1={x(m)} x2={x(m)} y1={laneY - 6} y2={laneY + laneH + 6} stroke="#ffffff" strokeOpacity="0.08" />
          <text x={x(m)} y={laneY + laneH + 24} textAnchor="middle" fill={MUTED} fontSize="12" fontFamily="Google Sans, system-ui, sans-serif">
            {clock(m)}
          </text>
        </g>
      ))}
      {card.blocks
        .filter((b) => b.endMin > from && b.startMin < to && b.kind !== "free" && b.kind !== "sleep")
        .map((b, i) => {
          const bx = x(b.startMin);
          const bw = Math.max(6, x(b.endMin) - bx);
          const c = kindColor(b.kind);
          const label = bw > 70 ? b.title : bw > 34 ? b.title.slice(0, 4) : "";
          return (
            <g key={`${b.title}-${i}`}>
              <rect x={bx + 1} y={laneY + 10} width={bw - 2} height={laneH - 20} rx="8" fill={c} opacity={b.kind === "work" ? 0.85 : 0.95} />
              {label && (
                <text x={bx + bw / 2} y={laneY + laneH / 2 + 5} textAnchor="middle" fill="#0b141a" fontSize={bw > 110 ? 13 : 11} fontWeight="600" fontFamily="Google Sans, system-ui, sans-serif">
                  {label.length > 18 ? `${label.slice(0, 17)}…` : label}
                </text>
              )}
            </g>
          );
        })}
      {card.nowMin !== undefined && card.nowMin >= from && card.nowMin <= to && (
        <g>
          <line x1={x(card.nowMin)} x2={x(card.nowMin)} y1={laneY - 14} y2={laneY + laneH + 4} stroke="#ff5a5f" strokeWidth="2" />
          <circle cx={x(card.nowMin)} cy={laneY - 14} r="4" fill="#ff5a5f" />
        </g>
      )}
      <g transform={`translate(28, ${H - 78})`}>
        {[
          ["work", WORK],
          ["to-dos", TODO],
          ["people", SOCIAL],
          ["health", HEALTH],
          ["you", PERSONAL],
        ].map(([label, c], i) => (
          <g key={label} transform={`translate(${i * 105}, 0)`}>
            <rect width="10" height="10" rx="2" fill={c} />
            <text x="16" y="9" fill={MUTED} fontSize="12" fontFamily="Google Sans, system-ui, sans-serif">
              {label}
            </text>
          </g>
        ))}
      </g>
      <text x={W - 28} y={H - 30} textAnchor="end" fill={INK} fontSize="15" fontWeight="600" fontFamily="Google Sans, system-ui, sans-serif">
        {card.footer}
      </text>
    </Frame>
  );
}

export function ScheduleImage({ card }: { card: ImageCard }) {
  const [open, setOpen] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

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
    canvas.width = W * 2;
    canvas.height = H * 2;
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
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={card.title} xmlns="http://www.w3.org/2000/svg" style={{ display: "block", borderRadius: 8 }}>
      {card.variant === "week" ? <WeekSvg card={card} /> : <DaySvg card={card} />}
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
            <div className="w-full max-w-3xl">{picture}</div>
          </div>
        </div>
      )}
    </>
  );
}
