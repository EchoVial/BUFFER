"use client";

import { ChatMessage } from "@/lib/types";
import { cardToWhatsApp, WhatsAppText } from "./wa-text";
import { ScheduleImage } from "./schedule-image";

/** "today", "tomorrow", a weekday, or the ISO date: what the bot understands after "move Work to 8 pm". */
function dayWord(iso: string): string {
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const [y, m, d] = iso.split("-").map(Number);
  const diff = Math.round((new Date(y, m - 1, d).getTime() - t0.getTime()) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff > 1 && diff < 7) return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  return iso;
}

function clock(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const mm = min % 60;
  const h = h24 % 12 || 12;
  return `${h}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${h24 >= 12 ? "pm" : "am"}`;
}

export function MessageCards({ message, onSend }: { message: ChatMessage; onSend?: (text: string) => void }) {
  if (!message.card) return null;
  if (message.card.type === "image") {
    const card = message.card;
    const onMove = onSend && card.variant === "day" ? (block: { title: string }, start: number) => onSend(`move ${block.title.replace(/^★ /, "")} to ${clock(start)} ${dayWord(card.date)}`) : undefined;
    return <ScheduleImage card={card} onMove={onMove} />;
  }
  const text = cardToWhatsApp(message.card);
  if (!text) return null;
  return (
    <div className="mt-1.5 border-t border-(--wa-divider) pt-1.5">
      <WhatsAppText text={text} />
    </div>
  );
}
