"use client";

/**
 * 今日星圖：股票池的每一檔是一顆星，x＝近 20 日報酬（篩選器的 metrics.ret20），y＝模型分數，星點大小＝星等（依百分位 6 級）。
 * 一個系列不需要顏色圖例，只附星等（大小）圖例；前 5 名標名稱，並以一道細線連成「今天的星座」（最小生成樹：線不會交叉，和站標同一個意思）。
 * 名稱先試貼著星的四個位置，壓到別的星、星座線或名稱就稍微往外移、加一條短的點狀引線。
 * 滑鼠找最近的一顆（24px 內），點下去進個股頁。表格（同頁的排序表）就是這張圖的表格版，鍵盤從表格走。
 * 座標依實際寬度計算（1 單位＝1px），手機上字不縮小；手機寬度畫成正方形。
 */

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import type { RankResult, ScreenerStock } from "@/lib/api";
import { code, fixed, pct } from "@/lib/format";
import { MAG_STEPS, magnitude, PLATE_RADIUS, radius } from "@/lib/magnitude";
import { useWidth } from "@/lib/useWidth";

const M = { top: 26, right: 16, bottom: 40, left: 44 };
const SQUARE_BELOW = 420;
const HIT_PX = 24;
const LABELLED = 5;
const FONT = 13;

interface Star {
  ticker: string;
  name: string;
  rank: number;
  score: number;
  ret20: number;
  cx: number;
  cy: number;
  r: number;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type Anchor = "start" | "middle" | "end";

interface Label {
  star: Star;
  x: number;
  y: number;
  anchor: Anchor;
  box: Box;
  leader: [number, number, number, number] | null;
}

/** 讓刻度落在好讀的數字：範圍的約 1/4，取 1、2、2.5、5 乘以 10 的次方 */
function niceStep(span: number): number {
  const raw = span / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 2.25 ? 2 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10) * p;
}

function domain(values: number[], must: number): [number, number] {
  const lo = Math.min(must, ...values);
  const hi = Math.max(must, ...values);
  const pad = (hi - lo || 1) * 0.08;
  return [lo - pad, hi + pad];
}

