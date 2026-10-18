"use client";

import { useCallback, useRef, useState } from "react";

/**
 * 元素的實際寬度（px），隨版面改變；量到之前用 fallback。
 * SVG 圖用它讓 1 個座標單位＝1px，字級與點的大小在手機上不會跟著縮小。
 * 回傳的 ref 是 callback ref：元素晚一點才出現（資料讀完才畫）也量得到。
 */
export function useWidth<T extends Element>(fallback: number) {
  const [width, setWidth] = useState(fallback);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    observer.current = ro;
  }, []);
  return [ref, width] as const;
}
