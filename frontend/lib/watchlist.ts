"use client";

import { useSyncExternalStore } from "react";

/**
 * 自選股：只存在這台裝置的瀏覽器（localStorage 的 "watchlist"），不會上傳。
 * 瀏覽器不讓存（例如無痕模式）時改存在記憶體，這次瀏覽仍可使用，關掉分頁就消失。
 */
const KEY = "watchlist";
const EVENT = "watchlistchange";
const EMPTY: string[] = [];

let memory: string | null = null;
let snapshot: { raw: string | null; list: string[] } = { raw: null, list: EMPTY };

function rawValue(): string | null {
  try {
    return localStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

/** useSyncExternalStore 需要穩定的快照：內容沒變就回傳同一個陣列 */
function read(): string[] {
  const raw = rawValue();
  if (raw === snapshot.raw) return snapshot.list;
  let list: string[] = EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (Array.isArray(parsed)) list = parsed.filter((t): t is string => typeof t === "string");
  } catch {
    list = EMPTY;
  }
  snapshot = { raw, list };
  return list;
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useWatchlist(): string[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function toggleWatch(ticker: string) {
  const list = read();
  const next = JSON.stringify(list.includes(ticker) ? list.filter((t) => t !== ticker) : [...list, ticker]);
  try {
    localStorage.setItem(KEY, next);
  } catch {
    memory = next;
  }
  window.dispatchEvent(new Event(EVENT));
}
