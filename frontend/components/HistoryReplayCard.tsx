"use client";

/**
 * 歷史預測回放（個股）：對選定區間做 point-in-time 重算再對照實際，顯示命中率、逐筆色帶與明細。
 * 與線上實證（推論當下寫入、不可回改）互補：這是事後重算，範圍可自訂。
 */

import { useState } from "react";
import { api, type HistoryRecord, type Signal } from "@/lib/api";
import { pct, share } from "@/lib/format";
import { errorText, useAsync } from "@/lib/useAsync";
import { HitMark } from "./TrackRecordCard";

const SIGNAL_VAR: Record<Signal, string> = { 漲: "--up", 跌: "--down", 觀望: "--hold" };

/** 命中色帶：每格一次預測，實心＝命中、空心＝未命中，顏色是預測的方向；左舊右新 */
function HitStrip({ records }: { records: HistoryRecord[] }) {
  const chron = [...records].reverse();
  const hits = records.filter((r) => r.hit).length;
  return (
    <div role="img" aria-label={`${records.length} 筆預測中命中 ${hits} 筆，左舊右新`} className="flex flex-wrap gap-0.5">
      {chron.map((r) => (
        <span
          key={r.date}
          className="h-3.5 w-2 rounded-[2px]"
          style={{
            background: r.hit ? `var(${SIGNAL_VAR[r.signal]})` : "transparent",
            border: `1px solid var(${SIGNAL_VAR[r.signal]})`,
          }}
          title={`${r.date}：預測 ${r.signal}，實際 ${r.actual}，${r.hit ? "命中" : "未命中"}`}
        />
      ))}
    </div>
  );
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function HistoryReplayCard({ ticker, minDate, maxDate }: { ticker: string; minDate?: string; maxDate?: string }) {
  const [start, setStart] = useState(() => isoDaysAgo(180));
  const [end, setEnd] = useState(() => isoDaysAgo(0));
  const [range, setRange] = useState(() => ({ start: isoDaysAgo(180), end: isoDaysAgo(0) }));
  const { data, error, loading } = useAsync(`${ticker}|${range.start}|${range.end}`, () =>
    api.stockHistory(ticker, range.start, range.end),
  );

  const input =
    "h-9 rounded-md border border-border bg-surface px-2 text-sm text-ink focus:border-accent";

  return (
    <div>
      <form
        className="mb-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setRange({ start, end });
        }}
      >
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          起
          <input type="date" value={start} min={minDate} max={end} onChange={(e) => setStart(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          迄
          <input type="date" value={end} min={start} max={maxDate} onChange={(e) => setEnd(e.target.value)} className={input} />
        </label>
        <button type="submit" className="h-9 rounded-md bg-accent px-4 text-sm font-semibold text-accent-fg transition-colors duration-150 hover:bg-accent-hover">
          重算這段區間
        </button>
        {data && data.count > 0 && data.hit_rate != null && (
          <span className="ml-auto text-xs text-ink-2">
            {data.count} 筆已到期，命中 {share(data.hit_rate)}
          </span>
        )}
      </form>

      {error != null && <p className="text-sm text-ink-2">{errorText(error, "這一檔的歷史回放還沒有產生。")}</p>}

      {loading ? (
        <p className="py-6 text-center text-sm text-ink-3">回放推論中，約需幾秒…</p>
      ) : data && data.records.length > 0 ? (
        <>
          <HitStrip records={data.records} />
          <p className="mt-1.5 text-xs text-ink-3">每格一次預測：實心＝命中、空心＝未命中，顏色是預測的方向；左舊右新。</p>
          <div className="relative mt-3 max-h-72 overflow-auto border-t border-border">
            <table className="w-full min-w-[19rem] text-table">
              <thead className="sticky top-0 bg-surface-2">
                <tr className="text-left text-xs text-ink-3">
                  <th scope="col" className="px-3 py-2 font-medium">日期</th>
                  <th scope="col" className="px-3 py-2 font-medium">預測</th>
                  <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">信心</th>
                  <th scope="col" className="px-3 py-2 font-medium sm:pl-6">實際</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">5 日報酬</th>
                  <th scope="col" className="px-3 py-2 text-center font-medium">命中</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.records.map((r) => (
                  <tr key={r.date}>
                    <td className="whitespace-nowrap px-3 py-1.5 text-ink-2">{r.date}</td>
                    <td className="px-3 py-1.5 font-semibold" style={{ color: `var(${SIGNAL_VAR[r.signal]})` }}>
                      {r.signal}
                    </td>
                    <td className="hidden px-3 py-1.5 text-right text-ink-2 sm:table-cell">{share(r.confidence)}</td>
                    <td className="px-3 py-1.5 font-semibold sm:pl-6" style={{ color: `var(${SIGNAL_VAR[r.actual]})` }}>
                      {r.actual}
                    </td>
                    <td className="px-3 py-1.5 text-right text-ink-2">{pct(r.actual_return)}</td>
                    <td className="px-3 py-1.5 text-center">
                      <HitMark hit={r.hit} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : data ? (
        <p className="py-6 text-center text-sm text-ink-3">這段區間沒有已到期的預測。把起日往前調再試。</p>
      ) : null}

      <p className="mt-3 text-xs leading-relaxed text-ink-3">
        回放是事後的 point-in-time 重算（特徵只用當日與更早的資料），只列已到期的樣本；與線上實證互相對照。
      </p>
    </div>
  );
}
