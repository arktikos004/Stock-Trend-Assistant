"use client";

/**
 * 總覽：今天的相對強弱排序，旁邊是它的存證狀態、上一份到期成績與大盤。
 * 第一屏回答研究員收盤後的三個問題：今天的排序是什麼、封存了沒、模型最近可不可信。
 */

import { ShieldCheck, ShieldX, Star } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import LedgerPanel from "@/components/overview/LedgerPanel";
import MarketPanel from "@/components/overview/MarketPanel";
import MaturedPanel from "@/components/overview/MaturedPanel";
import RankTable from "@/components/rank/RankTable";
import { EmptyState, Notice, TableSkeleton } from "@/components/ui/Feedback";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";
import Segmented from "@/components/ui/Segmented";
import { api, ledgerHead, type MonitorResponse } from "@/lib/api";
import { taipeiTime } from "@/lib/format";
import { errorText, useAsync } from "@/lib/useAsync";
import { useWatchlist } from "@/lib/watchlist";

const TOP = 10;

/** 一句話的存證狀態：今天的排序有沒有全部上鏈、驗證結果如何 */
function SealLine({ ledger, recordedAt }: { ledger: MonitorResponse["ledger"]; recordedAt?: string }) {
  if (!ledger.available) {
    return <Notice>這次匯出沒有取得存證鏈檔，下一次每日排程會重試。</Notice>;
  }
  if (!ledger.ok) {
    return (
      <Notice tone="warn" icon={ShieldX}>
        存證鏈驗證不符：{ledger.problems[0] ?? "資料庫與鏈檔對不上"}。在問題排除前，請把這份排序當作未存證。
      </Notice>
    );
  }
  const pending = (ledger.pending.predictions ?? 0) + (ledger.pending.rank_predictions ?? 0);
  if (pending > 0) {
    return (
      <Notice>
        還有 {pending.toLocaleString()} 列預測等待上鏈；每日排程保存資料後，會串進下一節存證鏈。
      </Notice>
    );
  }
  return (
    <p className="mb-5 flex items-start gap-2 text-sm text-ink-2">
      <ShieldCheck size={17} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
      <span>
        今天的排序已全部寫入存證鏈：共 {ledger.entries} 節
        {recordedAt && `，最新一節 ${taipeiTime(recordedAt)} 寫入`}，驗證通過。之後任何一列被改動，驗證都會失敗。
      </span>
    </p>
  );
}

export default function OverviewPage() {
  const rank = useAsync("rank", () => api.rank());
  const monitor = useAsync("monitor", () => api.monitor());
  const screener = useAsync("screener", () => api.screener());
  const market = useAsync("market", () => api.market());
  const head = useAsync("ledger-head", ledgerHead);
  const watchlist = useWatchlist();
  const [view, setView] = useState<"top" | "watch">("top");

  const tiers = useMemo(() => new Map(screener.data?.stocks.map((s) => [s.ticker, s.tier]) ?? []), [screener.data]);
  const results = rank.data?.results ?? [];
  const rows = view === "top" ? results.slice(0, TOP) : results.filter((r) => watchlist.includes(r.ticker));
  const model = monitor.data?.model.version ?? rank.data?.model;

  return (
    <>
      <PageHeader
        title="今天的相對強弱排序"
        description={
          rank.data ? (
            <>
              基準日 {rank.data.base_date}。模型依收盤資料，預測台灣 50 成分股在未來 5 個交易日誰相對強；分數是贏過全池中位數的機率。研究用的排序，不是投資建議。
            </>
          ) : (
            "預測台灣 50 成分股在未來 5 個交易日誰相對強。研究用的排序，不是投資建議。"
          )
        }
      />

      {monitor.data && <SealLine ledger={monitor.data.ledger} recordedAt={head.data?.recorded_at} />}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <Panel
          title={view === "top" ? `前 ${TOP} 名` : "自選股的名次"}
          description={model ? `相對強弱模型 ${model}` : undefined}
          actions={
            <Segmented
              label="排序表範圍"
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: "top", label: `前 ${TOP} 名` },
                { value: "watch", label: `自選 ${watchlist.length}` },
              ]}
            />
          }
          bodyClassName="p-0"
        >
          {rank.error ? (
            <div className="p-4">
              <Notice tone="error">{errorText(rank.error, "今天的排序還沒有產生。每個交易日 15:20 後由排程產生。")}</Notice>
            </div>
          ) : rank.loading ? (
            <div className="p-4">
              <TableSkeleton rows={TOP} label="排序讀取中" />
            </div>
          ) : rows.length > 0 ? (
            <RankTable rows={rows} tiers={tiers} watchlist={watchlist} />
          ) : (
            <EmptyState icon={Star} title="還沒有自選股">
              在個股頁按「加入自選」，這裡就會列出它在今天排序中的名次。自選只存在這台裝置的瀏覽器。
            </EmptyState>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm">
            <Link href="/scan" className="font-medium text-accent hover:underline">
              看全部 {results.length || 49} 檔的排序
            </Link>
            <span className="text-xs text-ink-3">分數條以 0.5 為中線；分組是前 20% 為強、後 20% 為弱；篩選欄是篩選器的層級。</span>
          </div>
        </Panel>

        <div className="space-y-5">
          <LedgerPanel ledger={monitor.data?.ledger} head={head.data} headFailed={head.error != null} />
          <MaturedPanel model={monitor.data?.model} />
          <MarketPanel market={market.data} />
        </div>
      </div>
    </>
  );
}