function ticks([lo, hi]: [number, number]): number[] {
  const step = niceStep(hi - lo);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** 名稱寬度的估計（明體粗體 13px）：中日韓字約 1em，英數約 0.62em */
const textWidth = (s: string) => [...s].reduce((w, ch) => w + (ch.codePointAt(0)! > 0x2e80 ? FONT : FONT * 0.62), 0);

function boxAt(x: number, y: number, w: number, anchor: Anchor): Box {
  const x0 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
  return { x0, y0: y - FONT + 2, x1: x0 + w, y1: y + 3 };
}

const GAP = 2;
const hitsStar = (b: Box, s: Star) => {
  const nx = Math.max(b.x0, Math.min(s.cx, b.x1));
  const ny = Math.max(b.y0, Math.min(s.cy, b.y1));
  return (nx - s.cx) ** 2 + (ny - s.cy) ** 2 < (s.r + GAP) ** 2;
};
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 + GAP && b.x0 < a.x1 + GAP && a.y0 < b.y1 + GAP && b.y0 < a.y1 + GAP;

/** 星座的一段線是否穿過名稱框（Liang–Barsky 裁切，框外留 GAP） */
function crosses([a, b]: [Star, Star], box: Box): boolean {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a.cx - (box.x0 - GAP)],
    [dx, box.x1 + GAP - a.cx],
    [-dy, a.cy - (box.y0 - GAP)],
    [dy, box.y1 + GAP - a.cy],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

const LEADER_MAX = 14;

/** 引線：從星的邊緣到名稱框最近的一點 */
function leaderTo(s: Star, b: Box): [number, number, number, number] {
  const tx = Math.max(b.x0, Math.min(s.cx, b.x1));
  const ty = Math.max(b.y0, Math.min(s.cy, b.y1));
  const len = Math.hypot(tx - s.cx, ty - s.cy) || 1;
  const ux = (tx - s.cx) / len;
  const uy = (ty - s.cy) / len;
  return [s.cx + ux * (s.r + 2), s.cy + uy * (s.r + 2), tx - ux * 2, ty - uy * 2];
}

/**
 * 前 5 名的名稱：依名次逐一找第一個不壓到任何星、星座線、已放的名稱，也不出框的位置。
 * 先試貼著星的四個位置，再試稍微離開（加一條不超過 LEADER_MAX 的點狀引線）；都不行就放右邊。
 */
function placeLabels(stars: Star[], segments: [Star, Star][], width: number, height: number): Label[] {
  const inside = (b: Box) => b.x0 >= M.left && b.x1 <= width - M.right && b.y0 >= M.top - 6 && b.y1 <= height - M.bottom;
  const placed: Label[] = [];
  for (const s of [...stars].sort((a, b) => a.rank - b.rank).slice(0, LABELLED)) {
    const w = textWidth(s.name);
    const near = s.r + 5;
    const candidates: { x: number; y: number; anchor: Anchor; lead: boolean }[] = [
      { x: s.cx + near, y: s.cy + 4, anchor: "start", lead: false },
      { x: s.cx - near, y: s.cy + 4, anchor: "end", lead: false },
      { x: s.cx, y: s.cy - near - 2, anchor: "middle", lead: false },
      { x: s.cx, y: s.cy + near + FONT - 1, anchor: "middle", lead: false },
    ];
    for (const d of [10, 14, 18]) {
      for (const [dx, dy] of [[1, -1], [-1, -1], [1, 1], [-1, 1], [1, 0], [-1, 0], [0, -1], [0, 1]]) {
        candidates.push({ x: s.cx + dx * (s.r + d), y: s.cy + dy * (s.r + d) + 4, anchor: dx > 0 ? "start" : dx < 0 ? "end" : "middle", lead: true });
      }
    }
    const fits = candidates
      .map((c) => {
        const box = boxAt(c.x, c.y, w, c.anchor);
        const leader = c.lead ? leaderTo(s, box) : null;
        return { ...c, box, leader };
      })
      .find(
        (c) =>
          (!c.leader || Math.hypot(c.leader[2] - c.leader[0], c.leader[3] - c.leader[1]) <= LEADER_MAX) &&
          inside(c.box) &&
          !stars.some((o) => hitsStar(c.box, o)) &&
          !segments.some((seg) => crosses(seg, c.box)) &&
          !placed.some((p) => overlaps(c.box, p.box)),
      );
    const c = fits ?? { ...candidates[0], box: boxAt(candidates[0].x, candidates[0].y, w, "start"), leader: null };
    placed.push({ star: s, x: c.x, y: c.y, anchor: c.anchor, box: c.box, leader: c.leader });
  }
  return placed;
}

/** 今天的星座：前 5 名的最小生成樹（Prim），回傳要畫的邊 */
function constellation(stars: Star[]): [Star, Star][] {
  const pts = [...stars].sort((a, b) => a.rank - b.rank).slice(0, LABELLED);
  if (pts.length < 2) return [];
  const inTree = [pts[0]];
  const rest = pts.slice(1);
  const edges: [Star, Star][] = [];
  while (rest.length) {
    let best: [number, number, number] = [0, 0, Infinity];
    inTree.forEach((a, i) =>
      rest.forEach((b, j) => {
        const d = (a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2;
        if (d < best[2]) best = [i, j, d];
      }),
    );
    const [b] = rest.splice(best[1], 1);
    edges.push([inTree[best[0]], b]);
    inTree.push(b);
  }
  return edges;
}

export default function SkyPlate({ results, stocks }: { results: RankResult[]; stocks: ScreenerStock[] | undefined }) {
  const router = useRouter();
  const svg = useRef<SVGSVGElement>(null);
  const [box, W] = useWidth<HTMLElement>(480);
  const H = W < SQUARE_BELOW ? W : Math.round(W * 0.75);
  const [hover, setHover] = useState<Star | null>(null);

  const { stars, xs, ys, x, y, missing } = useMemo(() => {
    const ret = new Map((stocks ?? []).map((s) => [s.ticker, s.metrics.ret20]));
    const rows = results.filter((r) => ret.get(r.ticker) != null);
    const xd = domain(rows.map((r) => ret.get(r.ticker)!), 0);
    const yd = domain(rows.map((r) => r.score), 0.5);
    const sx = (v: number) => M.left + ((v - xd[0]) / (xd[1] - xd[0])) * (W - M.left - M.right);
    const sy = (v: number) => H - M.bottom - ((v - yd[0]) / (yd[1] - yd[0])) * (H - M.top - M.bottom);
    const list: Star[] = rows
      .map((r) => {
        const r20 = ret.get(r.ticker)!;
        return { ticker: r.ticker, name: r.name, rank: r.rank, score: r.score, ret20: r20, cx: sx(r20), cy: sy(r.score), r: radius(PLATE_RADIUS, magnitude(r.percentile)) };
      })
      // 小星畫在後面會被大星蓋住，所以由暗到亮畫
      .sort((a, b) => a.r - b.r);
    return { stars: list, xs: ticks(xd), ys: ticks(yd), x: sx, y: sy, missing: results.length - rows.length };
  }, [results, stocks, W, H]);

  const figure = useMemo(() => constellation(stars), [stars]);
  const labels = useMemo(() => placeLabels(stars, figure, W, H), [stars, figure, W, H]);

  const nearest = (clientX: number, clientY: number): Star | null => {
    const el = svg.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const scale = W / rect.width;
    const px = (clientX - rect.left) * scale;
    const py = (clientY - rect.top) * scale;
    let best: Star | null = null;
    let bestD = (HIT_PX * scale) ** 2;
    for (const s of stars) {
      const d = (s.cx - px) ** 2 + (s.cy - py) ** 2;
      if (d <= bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  };

  if (stars.length === 0) return <p className="py-10 text-center text-sm text-ink-3">篩選器的 20 日報酬還沒有產生，星圖暫時畫不出來。</p>;

  const top = [...stars].sort((a, b) => a.rank - b.rank)[0];
  const zeroX = x(0);
  const half = y(0.5);
  return (
    <figure ref={box} className="relative">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`今日星圖：${stars.length} 檔，橫軸是近 20 日報酬，縱軸是模型分數；最強的是${top.name}（第 ${top.rank} 名）。完整數字見排序表。`}
        className="block h-auto w-full cursor-crosshair touch-manipulation select-none"
        onPointerMove={(e) => setHover(nearest(e.clientX, e.clientY))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const s = nearest(e.clientX, e.clientY);
          if (s) router.push(`/stock?t=${encodeURIComponent(s.ticker)}`);
        }}
      >
        {xs.map((v) => (
          <line key={`x${v}`} x1={x(v)} x2={x(v)} y1={M.top} y2={H - M.bottom} stroke="var(--chart-grid)" strokeWidth="1" />
        ))}
        {ys.map((v) => (
          <line key={`y${v}`} x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} stroke="var(--chart-grid)" strokeWidth="1" />
        ))}
        <line x1={zeroX} x2={zeroX} y1={M.top} y2={H - M.bottom} stroke="var(--border-strong)" strokeWidth="1" />
        <line x1={M.left} x2={W - M.right} y1={half} y2={half} stroke="var(--border-strong)" strokeWidth="1" />

        {xs.map((v) => (
          <text key={`xt${v}`} x={x(v)} y={H - M.bottom + 16} textAnchor="middle" fontSize="11" fill="var(--ink-3)">
            {pct(v, 0)}
          </text>
        ))}
        {ys.map((v) => (
          <text key={`yt${v}`} x={M.left - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">
            {fixed(v, 2)}
          </text>
        ))}
        <text x={W - M.right} y={H - 6} textAnchor="end" fontSize="11" fill="var(--ink-2)">
          近 20 日報酬 →
        </text>
        <text x={0} y={11} fontSize="11" fill="var(--ink-2)">
          ↑ 模型分數
        </text>

        {figure.map(([a, b]) => (
          <line key={`${a.ticker}-${b.ticker}`} x1={a.cx} y1={a.cy} x2={b.cx} y2={b.cy} stroke="var(--border-strong)" strokeWidth="1" />
        ))}
        {stars.map((s) => (
          <circle key={s.ticker} cx={s.cx} cy={s.cy} r={s.r} fill="var(--star)" stroke="var(--background)" strokeWidth="2" />
        ))}
        {hover && <circle cx={hover.cx} cy={hover.cy} r={hover.r + 5} fill="none" stroke="var(--accent-mark)" strokeWidth="1.5" pointerEvents="none" />}
        {labels.map(({ star, x: lx, y: ly, anchor, leader }) => (
          <g key={star.ticker} pointerEvents="none">
            {/* 引線是點狀的，和實線的星座線分得開 */}
            {leader && <line x1={leader[0]} y1={leader[1]} x2={leader[2]} y2={leader[3]} stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="1.5 2" />}
            {/* 底色描邊當作光暈，名稱靠近格線時仍讀得到 */}
            <text
              x={lx}
              y={ly}
              textAnchor={anchor}
              fontSize={FONT}
              fontWeight="600"
              fill="var(--ink)"
              stroke="var(--background)"
              strokeWidth="4"
              strokeLinejoin="round"
              paintOrder="stroke"
              className="font-serif"
            >
              {star.name}
            </text>
          </g>
        ))}
      </svg>

      {hover && (
        <div
          role="status"
          className="pointer-events-none absolute z-10 w-max min-w-36 rounded-[4px] border border-border bg-surface px-3 py-2 text-xs shadow-(--shadow-pop)"
          style={{
            left: `clamp(0px, calc(${(hover.cx / W) * 100}% - 4.5rem), calc(100% - 9rem))`,
            top: `calc(${(hover.cy / H) * 100}% + 14px)`,
          }}
        >
          <p className="font-serif text-sm font-semibold text-ink">
            {hover.name} <span className="font-sans text-xs font-normal text-ink-3">{code(hover.ticker)}</span>
          </p>
          <p className="mt-1 text-ink-2">
            第 {hover.rank} 名 · 分數 {hover.score.toFixed(3)}
          </p>
          <p className="text-ink-2">近 20 日 {pct(hover.ret20, 1)}</p>
        </div>
      )}

      <figcaption className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2 text-xs text-ink-3">
        <span className="flex items-end gap-2" aria-hidden="true">
          {Array.from({ length: MAG_STEPS }, (_, i) => (
            <span key={i} className="flex flex-col items-center gap-0.5">
              <svg width="22" height="22" viewBox="0 0 22 22">
                <circle cx="11" cy="11" r={PLATE_RADIUS[i]} fill="var(--star)" />
              </svg>
              <span className="text-[11px] leading-none">{i + 1}</span>
            </span>
          ))}
        </span>
        <span>星等 1–6：依百分位，越大越強；細線連起前 5 名</span>
        {missing > 0 && <span>{missing} 檔沒有 20 日報酬，未畫出</span>}
      </figcaption>
    </figure>
  );
}
