"use client";

/**
 * 總覽。第一屏依序回答：資料是哪一天的 → 模型效果如何 → 目前有什麼限制，接著才是前 10 名與到期成績；
 * 存證只留一行狀態，細節（雜湊、驗證指令）收在存證面板的展開區。
 * 右欄依序是到期成績、存證、大盤，最後才是名次前三與後三（前三就是左表的前三列，不必排在前面）。
 */

import { ShieldX, Star } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import LedgerPanel from "@/components/overview/LedgerPanel";
import TodayFacts from "@/components/overview/TodayFacts";
import HelpLink from "@/components/ui/HelpLink";
import MarketPanel from "@/components/overview/MarketPanel";
import MaturedPanel from "@/components/overview/MaturedPanel";
import RankEndsPanel from "@/components/overview/RankEndsPanel";
import RankTable from "@/components/rank/RankTable";
import { EmptyState, Notice, TableSkeleton } from "@/components/ui/Feedback";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";
import Segmented from "@/components/ui/Segmented";
import { api, ledgerSnapshot, siteMeta, STATIC_DATA, type LedgerSnapshot, type RankResponse } from "@/lib/api";
import { errorText, useAsync } from "@/lib/useAsync";
import { useWatchlist } from "@/lib/watchlist";

const TOP = 10;

/**
 * 存證出問題時的提醒（驗證不符、這次沒有鏈檔）；正常時第一屏的「資料日期」已經寫了，這裡不重複。
 * 依據是上鏈之後匯出的快照（ledger.json）；舊版網站資料沒有快照時不下結論。
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
  return null;
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
        title="今日相對強弱排序"
        description="台灣 50 成分股在未來 5 個交易日的相對強弱排序，依收盤為止的資料計算。"
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
              <Notice tone="error">{errorText(rank.error, "今日排序還沒有產生。每個交易日 15:20 後由排程產生。")}</Notice>
            </div>
          ) : rank.loading ? (
            <div className="p-4">
              <TableSkeleton rows={TOP} label="排序讀取中" />
            </div>
          ) : rows.length > 0 ? (
            <RankTable rows={rows} tiers={tiers} watchlist={watchlist} />
          ) : (
            <EmptyState icon={Star} title="還沒有自選股">
              在個股頁按「加入自選」，這裡就會列出它在今日排序中的名次。自選只存在這台裝置的瀏覽器。
            </EmptyState>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm">
            <Link href="/scan" className="font-medium text-accent hover:underline">
              看全部 {results.length || 49} 檔的排序
            </Link>
            <span className="text-sm text-ink-2">
              分組＝名次的前 20%、後 20%；模型分數不是百分位。
              <HelpLink to="rank" className="ml-1" />
            </span>
          </div>
        </Panel>

        <div className="space-y-5">
          <MaturedPanel model={monitor.data?.model} />
          <LedgerPanel snapshot={ledger.error ? null : ledger.data} fallback={monitor.data?.ledger} />
          <MarketPanel market={market.data} />
          <RankEndsPanel rank={rank.data} error={rank.error} />
        </div>
      </div>
    </>
  );
}
