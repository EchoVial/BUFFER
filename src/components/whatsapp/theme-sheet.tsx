"use client";

import { Check, Moon, Smartphone, Sun } from "lucide-react";
import { WALLPAPERS, type Appearance, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** WhatsApp Settings → Chats → Theme / Wallpaper, as one bottom sheet. */
export function ThemeSheet({ appearance, onChange, onClose }: { appearance: Appearance; onChange: (patch: Partial<Appearance>) => void; onClose: () => void }) {
  const modes: Array<{ id: ThemeMode; label: string; icon: typeof Sun; hint: string }> = [
    { id: "light", label: "Light", icon: Sun, hint: "White chats, green sent bubbles" },
    { id: "dark", label: "Dark", icon: Moon, hint: "The classic night look" },
    { id: "system", label: "System default", icon: Smartphone, hint: "Follows your phone" },
  ];
  return (
    <div className="fixed inset-0 z-[80] flex flex-col justify-end bg-black/55" onClick={onClose}>
      <div className="max-h-[85vh] overflow-y-auto rounded-t-2xl bg-(--wa-panel) pb-[max(1rem,env(safe-area-inset-bottom))] text-(--wa-text)" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-(--wa-handle)" />
        <p className="px-4 pt-3 text-[13px] text-(--wa-muted)">Chats</p>
        <p className="px-4 pb-2 text-[16px] font-medium">Theme</p>
        <div className="border-t border-(--wa-divider)">
          {modes.map((m) => {
            const on = appearance.mode === m.id;
            return (
              <button key={m.id} type="button" className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-(--wa-hover)" onClick={() => onChange({ mode: m.id })}>
                <span className={cn("flex size-5 items-center justify-center rounded-full border-2", on ? "border-(--wa-accent) bg-(--wa-accent)" : "border-(--wa-muted)")}>
                  {on && <span className="size-2 rounded-full bg-(--wa-accent-ink)" />}
                </span>
                <m.icon className="size-5 text-(--wa-muted)" />
                <span className="flex-1">
                  <span className="block text-[16px]">{m.label}</span>
                  <span className="block text-[13px] text-(--wa-muted)">{m.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="px-4 pb-2 pt-4 text-[16px] font-medium">Wallpaper</p>
        <div className="grid grid-cols-4 gap-3 px-4 pb-2 sm:grid-cols-7">
          {WALLPAPERS.map((w) => {
            const on = appearance.wall === w.id;
            const preview = (appearance.mode === "light" || (appearance.mode === "system" && typeof window !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches)) ? w.light : w.dark;
            return (
              <button key={w.id} type="button" onClick={() => onChange({ wall: w.id })} className="flex flex-col items-center gap-1.5" aria-label={w.label} aria-pressed={on}>
                <span
                  className={cn("wa-wallpaper flex h-16 w-full items-center justify-center rounded-xl border-2 overflow-hidden", on ? "border-(--wa-accent)" : "border-transparent")}
                  style={{ ["--wa-wall" as string]: preview, ["--wa-doodle" as string]: w.id === "plain" ? 0 : undefined }}
                >
                  {on && (
                    <span className="flex size-6 items-center justify-center rounded-full bg-(--wa-accent) text-(--wa-accent-ink)">
                      <Check className="size-4" />
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-(--wa-muted)">{w.label}</span>
              </button>
            );
          })}
        </div>
        <button type="button" className="mx-4 mt-3 w-[calc(100%-2rem)] rounded-full bg-(--wa-accent) py-2.5 text-[14px] font-medium text-(--wa-accent-ink)" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
