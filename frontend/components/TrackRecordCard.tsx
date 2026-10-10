import { CircleCheck, CircleX, Clock } from "lucide-react";
import type { PastPrediction, Signal, TrackRecordResponse } from "@/lib/api";
import { pct, share } from "@/lib/format";
import { LINKS } from "@/lib/links";

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

/** 這一檔最近的線上預測與實際走勢。每筆在推論當下寫入、不可回改；命中與失誤都列出。 */
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
      {trackRecord && trackRecord.matured > 0 && (
        <p className="mb-3 text-xs text-ink-2">
          全站已到期 {trackRecord.matured.toLocaleString()} 筆，命中 {share(trackRecord.hit_rate)}。
          <a className="ml-1 text-accent underline-offset-2 hover:underline" href={LINKS.onlineReport} target="_blank" rel="noopener noreferrer">
            與全猜「觀望」的基線比較
          </a>
        </p>
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-ink-3">這一檔還沒有線上預測紀錄。每日排程收盤後會寫入當天的預測。</p>
      ) : (
        <div className="relative -mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[19rem] text-table">
            <thead>
              <tr className="border-b border-border text-left text-xs text-ink-3">
                <th scope="col" className="py-2 pr-3 font-medium">基準日</th>
                <th scope="col" className="py-2 pr-3 font-medium">預測</th>
                <th scope="col" className="hidden py-2 pr-3 text-right font-medium sm:table-cell">信心</th>
                <th scope="col" className="py-2 pr-3 font-medium">實際</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">5 日報酬</th>
                <th scope="col" className="py-2 text-center font-medium">命中</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => (
                <tr key={`${r.base_date}-${r.model_version}`}>
                  <td className="py-2 pr-3 text-ink-2">{r.base_date}</td>
                  <td className="py-2 pr-3 font-semibold" style={{ color: `var(${SIGNAL_VAR[r.signal]})` }}>
                    {r.signal}
                  </td>
                  <td className="hidden py-2 pr-3 text-right text-ink-2 sm:table-cell">{share(r.confidence)}</td>
                  <td className="py-2 pr-3 font-semibold" style={{ color: r.actual ? `var(${SIGNAL_VAR[r.actual]})` : "var(--ink-3)" }}>
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

      <p className="mt-3 text-xs leading-relaxed text-ink-3">
        每筆預測在推論當下寫入資料庫，之後不能修改，並串入存證鏈；到期後用實際的 5 日走勢對照。
      </p>
    </div>
  );
}
