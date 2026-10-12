import { CircleCheck, CircleX, Clock } from "lucide-react";
import type { PastPrediction, Signal, TrackRecordResponse } from "@/lib/api";
import Link from "next/link";
import HelpLink from "@/components/ui/HelpLink";
import { fixed, pct, share } from "@/lib/format";

const SIGNAL_VAR: Record<Signal, string> = { 漲: "--up", 跌: "--down", 觀望: "--hold" };

/** 命中與否用中性的實心／空心圖示，不用紅綠（紅綠在這張表裡已經代表漲跌） */
export function HitMark({ hit }: { hit: boolean | null }) {
  if (hit == null)
    return (
      <span className="inline-flex items-center gap-1 text-ink-3">
        <Clock size={14} aria-hidden="true" />
        <span className="sr-only">未到期</span>
      </span>
    );
  return hit ? (
    <span className="inline-flex items-center gap-1 text-ink">
      <CircleCheck size={15} aria-hidden="true" />
      <span className="sr-only">命中</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-ink-3">
      <CircleX size={15} aria-hidden="true" />
      <span className="sr-only">未命中</span>
    </span>
  );
}

/** 全站命中率一定和同一批樣本的基線一起看：全猜「觀望」、全猜「漲」與差距（百分點）、95% 區間 */
function Baseline({ trackRecord }: { trackRecord: TrackRecordResponse }) {
  const all = trackRecord.samples?.find((s) => s.key === "all");
  const hold = all?.baseline_hold;
  const up = all?.baseline_up;
  const gap = all?.hit_rate != null && hold != null ? (all.hit_rate - hold) * 100 : null;
  return (
    <p className="mb-3 text-sm leading-relaxed text-ink-2">
      全站已到期 {trackRecord.matured.toLocaleString()} 筆，命中 {share(trackRecord.hit_rate)}
      {hold != null && up != null ? (
        <>
          ；同一批樣本全猜「觀望」{share(hold)}、全猜「漲」{share(up)}。比全猜觀望 {fixed(gap, 1, true)} 個百分點
          {all?.ci_excess_hold && `（95% 區間 ${fixed(all.ci_excess_hold[0] * 100, 1, true)}～${fixed(all.ci_excess_hold[1] * 100, 1, true)}）`}。
        </>
      ) : (
        "。"
      )}
      <Link href="/monitor" className="ml-1 text-accent underline-offset-2 hover:underline">
        看監控頁的完整比較
      </Link>
    </p>
  );
}

/** 這一檔最近的線上預測與實際走勢。命中與失誤都列出。 */
export default function TrackRecordCard({
  ticker,
  records,
  trackRecord,
}: {
  ticker: string;
  records: PastPrediction[];
  trackRecord: TrackRecordResponse | null;
}) {
  const shown = records.slice(0, 8);
  return (
    <div data-ticker={ticker}>
      {trackRecord && trackRecord.matured > 0 && <Baseline trackRecord={trackRecord} />}

      {shown.length === 0 ? (
        <p className="text-sm text-ink-3">這一檔還沒有線上預測紀錄。每日排程收盤後會寫入當天的預測。</p>
      ) : (
        <div className="relative -mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[19rem] text-table">
            <thead>
              <tr className="border-b border-border text-left text-xs text-ink-3">
                <th scope="col" className="py-2 pr-3 font-medium">基準日</th>
                <th scope="col" className="py-2 pr-3 font-medium">預測</th>
                <th scope="col" className="hidden py-2 pr-3 text-right font-medium sm:table-cell">模型機率</th>
                <th scope="col" className="py-2 pr-3 font-medium sm:pl-6">實際</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">5 日報酬</th>
                <th scope="col" className="py-2 text-center font-medium">命中</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => (
                <tr key={`${r.base_date}-${r.model_version}`}>
                  <td className="whitespace-nowrap py-2 pr-3 text-ink-2">{r.base_date}</td>
                  <td className="py-2 pr-3 font-semibold" style={{ color: `var(${SIGNAL_VAR[r.signal]})` }}>
                    {r.signal}
                  </td>
                  <td className="hidden py-2 pr-3 text-right text-ink-2 sm:table-cell">{share(r.confidence)}</td>
                  <td className="py-2 pr-3 font-semibold sm:pl-6" style={{ color: r.actual ? `var(${SIGNAL_VAR[r.actual]})` : "var(--ink-3)" }}>
                    {r.actual ?? "未到期"}
                  </td>
                  <td className="py-2 pr-3 text-right text-ink-2">{pct(r.actual_return, 2)}</td>
                  <td className="py-2 text-center">
                    <HitMark hit={r.hit} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-sm leading-relaxed text-ink-2">
        到期後用實際的 5 日走勢對照；2026-10-07 起串入存證鏈。
        <HelpLink to="direction" className="ml-1" />
      </p>
    </div>
  );
}
