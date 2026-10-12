"use client";

/**
 * 總覽。第一屏依序回答：資料是哪一天的 → 模型效果如何 → 目前有什麼限制，接著才是前 10 名與到期成績；
 * 存證只留一行狀態，細節（雜湊、驗證指令）收在存證面板的展開區。
 */

import { Info, ShieldCheck, ShieldX, Star } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import LedgerPanel, { pendingDays } from "@/components/overview/LedgerPanel";
import TodayFacts from "@/components/overview/TodayFacts";
import MarketPanel from "@/components/overview/MarketPanel";
import MaturedPanel from "@/components/overview/MaturedPanel";
import RankTable from "@/components/rank/RankTable";
import { EmptyState, Notice, TableSkeleton } from "@/components/ui/Feedback";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";
import Segmented from "@/components/ui/Segmented";
import { api, ledgerSnapshot, siteMeta, STATIC_DATA, type LedgerSnapshot, type RankResponse } from "@/lib/api";
import { taipeiTime } from "@/lib/format";
import { errorText, useAsync } from "@/lib/useAsync";
import { useWatchlist } from "@/lib/watchlist";

const TOP = 10;

/**
 * 一句話的存證狀態：這份排序是不是資料庫裡記錄、已串入存證鏈的那一份。
 * 依據是上鏈之後匯出的快照（ledger.json）與排序的來源（rank 的 basis）；舊版網站資料沒有這兩項時不下結論。
 */
function SealLine({ snapshot, rank }: { snapshot: LedgerSnapshot | null | undefined; rank: RankResponse | undefined }) {
  if (!snapshot || !rank || rank.basis === undefined) return null;
  if (!snapshot.available) {
    return <Notice>這次匯出沒有取得存證鏈檔，下一次每日排程會重試。</Notice>;
  }
  if (!snapshot.ok) {
    return (
      <Notice tone="warn" icon={ShieldX}>
        存證鏈驗證不符：{snapshot.problems[0] ?? "資料庫與鏈檔對不上"}。在問題排除前，請把這份排序當作未存證。
      </Notice>
    );
  }
  if (rank.basis === "recomputed") {
    return <Notice icon={Info}>資料庫裡沒有 {rank.base_date} 的排序紀錄，這份是重新評分的結果，沒有存證。</Notice>;
  }
  const sealed = snapshot.verified_through != null && rank.base_date <= snapshot.verified_through;
  if (!sealed) {
    return (
      <Notice icon={Info}>
        這份排序已記錄在資料庫，還沒串入存證鏈（待上鏈的基準日 {pendingDays(snapshot.pending_base_dates) || rank.base_date}）；下一次每日排程會上鏈。
      </Notice>
    );
  }
  return (
    <p className="mb-5 flex items-start gap-2 text-sm text-ink-2">
      <ShieldCheck size={17} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
      <span>
        這份排序就是資料庫記錄、並已串入存證鏈的那一份：驗證截至 {snapshot.verified_through} 的基準日
        {snapshot.head && `，最新一節 ${taipeiTime(snapshot.head.recorded_at)} 寫入`}。之後任何一列被改動，驗證都會失敗。
      </span>
    </p>
  );
}

export default function OverviewPage() {
  const rank = useAsync("rank", () => api.rank());
  const monitor = useAsync("monitor", () => api.monitor());
  const screener = useAsync("screener", () => api.screener());
  const market = useAsync("market", () => api.market());
  const ledger = useAsync("ledger", ledgerSnapshot);
  const meta = useAsync(STATIC_DATA ? "meta" : null, async () => {
    const m = await siteMeta();
    return { ...m, stale: Date.now() - Date.parse(m.generated_at) > 48 * 3600 * 1000 };
  });
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
        description="模型依收盤資料，排出台灣 50 成分股在未來 5 個交易日的相對強弱；分數是贏過全池中位數的模型機率。研究用的排序，不是投資建議。"
      />

      <TodayFacts rank={rank.data} model={monitor.data?.model} meta={meta.data} snapshot={ledger.error ? null : ledger.data} />

      <SealLine snapshot={ledger.error ? null : ledger.data} rank={rank.data} />

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
            <span className="text-sm text-ink-2">模型分數是模型輸出，不是百分位；分數條以 0.5 為中線。分組是名次在 49 檔裡的前 20%、後 20%；篩選欄是篩選器的層級。</span>
          </div>
        </Panel>

        <div className="space-y-5">
          <MaturedPanel model={monitor.data?.model} />
          <LedgerPanel snapshot={ledger.error ? null : ledger.data} fallback={monitor.data?.ledger} />
          <MarketPanel market={market.data} />
        </div>
      </div>
    </>
  );
}
