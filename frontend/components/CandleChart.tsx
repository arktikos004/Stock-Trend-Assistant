"use client";

/**
 * lightweight-charts v5 日 K 線圖，三個窗格：主圖（K 棒、均線、前高／前低、放量標記）、成交量（張）、副圖（KD／RSI／MACD／乖離率）。
 * - 指標在完整累積序列上計算再切到畫面區間（lib/indicators.ts）；資料不足的先不畫，上方一行說明還差多少
 * - 顏色讀 CSS token（漲跌色、線色、參考線），切換深淺主題或漲跌顏色設定時重畫；漲跌色一律經 palette() 取得
 * - 疊加層開關與副圖切換只改可見性，不重建圖表、不重置縮放
 * - 依實際筆數撐滿寬度（fitContent），左右兩端固定在第一根與最後一根，不刻意靠右留白；
 *   開放資料從 2026-10 才開始累積，筆數少時 K 棒會比較寬。左下角的 TradingView 標誌依授權保留
 * - useEffect 建圖＋cleanup chart.remove()：React StrictMode 雙掛載不會重複建圖
 */

import { Check } from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type AutoscaleInfo,
  type IPriceLine,
  type IPriceScaleApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineSeriesPartialOptions,
  type SeriesMarker,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import Segmented from "@/components/ui/Segmented";
import type { Candle } from "@/lib/api";
import { fixed, pct, toneVar } from "@/lib/format";
import {
  BIAS_PERIODS,
  computeOverlay,
  type IndicatorKind,
  MA_PERIODS,
  paneNote,
  pendingNote,
  priceDecimals,
  type Series,
} from "@/lib/indicators";
import { useResolvedTheme } from "@/lib/theme";
import { useUpDown } from "@/lib/updown";

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
    ref: v("--chart-ref"),
    lines: [1, 2, 3, 4, 5].map((n) => v(`--chart-line-${n}`)),
  };
}

/** 線色的 CSS 變數：均線依週期順序，乖離率沿用同週期均線，KD、RSI、MACD 的兩條線用 1、2 */
const lineVar = (slot: number) => `var(--chart-line-${slot})`;
const maSlot = (p: number) => MA_PERIODS.indexOf(p as (typeof MA_PERIODS)[number]) + 1;

type Layer = "ma" | "levels" | "signals";
const LAYERS: { key: Layer; label: string }[] = [
  { key: "ma", label: "均線" },
  { key: "levels", label: "前高前低" },
  { key: "signals", label: "放量訊號" },
];

const INDICATORS: { value: IndicatorKind; label: string }[] = [
  { value: "kd", label: "KD" },
  { value: "rsi", label: "RSI" },
  { value: "macd", label: "MACD" },
  { value: "bias", label: "乖離率" },
];
const PANE_TITLE: Record<IndicatorKind, string> = {
  kd: "KD（9,3,3）",
  rsi: "RSI（6,12）",
  macd: "MACD（12,26,9）",
  bias: "乖離率（5,10,20）",
};

/** 整張圖的高度：窄的容器（手機）矮一些；三個窗格（主圖、成交量、副圖）依比例分配 */
const autoHeight = (width: number) => (width < 640 ? 460 : 540);
const PANE_STRETCH = [5.4, 1.5, 2.6];

interface ChartParts {
  mas: ISeriesApi<"Line">[];
  levelLines: IPriceLine[];
  markers: ISeriesMarkersPluginApi<Time>;
  markerList: SeriesMarker<Time>[];
  indicators: Record<IndicatorKind, ISeriesApi<SeriesType>[]>;
  indicatorScale: IPriceScaleApi;
  axisText: string;
}

/** 成交量與副圖窗格在容器裡的位置：放窗格標題與「資料不足」說明 */
interface PaneBox {
  top: number;
  height: number;
  width: number; // 不含右側價格軸
}

/** crosshair 回傳的 time 依版本可能是字串、BusinessDay 或 UTC 秒數，統一成 YYYY-MM-DD */
function toDay(t: Time | undefined): string | null {
  if (t == null) return null;
  if (typeof t === "string") return t;
  if (typeof t === "number") return new Date(t * 1000).toISOString().slice(0, 10);
  return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
}

const fmtPrice = (v: number) => v.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
const fmtLots = (shares: number) => Math.round(shares / 1000).toLocaleString("zh-TW");
const toLine = (candles: Candle[], s: Series) => candles.flatMap((k, i) => (s[i] == null ? [] : [{ time: k.time, value: s[i] as number }]));

