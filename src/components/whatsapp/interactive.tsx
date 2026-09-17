"use client";

import { ChatMessage, ListRow, ReplyButton } from "@/lib/types";
import { cn } from "@/lib/utils";
import { List } from "lucide-react";

export function ReplyButtons({
  buttons,
  onPress,
}: {
  buttons: ReplyButton[];
  onPress: (button: ReplyButton) => void;
}) {
  return (
    <div className="overflow-hidden border-t border-white/10">
      {buttons.slice(0, 3).map((button, i) => (
        <button
          key={button.id}
          type="button"
          onClick={() => onPress(button)}
          className={cn(
            "flex w-full items-center justify-center px-3 py-2.5 text-[14px] font-medium text-[#53bdeb] hover:bg-white/5",
            i > 0 && "border-t border-white/10",
          )}
        >
          {button.title}
        </button>
      ))}
    </div>
  );
}

export function ListTrigger({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="flex w-full items-center justify-center gap-2 border-t border-white/10 px-3 py-2.5 text-[14px] font-medium text-[#53bdeb] hover:bg-white/5"
    >
      <List className="size-4" />
      {label}
    </button>
  );
}

export function WhatsAppListSheet({
  message,
  onPick,
  onClose,
}: {
  message: ChatMessage;
  onPick: (row: ListRow) => void;
  onClose: () => void;
}) {
  const list = message.list;
  if (!list) return null;
  return (
    <div className="fixed inset-0 z-[80] flex flex-col justify-end bg-black/55" onClick={onClose}>
      <div
        className="max-h-[80vh] overflow-y-auto rounded-t-2xl bg-[#111b21] pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20" />
        <p className="px-4 pt-3 text-[13px] text-[#8696a0]">Buffer</p>
        <p className="px-4 pb-2 text-[16px] font-medium">{list.button}</p>
        {list.sections.map((section) => (
          <div key={section.title} className="border-t border-white/10">
            <p className="px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-[#00a884]">
              {section.title}
            </p>
            {section.rows.map((row) => (
              <button
                key={row.id}
                type="button"
                className="flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left hover:bg-white/5"
                onClick={() => onPick(row)}
              >
                <span className="text-[16px] text-[#e9edef]">{row.title}</span>
                {row.description ? (
                  <span className="text-[13px] text-[#8696a0]">{row.description}</span>
                ) : null}
              </button>
            ))}
          </div>
        ))}
        {list.footer ? (
          <p className="px-4 pt-2 text-center text-[12px] text-[#8696a0]">{list.footer}</p>
        ) : null}
        <button
          type="button"
          className="mx-4 mt-3 w-[calc(100%-2rem)] rounded-lg bg-[#202c33] py-2.5 text-[14px] text-[#e9edef]"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}
