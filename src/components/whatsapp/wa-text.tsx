"use client";

import type { ReactNode } from "react";
import { MessageCard } from "@/lib/types";
import { durationLabel } from "@/lib/time";

function formatInline(line: string): ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*\n]+?\*\*|\*[^*\s][^*\n]*?\*|_[^_\s][^_\n]*?_|~[^~\s][^~\n]*?~)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(line))) {
    if (match.index > last) {
      parts.push(line.slice(last, match.index));
    }
    const token = match[0];
    let inner = token;
    let className = "font-semibold";
    if (token.startsWith("**") && token.endsWith("**")) {
      inner = token.slice(2, -2);
      className = "font-semibold";
    } else if (token.startsWith("*") && token.endsWith("*")) {
      inner = token.slice(1, -1);
      className = "font-semibold";
    } else if (token.startsWith("_") && token.endsWith("_")) {
      inner = token.slice(1, -1);
      className = "italic text-[#ffffffcc]";
    } else if (token.startsWith("~") && token.endsWith("~")) {
      inner = token.slice(1, -1);
      className = "line-through text-(--wa-time)";
    }
    parts.push(
      <strong key={`b-${key++}`} className={className}>
        {inner}
      </strong>,
    );
    last = match.index + token.length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts.length ? parts : [line];
}

export function WhatsAppText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <span className="block whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      {lines.map((line, i) => {
        const bullet = line.match(/^(\s*)([-*•–—▪◦]|\d+[.)]|\[(?: |x|X)\])\s+(.*)$/);
        if (bullet) {
          return (
            <span key={i} className="flex min-h-[1.15em] gap-2">
              <span className="w-4 shrink-0 text-center text-(--wa-accent)">•</span>
              <span className="min-w-0 flex-1">{formatInline(bullet[3])}</span>
            </span>
          );
        }
        return (
          <span key={i} className="block min-h-[1.15em]">
            {formatInline(line)}
          </span>
        );
      })}
    </span>
  );
}

function prettyLine(l: string): string {
  const m = l.match(/^(.+?)\s{2,}(.+?)\s+·\s+(.+)$/);
  if (m) return `• *${m[1]}* ${m[2]} _${m[3].toLowerCase()}_`;
  if (l.startsWith("•") || l.startsWith("*")) return l;
  return `• ${l}`;
}

function scheduleBlock(title: string, lines: string[]) {
  const body = lines.length ? lines.map(prettyLine).join("\n") : "• nothing on the books";
  return `*${title}*\n${body}`;
}

export function cardToWhatsApp(card: MessageCard): string {
  if (card.type === "image") return "";
  if (card.type === "schedule") {
    const chunks = [
      scheduleBlock(card.date, card.lines),
      `_${durationLabel(card.stats.workMinutes)} work · ${durationLabel(card.stats.socialMinutes)} social · ${durationLabel(card.stats.freeMinutes)} free_`,
    ];
    if (card.warnings.length) {
      chunks.push(`*Heads up*\n${card.warnings.map((w) => `• ${w}`).join("\n")}`);
    }
    return chunks.join("\n\n");
  }
  if (card.type === "proposal") {
    const chunks = [
      `*${card.eventPreview}*`,
      card.summary,
      scheduleBlock("Right now", card.before),
      scheduleBlock("If we add it", card.after),
      `*What moves*\n${card.moves.map((m) => `• ${m}`).join("\n")}`,
    ];
    if (card.warnings.length) {
      chunks.push(`*Watch outs*\n${card.warnings.map((w) => `• ${w}`).join("\n")}`);
    }
    chunks.push("Reply *lock it* to save, or send a different time.");
    return chunks.join("\n\n");
  }
  if (card.type === "todos") {
    return `*To-dos*\n${card.lines.join("\n")}`;
  }
  if (card.type === "overlaps") {
    return `*Overlaps*\n${card.items.map((w) => `• ${w}`).join("\n")}`;
  }
  return card.json;
}
