"use client";

/**
 * 排序：相對強弱排名（主模型，預設）與方向訊號兩種模式。模式與查詢日期寫在網址
 * （/scan?mode=signal&date=2026-10-01），可以分享、重新整理不會跑掉。
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import DateQuery from "@/components/DateQuery";
import RankView from "@/components/RankView";
import { HitMark } from "@/components/TrackRecordCard";
import Badge from "@/components/ui/Badge";
import { Notice, Skeleton, TableSkeleton } from "@/components/ui/Feedback";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";
import Segmented from "@/components/ui/Segmented";
import { api, datedSessions, siteMeta, STATIC_DATA, type ScanResponse, type ScanResult, type Signal } from "@/lib/api";
import { code, pct, share } from "@/lib/format";
import { errorText, useAsync } from "@/lib/useAsync";

type Mode = "rank" | "signal";
const SIGNAL_VAR: Record<Signal, string> = { 漲: "--up", 跌: "--down", 觀望: "--hold" };
const ORDER: Signal[] = ["漲", "觀望", "跌"];
type SortKey = "confidence" | "signal" | "name";

/** 規則降級：觀望的機率低於漲或跌，只因信心不足才轉為觀望 */
const downgraded = (r: ScanResult) => r.signal === "觀望" && r.proba["觀望"] < Math.max(r.proba["漲"], r.proba["跌"]);

