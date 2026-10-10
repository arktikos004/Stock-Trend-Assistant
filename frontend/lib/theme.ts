"use client";

import { useSyncExternalStore } from "react";

/**
 * 主題：淺色（預設）、深色、跟隨系統。存在 localStorage 的 "theme"，套在 <html data-theme>；
 * 首次繪製前由 layout 的開機腳本（lib/theme-boot.ts）先套用，這裡負責之後的切換與訂閱。
 */
export type ThemeMode = "light" | "dark" | "system";

const KEY = "theme";
const EVENT = "themechange";

function read(): ThemeMode {
  const mode = document.documentElement.getAttribute("data-theme");
  return mode === "dark" || mode === "system" ? mode : "light";
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener(EVENT, onChange);
  media.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    media.removeEventListener("change", onChange);
  };
}

export function setThemeMode(mode: ThemeMode) {
  document.documentElement.setAttribute("data-theme", mode);
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // 無痕模式等情況存不了：這次瀏覽仍然套用
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, read, () => "light");
}

/** 實際生效的明暗（「跟隨系統」時看作業系統設定），給需要具體色值的圖表訂閱 */
export function useResolvedTheme(): "light" | "dark" {
  return useSyncExternalStore(
    subscribe,
    () => {
      const mode = read();
      if (mode === "system") return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      return mode;
    },
    () => "light",
  );
}
