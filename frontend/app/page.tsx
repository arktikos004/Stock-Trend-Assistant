"use client";

/**
 * 總覽：今天的星圖。標題下一行回答資料是哪一天的、有沒有存證、模型目前的狀態。
 * 桌機兩欄各自往下排：左邊是前 10 名（星點＝星等）、大盤、前三後三；右邊是星圖、存證星鏈與到期成績（星鏈要在第一屏）。
 * 手機單欄時兩欄拆開（contents），依 order 排成表格、星圖、存證、成績、大盤、前三後三；各區塊彼此獨立，鍵盤順序照桌機的欄。
 */

import { ShieldX, Star } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import LedgerPanel from "@/components/overview/LedgerPanel";
import MarketPanel from "@/components/overview/MarketPanel";
import MaturedPanel from "@/components/overview/MaturedPanel";
import RankEndsPanel from "@/components/overview/RankEndsPanel";
import SkyPlate from "@/components/overview/SkyPlate";
import TodayLine from "@/components/overview/TodayLine";
import RankTable from "@/components/rank/RankTable";
import { EmptyState, Notice, Skeleton, TableSkeleton } from "@/components/ui/Feedback";
import Hint from "@/components/ui/Hint";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";
import Segmented from "@/components/ui/Segmented";
import { api, ledgerSnapshot, siteMeta, STATIC_DATA, type LedgerSnapshot, type RankResponse } from "@/lib/api";
import { errorText, useAsync } from "@/lib/useAsync";
import { useWatchlist } from "@/lib/watchlist";

const TOP = 10;
const COLUMN = "contents lg:flex lg:flex-col lg:gap-14";

/**
 * 存證出問題時的提醒（驗證不符、這次沒有鏈檔）；正常時標題下那一行已經寫了，這裡不重複。
 * 依據是上鏈之後匯出的快照（ledger.json）；舊版網站資料沒有快照時不下結論。
 */
function SealLine({ snapshot, rank }: { snapshot: LedgerSnapshot | null | undefined; rank: RankResponse | undefined }) {
  if (!snapshot || !rank || rank.basis === undefined) return null;
  if (!snapshot.available) {
    return <Notice>這次匯出沒有取得存證鏈檔，下一次每日排程會重試。</Notice>;
  }
  if (!snapshot.ok) {
    return (
      <Notice tone="error" icon={ShieldX}>
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
  const snapshot = ledger.error ? null : ledger.data;

  return (
    <>
      <PageHeader
        title="今日相對強弱排序"
        wide
        description={<TodayLine rank={rank.data} model={monitor.data?.model} meta={meta.data} snapshot={snapshot} />}
      />

      <div className="mb-8 empty:hidden">
        <SealLine snapshot={snapshot} rank={rank.data} />
      </div>

      <div className="flex flex-col gap-14 lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start lg:gap-x-14">
        <div className={COLUMN}>
          <Panel
            className="order-1"
            title={view === "top" ? `前 ${TOP} 名` : "自選股的名次"}
            description={model ? `相對強弱模型 ${model}，預測未來 5 個交易日` : undefined}
            actions={
              <span className="flex items-center gap-2">
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
                <Hint to="rank" anchor="score" label="排序表">
                  <p>分數是模型估計贏過全池中位數的機率，沒有做過校準；星點是依百分位的星等。名次只是相對位置，排名靠前仍可能下跌。</p>
                </Hint>
              </span>
            }
            bodyClassName="p-0"
          >
            {rank.error ? (
              <div className="pt-5">
                <Notice tone="error">{errorText(rank.error, "今日排序還沒有產生。每個交易日 15:20 後由排程產生。")}</Notice>
              </div>
            ) : rank.loading ? (
              <div className="pt-5">
                <TableSkeleton rows={TOP} label="排序讀取中" />
              </div>
            ) : rows.length > 0 ? (
              <RankTable rows={rows} tiers={tiers} watchlist={watchlist} />
            ) : (
              <EmptyState icon={Star} title="還沒有自選股">
                在個股頁按「加入自選」，這裡就會列出它在今日排序中的名次。自選只存在這台裝置的瀏覽器。
              </EmptyState>
            )}
            <p className="pt-4 text-sm">
              <Link href="/scan" className="link font-medium">
                看全部 {results.length || 50} 檔的排序
              </Link>
            </p>
          </Panel>
          <MarketPanel className="order-5" market={market.data} />
          <RankEndsPanel className="order-6" rank={rank.data} error={rank.error} />
        </div>

        <div className={COLUMN}>
          <Panel className="order-2" title="今日星圖" description="橫軸近 20 日報酬，縱軸模型分數，星越大越強">
            {rank.data && screener.data ? (
              <SkyPlate results={rank.data.results} stocks={screener.data.stocks} />
            ) : rank.error || screener.error ? (
              <p className="py-10 text-center text-sm text-ink-3">排序或篩選器的資料還沒有產生，星圖暫時畫不出來。</p>
            ) : (
              <Skeleton className="aspect-square w-full sm:aspect-[4/3]" />
            )}
          </Panel>
          <LedgerPanel className="order-3" snapshot={snapshot} fallback={monitor.data?.ledger} />
          <MaturedPanel className="order-4" model={monitor.data?.model} />
        </div>
      </div>
    </>
  );
}
