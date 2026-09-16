"use client";

import { ChatMessage } from "@/lib/types";
import { cardToWhatsApp, WhatsAppText } from "./wa-text";

export function MessageCards({ message }: { message: ChatMessage }) {
  if (!message.card) return null;
  return (
    <div className="mt-1.5 border-t border-white/10 pt-1.5">
      <WhatsAppText text={cardToWhatsApp(message.card)} />
    </div>
  );
}
