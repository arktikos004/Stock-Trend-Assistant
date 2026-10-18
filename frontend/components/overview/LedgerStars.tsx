"use client";

/**
 * 存證星鏈：每一節是一顆同樣大小的粉筆星，以一道實線串起來；最新一節較大、帶琥珀圈（今天這一節）。
 * 星與星的間距依實際寬度攤開（上限 MAX_STEP），節數多時只畫最後 12 節，最左邊淡出。純圖形，整段意思寫在 aria-label。
 */

import { useWidth } from "@/lib/useWidth";

const SHOWN = 12;
const MAX_STEP = 72;
const PAD_L = 12;
const PAD_R = 28; // 最新一節的琥珀圈與置中的「第 N 節」要放得下
const H = 40;

export default function LedgerStars({ entries, verified }: { entries: number; verified: boolean | null | undefined }) {
  const [box, width] = useWidth<HTMLDivElement>(320);
  if (entries <= 0) return null;
  const n = Math.min(entries, SHOWN);
  const first = entries - n + 1;
  const step = n > 1 ? Math.min(MAX_STEP, (width - PAD_L - PAD_R) / (n - 1)) : 0;
  const y = H / 2 - 4;
  const xs = Array.from({ length: n }, (_, i) => PAD_L + i * step);
  const label = `存證鏈共 ${entries} 節，最新一節是第 ${entries} 節${verified === false ? "，驗證不符" : verified ? "，驗證通過" : ""}`;
  return (
    <div ref={box}>
      <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${H}`} width={width} height={H} className="block max-w-full">
        {entries > SHOWN && (
          <defs>
            <linearGradient id="ledger-fade" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="var(--background)" stopOpacity="1" />
              <stop offset="1" stopColor="var(--background)" stopOpacity="0" />
            </linearGradient>
          </defs>
        )}
        <polyline points={xs.map((x) => `${x},${y}`).join(" ")} fill="none" stroke="var(--ink-3)" strokeOpacity="0.7" strokeWidth="1" />
        {xs.map((x, i) => {
          const head = i === n - 1;
          return head ? (
            <g key={x}>
              <circle cx={x} cy={y} r="8.5" fill="none" stroke="var(--accent-mark)" strokeWidth="1.5" />
              <circle cx={x} cy={y} r="4.5" fill="var(--star)" />
            </g>
          ) : (
            <circle key={x} cx={x} cy={y} r="3.25" fill="var(--star)" stroke="var(--background)" strokeWidth="2" />
          );
        })}
        {entries > SHOWN && <rect x="0" y="0" width={step * 2} height={H} fill="url(#ledger-fade)" />}
        <text x={xs[n - 1]} y={H - 1} textAnchor="middle" fontSize="11" fill="var(--ink-3)">
          第 {entries} 節
        </text>
        {n >= 4 && (
          <text x={xs[0]} y={H - 1} textAnchor="start" fontSize="11" fill="var(--ink-3)" opacity="0.8">
            第 {first} 節
          </text>
        )}
      </svg>
    </div>
  );
}
