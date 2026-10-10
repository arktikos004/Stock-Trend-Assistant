"use client";

/**
 * 全池相對強弱排序：回測摘要、查詢日期（最近 60 個交易日）與可排序的 49 檔排序表，可下載 CSV。
 * 資料來自 /api/rank 與 /api/rank/summary（靜態站讀 rank/*.json）。
 */

import { Download } from "lucide-react";
import { useMemo } from "react";
import RankTable from "@/components/rank/RankTable";
import StrategySummaryCard from "@/components/StrategySummaryCard";
import { Notice, TableSkeleton } from "@/components/ui/Feedback";
import Panel from "@/components/ui/Panel";
import { api, datedSessions } from "@/lib/api";
import { code } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import { errorText, useAsync } from "@/lib/useAsync";
import { useWatchlist } from "@/lib/watchlist";
import DateQuery from "./DateQuery";

export default function RankView({ date, onDate }: { date: string | null; onDate: (d: string | null) => void }) {
  const summary = useAsync("rank-summary", () => api.rankSummary());
  const sessions = useAsync("rank-sessions", () => datedSessions("rank"));
  const screener = useAsync("screener", () => api.screener());
  const data = useAsync(`rank|${date ?? "latest"}`, () => api.rank(date ?? undefined));
  const watchlist = useWatchlist();
  const tiers = useMemo(() => new Map(screener.data?.stocks.map((s) => [s.ticker, s.tier]) ?? []), [screener.data]);
  const rows = data.data?.results ?? [];

  return (
    <div className="space-y-5">
      <Panel title="回測摘要" description={summary.data?.model ? `模型 ${summary.data.model}` : undefined}>
        {summary.error ? <p className="text-sm text-ink-3">回測摘要讀不到。</p> : <StrategySummaryCard s={summary.data ?? null} />}
      </Panel>

      <Panel
        title={data.data ? `${data.data.base_date} 的排序（${rows.length} 檔）` : "全池排序"}
        description={data.data ? (data.data.is_historical ? "歷史查詢：point-in-time 重算" : "最新收盤的排序") : undefined}
        actions={
          <button
            type="button"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(
                `rank-${data.data?.base_date ?? "latest"}.csv`,
                ["名次", "代號", "名稱", "分數", "百分位", "篩選層級"],
                rows.map((r) => [r.rank, code(r.ticker), r.name, r.score.toFixed(4), r.percentile.toFixed(4), tiers.get(r.ticker) ?? ""]),
              )
            }
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink disabled:opacity-50"
          >
            <Download size={14} aria-hidden="true" />
            下載 CSV
          </button>
        }
        bodyClassName="p-0"
      >
        <div className="border-b border-border px-4 py-3">
          <DateQuery value={date} sessions={sessions.data ?? null} onChange={onDate} />
        </div>
        {data.error ? (
          <div className="p-4">
            <Notice tone="error">{errorText(data.error, "這一天的排序沒有產生。")}</Notice>
          </div>
        ) : data.loading ? (
          <div className="p-4">
            <TableSkeleton rows={12} label="排序讀取中" />
          </div>
        ) : data.data?.is_mock ? (
          <p className="p-6 text-center text-sm text-ink-3">相對強弱模型還沒有載入。</p>
        ) : (
          <RankTable rows={rows} tiers={tiers} watchlist={watchlist} sortable />
        )}
      </Panel>

      <p className="text-xs leading-relaxed text-ink-3">
        分數是模型預測「未來 5 個交易日贏過全池中位數」的機率，名次越前代表相對越強；分組以前、後 20% 分為強、弱。
        歷史查詢是 point-in-time 重算。研究用的排序，不是投資建議。
      </p>
    </div>
  );
}
