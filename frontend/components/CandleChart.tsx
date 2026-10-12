"use client";

/**
 * lightweight-charts v5 K 線圖。
 * - 顏色讀 CSS token（漲紅跌綠），切換深淺主題時重畫
 * - 依實際筆數撐滿寬度（fitContent），左右兩端固定在第一根與最後一根，不刻意靠右留白；
 *   開放資料從 2026-10 才開始累積，筆數少時 K 棒會比較寬。左下角的 TradingView 標誌依授權保留
 * - useEffect 建圖＋cleanup chart.remove()：React StrictMode 雙掛載不會重複建圖
 */

import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, createChart, HistogramSeries } from "lightweight-charts";
import type { Candle } from "@/lib/api";
import { useResolvedTheme } from "@/lib/theme";

function palette() {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    up: v("--chart-up"),
    down: v("--chart-down"),
    upVol: v("--chart-up-vol"),
    downVol: v("--chart-down-vol"),
    grid: v("--chart-grid"),
    text: v("--ink-3"),
    border: v("--border"),
  };
}

export default function CandleChart({ candles, height = 380 }: { candles: Candle[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useResolvedTheme();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const c = palette();

    const chart = createChart(container, {
      height,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: c.text },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      timeScale: { borderColor: c.border, fixLeftEdge: true, fixRightEdge: true },
      rightPriceScale: { borderColor: c.border },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: c.up,
      downColor: c.down,
      borderUpColor: c.up,
      borderDownColor: c.down,
      wickUpColor: c.up,
      wickDownColor: c.down,
    });
    candleSeries.setData(candles.map((k) => ({ time: k.time, open: k.open, high: k.high, low: k.low, close: k.close })));

    const volumeSeries = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume" });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volumeSeries.setData(
      candles.map((k) => ({ time: k.time, value: k.volume, color: k.close >= k.open ? c.upVol : c.downVol })),
    );

    const resize = () => {
      chart.applyOptions({ width: container.clientWidth });
      chart.timeScale().fitContent();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [candles, height, theme]);

  const last = candles[candles.length - 1];
  return (
    <div
      ref={containerRef}
      className="w-full"
      role="img"
      aria-label={last ? `日 K 線圖，共 ${candles.length} 個交易日，${last.time} 收盤 ${last.close}` : "日 K 線圖"}
    />
  );
}