function Distribution({ data }: { data: ScanResponse }) {
  const total = data.up + data.hold + data.down || 1;
  const segs = [
    { key: "漲" as Signal, n: data.up },
    { key: "觀望" as Signal, n: data.hold },
    { key: "跌" as Signal, n: data.down },
  ];
  return (
    <div>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={segs.map((s) => `${s.key} ${s.n} 檔`).join("、")}>
        {segs.map((s) => (s.n === 0 ? null : <div key={s.key} style={{ flex: `${s.n} 1 0`, background: `var(${SIGNAL_VAR[s.key]})` }} />))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {segs.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: `var(${SIGNAL_VAR[s.key]})` }} aria-hidden="true" />
            <span className="font-semibold" style={{ color: `var(${SIGNAL_VAR[s.key]})` }}>
              {s.key}
            </span>
            <span className="text-ink-2">
              {s.n} 檔（{share(s.n / total)}）
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SignalView({ date, onDate }: { date: string | null; onDate: (d: string | null) => void }) {
  const data = useAsync(`scan|${date ?? "latest"}`, () => api.scan(date ?? undefined));
  const sessions = useAsync("scan-sessions", () => datedSessions("scan"));
  const meta = useAsync(STATIC_DATA ? "meta" : null, siteMeta);
  const [filter, setFilter] = useState<"all" | Signal>("all");
  const [sortKey, setSortKey] = useState<SortKey>("confidence");

  const rows = useMemo(() => {
    if (!data.data) return [];
    const list = filter === "all" ? [...data.data.results] : data.data.results.filter((r) => r.signal === filter);
    if (sortKey === "confidence") list.sort((a, b) => b.confidence - a.confidence);
    else if (sortKey === "signal") list.sort((a, b) => ORDER.indexOf(a.signal) - ORDER.indexOf(b.signal) || b.confidence - a.confidence);
    else list.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
    return list;
  }, [data.data, filter, sortKey]);

  const d = data.data;
  // 休市日（例如補假）排程仍會產生預測，但沒有新的收盤資料：標明實際用到哪一天的資料
  const asOf = meta.data?.data_as_of;
  const staleBase = d && !d.is_historical && asOf && d.base_date > asOf;

  return (
    <Panel
      title={d ? `${d.base_date} 的方向訊號（${d.results.length} 檔）` : "方向訊號"}
      description={
        d
          ? d.is_historical
            ? `歷史回放：point-in-time 重算，模型 ${d.model_version}`
            : `最新收盤${staleBase ? `（${d.base_date} 沒有新的收盤資料，使用截至 ${asOf} 的資料）` : ""}，模型 ${d.model_version}`
          : undefined
      }
      bodyClassName="p-0"
    >
      <div className="space-y-4 border-b border-border px-4 py-3">
        <DateQuery value={date} sessions={sessions.data ?? null} onChange={onDate} />
        {d && d.results.length > 0 && <Distribution data={d} />}
        {d?.is_historical && d.matured > 0 && (
          <p className="text-sm text-ink-2">
            這一天已到期 {d.matured} 檔，命中 {share(d.hits / d.matured)}。
          </p>
        )}
        {d && (
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              label="只看某種訊號"
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "全部" },
                { value: "漲", label: "漲" },
                { value: "觀望", label: "觀望" },
                { value: "跌", label: "跌" },
              ]}
            />
            <Segmented
              label="排序方式"
              size="sm"
              value={sortKey}
              onChange={setSortKey}
              options={[
                { value: "confidence", label: "依信心" },
                { value: "signal", label: "依訊號" },
                { value: "name", label: "依名稱" },
              ]}
            />
          </div>
        )}
      </div>

      {data.error ? (
        <div className="p-4">
          <Notice tone="error">{errorText(data.error, "這一天的方向訊號沒有產生。")}</Notice>
        </div>
      ) : data.loading ? (
        <div className="p-4">
          <TableSkeleton rows={12} label="方向訊號讀取中" />
        </div>
      ) : d?.is_mock ? (
        <p className="p-6 text-center text-sm text-ink-3">模型還沒有載入，無法產生方向訊號。</p>
      ) : d ? (
        // 窄螢幕欄位放不下，需要水平捲動（表頭不固定）；md 以上不當捲動容器，表頭才能固定在頂列下方
        <div className="relative overflow-x-auto md:overflow-x-visible">
          <table className="w-full min-w-[22rem] text-table">
            <thead className="sticky top-14 z-10 bg-surface-2 [&_th]:shadow-[inset_0_-1px_0_var(--border)]">
              <tr className="text-left text-xs text-ink-3">
                <th scope="col" className="px-3 py-2 font-medium">股票</th>
                <th scope="col" className="px-3 py-2 font-medium">訊號</th>
                <th scope="col" className="px-3 py-2 font-medium">三類機率（漲／觀望／跌）</th>
                {d.is_historical && <th scope="col" className="px-3 py-2 font-medium">實際</th>}
                {d.is_historical && <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">5 日報酬</th>}
                {d.is_historical && <th scope="col" className="px-3 py-2 text-center font-medium">命中</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.ticker} className="transition-colors duration-150 hover:bg-surface-2">
                  <td className="px-3 py-2">
                    <Link href={`/stock?t=${encodeURIComponent(r.ticker)}`} className="font-medium text-ink hover:underline">
                      {r.name}
                    </Link>
                    <span className="ml-2 text-xs text-ink-3">{code(r.ticker)}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold" style={{ color: `var(${SIGNAL_VAR[r.signal]})` }}>
                        {r.signal}
                      </span>
                      {downgraded(r) && <Badge tone="hold">規則降級</Badge>}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-2">
                    {ORDER.map((s, i) => (
                      <span key={s} className={r.signal === s ? "font-semibold text-ink" : ""}>
                        {i > 0 && <span className="mx-1 text-ink-3">／</span>}
                        {share(r.proba[s])}
                      </span>
                    ))}
                  </td>
                  {d.is_historical && (
                    <td className="px-3 py-2 font-semibold" style={{ color: r.actual ? `var(${SIGNAL_VAR[r.actual]})` : "var(--ink-3)" }}>
                      {r.actual ?? "未到期"}
                    </td>
                  )}
                  {d.is_historical && <td className="hidden px-3 py-2 text-right text-ink-2 sm:table-cell">{pct(r.actual_return)}</td>}
                  {d.is_historical && (
                    <td className="px-3 py-2 text-center">
                      <HitMark hit={r.hit} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="border-t border-border px-4 py-3 text-xs leading-relaxed text-ink-3">
        方向訊號：未來 5 個交易日累積報酬大於 +2% 為漲、小於 −2% 為跌，其餘為觀望。信心未達決策門檻時轉為觀望（標「規則降級」）。全池掃描與模型走同一條特徵管線；歷史查詢只用當日與更早的資料重算。
      </p>
    </Panel>
  );
}

function ScanView() {
  const params = useSearchParams();
  const router = useRouter();
  const mode: Mode = params.get("mode") === "signal" ? "signal" : "rank";
  const date = params.get("date");

  const update = (next: { mode?: Mode; date?: string | null }) => {
    const q = new URLSearchParams(params.toString());
    if (next.mode) {
      if (next.mode === "rank") q.delete("mode");
      else q.set("mode", next.mode);
    }
    if (next.date !== undefined) {
      if (next.date) q.set("date", next.date);
      else q.delete("date");
    }
    const s = q.toString();
    router.replace(s ? `/scan?${s}` : "/scan", { scroll: false });
  };

  return (
    <>
      <PageHeader
        title="排序"
        description="台灣 50 全池的相對強弱排名（主模型）與方向訊號。可以查最近 60 個交易日的歷史結果。"
        actions={
          <Segmented
            label="檢視模式"
            value={mode}
            onChange={(m) => update({ mode: m, date: null })}
            options={[
              { value: "rank", label: "相對強弱排名" },
              { value: "signal", label: "方向訊號" },
            ]}
          />
        }
      />
      {mode === "rank" ? (
        <RankView key={`rank-${date ?? ""}`} date={date} onDate={(d) => update({ date: d })} />
      ) : (
        <SignalView key={`signal-${date ?? ""}`} date={date} onDate={(d) => update({ date: d })} />
      )}
    </>
  );
}

export default function ScanPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <ScanView />
    </Suspense>
  );
}