/** 讀數裡的一個值：前面的短線段是線色（對應圖上的線），文字用一般文字色 */
function Keyed({ slot, label, value }: { slot: number; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span aria-hidden="true" className="inline-block h-[3px] w-3 rounded-full" style={{ background: lineVar(slot) }} />
      {label} <b className="font-semibold text-ink">{value}</b>
    </span>
  );
}

export default function CandleChart({ candles, history, height }: { candles: Candle[]; history?: Candle[] | null; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const partsRef = useRef<ChartParts | null>(null);
  const theme = useResolvedTheme();
  const upDown = useUpDown();
  const [show, setShow] = useState<Record<Layer, boolean>>({ ma: true, levels: true, signals: true });
  const [indicator, setIndicator] = useState<IndicatorKind>("kd");
  const [hoverTime, setHoverTime] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<{ volume: PaneBox; indicator: PaneBox } | null>(null);

  const overlay = useMemo(() => computeOverlay(candles, history), [candles, history]);
  const indexOf = useMemo(() => new Map(candles.map((c, i) => [c.time, i])), [candles]);

  // 疊加層與副圖的可見性：建圖後與切換時都套用目前的選擇
  const syncVisibility = useEffectEvent(() => {
    const parts = partsRef.current;
    if (!parts) return;
    parts.mas.forEach((s) => s.applyOptions({ visible: show.ma }));
    parts.levelLines.forEach((l) => l.applyOptions({ lineVisible: show.levels, axisLabelVisible: show.levels }));
    parts.markers.setMarkers(show.signals ? parts.markerList : []);
    // 副圖的價格軸格式取自軸上的第一條線：選到的指標放在右軸，其他的移到不顯示的軸
    for (const kind of Object.keys(parts.indicators) as IndicatorKind[]) {
      const on = kind === indicator;
      parts.indicators[kind].forEach((s) => s.applyOptions({ visible: on, priceScaleId: on ? "right" : "off" }));
    }
    // 一條線都畫不出來時，軸上的預設刻度沒有意義，不顯示
    const empty = paneNote(indicator, overlay.readiness) !== null;
    parts.indicatorScale.applyOptions({ textColor: empty ? "transparent" : parts.axisText });
  });

  // 建圖：K 線、計算結果、高度或主題變了才重建
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const c = palette();
    const chart = createChart(container, {
      height: height ?? autoHeight(container.clientWidth),
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: c.text,
        panes: { separatorColor: c.border, separatorHoverColor: c.grid },
      },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      timeScale: { borderColor: c.border, fixLeftEdge: true, fixRightEdge: true },
      rightPriceScale: { borderColor: c.border },
    });
    const line = { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false } as const;
    const refLine = (s: ISeriesApi<SeriesType>, price: number) =>
      s.createPriceLine({ price, color: c.ref, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });

    // 主圖：K 棒、均線、前高／前低、放量標記
    const decimals = priceDecimals(candles);
    const candle = chart.addSeries(CandlestickSeries, {
      priceFormat: { type: "price", precision: decimals, minMove: 10 ** -decimals },
      upColor: c.up,
      downColor: c.down,
      borderUpColor: c.up,
      borderDownColor: c.down,
      wickUpColor: c.up,
      wickDownColor: c.down,
    });
    candle.setData(candles.map((k) => ({ time: k.time, open: k.open, high: k.high, low: k.low, close: k.close })));
    const mas = MA_PERIODS.map((p, i) => {
      const s = chart.addSeries(LineSeries, { ...line, color: c.lines[i] });
      s.setData(toLine(candles, overlay.ma[p]));
      return s;
    });
    const levels = overlay.levels;
    const levelLines = levels
      ? ([
          [levels.high, "前高"],
          [levels.low, "前低"],
        ] as const).map(([price, title]) =>
          candle.createPriceLine({ price, title, color: c.ref, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true }),
        )
      : [];
    const markerList = candles.flatMap<SeriesMarker<Time>>((k, i) => {
      const sig = overlay.signals[i];
      if (sig === "breakout") return [{ time: k.time, position: "belowBar", shape: "arrowUp", color: c.up }];
      if (sig === "breakdown") return [{ time: k.time, position: "aboveBar", shape: "arrowDown", color: c.down }];
      return [];
    });
    const markers = createSeriesMarkers(candle, []);

    // 成交量（張）
    const volume = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: "custom", formatter: (v: number) => Math.round(v).toLocaleString("zh-TW"), minMove: 1 },
        priceLineVisible: false,
        lastValueVisible: false,
      },
      1,
    );
    volume.setData(candles.map((k) => ({ time: k.time, value: k.volume / 1000, color: k.close >= k.open ? c.upVol : c.downVol })));

    // 副圖：四組指標都先建好，切換時只改可見性。KD、RSI 固定 0～100；MACD、乖離率的範圍一定含 0，零軸才看得到
    const pct100 = {
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      priceFormat: { type: "price", precision: 0, minMove: 1 },
    } as const;
    const withZero = (original: () => AutoscaleInfo | null) => {
      const r = original();
      return r?.priceRange ? { ...r, priceRange: { minValue: Math.min(0, r.priceRange.minValue), maxValue: Math.max(0, r.priceRange.maxValue) } } : r;
    };
    const two = { priceFormat: { type: "price", precision: 2, minMove: 0.01 }, autoscaleInfoProvider: withZero } as const;
    const sub = (slot: number, data: Series, extra: LineSeriesPartialOptions) => {
      const s = chart.addSeries(LineSeries, { ...line, color: c.lines[slot - 1], ...extra }, 2);
      s.setData(toLine(candles, data));
      return s;
    };
    const kd = [sub(1, overlay.kd.k, pct100), sub(2, overlay.kd.d, pct100)];
    [80, 20].forEach((p) => refLine(kd[0], p));
    const rsi = [sub(1, overlay.rsi[6], pct100), sub(2, overlay.rsi[12], pct100)];
    [80, 50, 20].forEach((p) => refLine(rsi[0], p));
    const osc = chart.addSeries(HistogramSeries, { ...two, priceLineVisible: false, lastValueVisible: false }, 2);
    osc.setData(
      candles.flatMap((k, i) => {
        const v = overlay.macd.osc[i];
        return v == null ? [] : [{ time: k.time, value: v, color: v >= 0 ? c.upVol : c.downVol }];
      }),
    );
    const dif = sub(1, overlay.macd.dif, two);
    refLine(dif, 0);
    const macd = [osc, dif, sub(2, overlay.macd.macd, two)];
    const percent = {
      priceFormat: { type: "custom", formatter: (v: number) => `${v.toFixed(2)}%`, minMove: 0.01 },
      autoscaleInfoProvider: withZero,
    } as const;
    const bias = BIAS_PERIODS.map((p) => sub(maSlot(p), overlay.bias[p], percent));
    refLine(bias[0], 0);

    chart.panes().forEach((pane, i) => pane.setStretchFactor(PANE_STRETCH[i] ?? 1));
    // 副圖上下留白小一點：KD、RSI 的 0～100 才不會多出 120 的刻度
    chart.priceScale("right", 2).applyOptions({ scaleMargins: { top: 0.08, bottom: 0.08 } });
    chart.subscribeCrosshairMove((p) => setHoverTime(toDay(p.time)));
    partsRef.current = {
      mas,
      levelLines,
      markers,
      markerList,
      indicators: { kd, rsi, macd, bias },
      indicatorScale: chart.priceScale("right", 2),
      axisText: c.text,
    };
    syncVisibility();

    // 窗格位置要等版面排好才量得到：在 ResizeObserver 的回呼裡、下一個畫格再量
    let frame = 0;
    const measure = () => {
      const panes = chart.panes();
      const top = container.getBoundingClientRect().top;
      const box = (i: number): PaneBox | null => {
        const el = panes[i]?.getHTMLElement();
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top - top, height: r.height, width: r.width - chart.priceScale("right", i).width() };
      };
      const [v, ind] = [box(1), box(2)];
      setBoxes(v && ind ? { volume: v, indicator: ind } : null);
    };
    const resize = () => {
      const width = container.clientWidth;
      chart.applyOptions({ width, height: height ?? autoHeight(width) });
      chart.timeScale().fitContent();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      chart.remove();
      partsRef.current = null;
    };
  }, [candles, overlay, height, theme, upDown]);

  // 疊加層開關與副圖切換：只改可見性，不重建圖表
  useEffect(() => syncVisibility(), [show, indicator]);

  // 讀數：滑鼠所在的 K 棒；移出圖表時顯示最新一根
  const i = (hoverTime != null ? indexOf.get(hoverTime) : undefined) ?? candles.length - 1;
  const bar = candles[i];
  const prev = overlay.prevClose[i];
  const change = bar && prev ? bar.close / prev - 1 : null;
  const sig = overlay.signals[i];
  const note = pendingNote(overlay.readiness);
  const empty = paneNote(indicator, overlay.readiness);
  const val = (s: Series) => s[i] ?? null;
  const num = (v: number | null, signed = false) => (v == null ? null : fixed(v, 2, signed));

  const indicatorValues: { slot?: number; label: string; value: string | null; tone?: number | null }[] =
    indicator === "kd"
      ? [
          { slot: 1, label: "K", value: num(val(overlay.kd.k)) },
          { slot: 2, label: "D", value: num(val(overlay.kd.d)) },
        ]
      : indicator === "rsi"
        ? [
            { slot: 1, label: "RSI6", value: num(val(overlay.rsi[6])) },
            { slot: 2, label: "RSI12", value: num(val(overlay.rsi[12])) },
          ]
        : indicator === "macd"
          ? [
              { slot: 1, label: "DIF", value: num(val(overlay.macd.dif), true) },
              { slot: 2, label: "MACD", value: num(val(overlay.macd.macd), true) },
              { label: "OSC", value: num(val(overlay.macd.osc), true), tone: val(overlay.macd.osc) },
            ]
          : BIAS_PERIODS.map((p) => {
              const v = val(overlay.bias[p]);
              return { slot: maSlot(p), label: `乖離${p}`, value: v == null ? null : `${fixed(v, 2, true)}%` };
            });
  const last = candles[candles.length - 1];

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="主圖疊加">
          {LAYERS.map((l) => {
            const on = show[l.key];
            return (
              <button
                key={l.key}
                type="button"
                aria-pressed={on}
                onClick={() => setShow((s) => ({ ...s, [l.key]: !s[l.key] }))}
                className={`inline-flex min-h-8 items-center gap-1 rounded-md border px-2.5 text-xs transition-colors duration-150 ${
                  on ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-ink-2 hover:bg-surface-2 hover:text-ink"
                }`}
              >
                {on && <Check size={12} aria-hidden="true" />}
                {l.label}
              </button>
            );
          })}
        </div>
        <Segmented label="副圖指標" size="sm" value={indicator} onChange={setIndicator} options={INDICATORS} />
      </div>

      {bar && (
        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs tabular-nums text-ink-3">
          <span className="font-medium text-ink-2">{bar.time}</span>
          {(
            [
              ["開", bar.open],
              ["高", bar.high],
              ["低", bar.low],
              ["收", bar.close],
            ] as const
          ).map(([label, v]) => (
            <span key={label}>
              {label} <b className="font-semibold text-ink">{fmtPrice(v)}</b>
            </span>
          ))}
          {change != null && (
            <span className="font-semibold" style={{ color: toneVar(change) }}>
              {change > 0 ? "▲ " : change < 0 ? "▼ " : ""}
              {pct(change, 2)}
            </span>
          )}
          <span>
            量 <b className="font-semibold text-ink">{fmtLots(bar.volume)}</b> 張
          </span>
          {show.ma &&
            MA_PERIODS.map((p, k) => {
              const v = overlay.ma[p][i];
              return v == null ? null : <Keyed key={p} slot={k + 1} label={`MA${p}`} value={fmtPrice(v)} />;
            })}
          {indicatorValues.map((x) =>
            x.value == null ? null : x.slot ? (
              <Keyed key={x.label} slot={x.slot} label={x.label} value={x.value} />
            ) : (
              <span key={x.label} className="whitespace-nowrap">
                {x.label}{" "}
                <b className="font-semibold" style={{ color: toneVar(x.tone) }}>
                  {x.value}
                </b>
              </span>
            ),
          )}
          {show.signals && sig && (
            <span className="font-semibold" style={{ color: sig === "breakout" ? "var(--up)" : "var(--down)" }}>
              {sig === "breakout" ? "▲ 放量突破" : "▼ 放量跌破"}
            </span>
          )}
        </div>
      )}
      {note && <p className="mb-1 text-xs text-ink-3">{note}</p>}

      <div className="relative">
        <div
          ref={containerRef}
          className="w-full"
          role="img"
          aria-label={last ? `日 K 線圖，共 ${candles.length} 個交易日，${last.time} 收盤 ${last.close}` : "日 K 線圖"}
        />
        {boxes && (
          <div aria-hidden="true" className="pointer-events-none text-xs text-ink-3">
            <span className="absolute left-1.5 rounded bg-surface/80 px-1" style={{ top: boxes.volume.top + 2 }}>
              成交量（張）
            </span>
            <span className="absolute left-1.5 rounded bg-surface/80 px-1" style={{ top: boxes.indicator.top + 2 }}>
              {PANE_TITLE[indicator]}
            </span>
            {empty && (
              <span
                className="absolute left-0 flex items-center justify-center px-4 text-center text-ink-2"
                style={{ top: boxes.indicator.top, height: boxes.indicator.height, width: boxes.indicator.width }}
              >
                {empty}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
