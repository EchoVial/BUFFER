"use client";

import { ChatMessage } from "@/lib/types";
import { cardToWhatsApp, WhatsAppText } from "./wa-text";
import { ScheduleImage } from "./schedule-image";

export function MessageCards({ message }: { message: ChatMessage }) {
  if (!message.card) return null;
  if (message.card.type === "image") return <ScheduleImage card={message.card} />;
  const text = cardToWhatsApp(message.card);
  if (!text) return null;
  return (
    <div className="mt-1.5 border-t border-(--wa-divider) pt-1.5">
      <WhatsAppText text={text} />
    </div>
  );
}
