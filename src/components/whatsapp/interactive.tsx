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
    <div className="overflow-hidden rounded-b-lg border-t border-(--wa-divider)">
      {buttons.slice(0, 3).map((button, i) => (
        <button
          key={button.id}
          type="button"
          onClick={() => onPress(button)}
          className={cn(
            "flex w-full items-center justify-center gap-2 px-3 py-2.5 text-[14px] font-medium text-(--wa-link) hover:bg-(--wa-hover) active:bg-(--wa-hover)",
            i > 0 && "border-t border-(--wa-divider)",
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
      className="flex w-full items-center justify-center gap-2 rounded-b-lg border-t border-(--wa-divider) px-3 py-2.5 text-[14px] font-medium text-(--wa-link) hover:bg-(--wa-hover) active:bg-(--wa-hover)"
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
        className="max-h-[80vh] overflow-y-auto rounded-t-2xl bg-(--wa-panel) pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-(--wa-handle)" />
        <p className="px-4 pt-3 text-[13px] text-(--wa-muted)">Buffer</p>
        <p className="px-4 pb-2 text-[16px] font-medium text-(--wa-text)">{list.button}</p>
        {list.sections.map((section) => (
          <div key={section.title} className="border-t border-(--wa-divider)">
            <p className="px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-(--wa-accent)">
              {section.title}
            </p>
            {section.rows.map((row) => (
              <button
                key={row.id}
                type="button"
                className="flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left hover:bg-(--wa-hover)"
                onClick={() => onPick(row)}
              >
                <span className="text-[16px] text-(--wa-text)">{row.title}</span>
                {row.description ? (
                  <span className="text-[13px] text-(--wa-muted)">{row.description}</span>
                ) : null}
              </button>
            ))}
          </div>
        ))}
        {list.footer ? (
          <p className="px-4 pt-2 text-center text-[12px] text-(--wa-muted)">{list.footer}</p>
        ) : null}
        <button
          type="button"
          className="mx-4 mt-3 w-[calc(100%-2rem)] rounded-full bg-(--wa-accent) py-2.5 text-[14px] font-medium text-(--wa-accent-ink)"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}
