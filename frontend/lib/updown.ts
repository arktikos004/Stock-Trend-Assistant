"use client";

import { useSyncExternalStore } from "react";

/**
 * 漲跌顏色：紅漲綠跌（台股，預設）或綠漲紅跌（美股）。存在 localStorage 的 "updown"，套在 <html data-updown>，
 * globals.css 依此對調漲跌的色 token；首次繪製前由 layout 的開機腳本（lib/theme-boot.ts）先套用，這裡負責之後的切換與訂閱。
 */
export type UpDown = "red-up" | "green-up";

const KEY = "updown";
const EVENT = "updownchange";

/** 目前的設定；不認得的值當紅漲綠跌 */
export function getUpDown(): UpDown {
  return document.documentElement.getAttribute("data-updown") === "green-up" ? "green-up" : "red-up";
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

export function setUpDown(value: UpDown) {
  document.documentElement.setAttribute("data-updown", value);
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // 無痕模式等情況存不了：這次瀏覽仍然套用
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useUpDown(): UpDown {
  return useSyncExternalStore(subscribe, getUpDown, () => "red-up");
}
