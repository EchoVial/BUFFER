"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Appearance, kept in the browser. `data-theme` picks the WhatsApp palette
 * (dark / light / follow the phone), `data-wall` the chat wallpaper tint.
 */
export type ThemeMode = "dark" | "light" | "system";
export type Wallpaper = "default" | "sage" | "sky" | "sand" | "rose" | "lilac" | "plain";

export const WALLPAPERS: Array<{ id: Wallpaper; label: string; dark: string; light: string }> = [
  { id: "default", label: "Default", dark: "#0b141a", light: "#efeae2" },
  { id: "sage", label: "Sage", dark: "#0f2a25", light: "#dfe9df" },
  { id: "sky", label: "Sky", dark: "#0f2233", light: "#dbe8f2" },
  { id: "sand", label: "Sand", dark: "#2a2216", light: "#f1e6d2" },
  { id: "rose", label: "Rose", dark: "#2b1a22", light: "#f3dfe6" },
  { id: "lilac", label: "Lilac", dark: "#211b33", light: "#e6e0f3" },
  { id: "plain", label: "No doodles", dark: "#0b141a", light: "#efeae2" },
];

const KEY = "buffer.appearance";

export interface Appearance {
  mode: ThemeMode;
  wall: Wallpaper;
}

const DEFAULT: Appearance = { mode: "dark", wall: "default" };

export function readAppearance(): Appearance {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<Appearance>;
    return {
      mode: parsed.mode === "light" || parsed.mode === "system" ? parsed.mode : "dark",
      wall: WALLPAPERS.some((w) => w.id === parsed.wall) ? (parsed.wall as Wallpaper) : "default",
    };
  } catch {
    return DEFAULT;
  }
}

export function resolvedMode(mode: ThemeMode): "dark" | "light" {
  if (mode !== "system" || typeof window === "undefined") return mode === "light" ? "light" : "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyAppearance(a: Appearance) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = resolvedMode(a.mode);
  root.dataset.wall = a.wall;
  root.style.colorScheme = resolvedMode(a.mode);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolvedMode(a.mode) === "light" ? "#f0f2f5" : "#202c33");
}

export function useAppearance(): [Appearance, (patch: Partial<Appearance>) => void] {
  const [a, setA] = useState<Appearance>(DEFAULT);
  useEffect(() => {
    const cur = readAppearance();
    setA(cur);
    applyAppearance(cur);
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyAppearance(readAppearance());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const update = useCallback((patch: Partial<Appearance>) => {
    setA((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(KEY, JSON.stringify(next));
      applyAppearance(next);
      return next;
    });
  }, []);
  return [a, update];
}
