"use client";

import { fetchSentiment, sentimentTickerFor, type SentimentResponse } from "@/lib/newsApi";
import { fixed } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

// 放在台股脈絡下對齊台股慣例：正面＝偏多＝紅、負面＝偏空＝綠（與新聞站的美股頁相反，卡上註明）
const LABEL: Record<SentimentResponse["label"], { text: string; varName: string }> = {
  positive: { text: "偏多", varName: "--up" },
  negative: { text: "偏空", varName: "--down" },
  neutral: { text: "中性", varName: "--hold" },
};

/** 刻度：−1 到 +1，標記目前的情緒指數 */
function ScoreScale({ score }: { score: number }) {
  const at = ((score + 1) / 2) * 100;
  return (
    <div className="mt-3" aria-hidden="true">
      <div className="relative h-2 rounded-full bg-[linear-gradient(90deg,var(--down-soft),var(--surface-3),var(--up-soft))]">
        <div className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded bg-ink" style={{ left: `calc(${at}% - 2px)` }} />
      </div>
      <div className="mt-1 flex justify-between text-xs text-ink-3">
        <span>−1 偏空</span>
        <span>0</span>
        <span>+1 偏多</span>
      </div>
    </div>
  );
}

/** 新聞情緒（跨專案：新聞站的每日匯出）。讀不到時說明原因，不影響其他區塊。 */
export default function SentimentCard({ twTicker }: { twTicker: string }) {
  const { ticker: usTicker, isProxy } = sentimentTickerFor(twTicker);
  const { data, error, loading } = useAsync(usTicker, () => fetchSentiment(usTicker));

  return (
    <div>
      <p className="text-xs text-ink-3">{isProxy ? "這檔沒有美股 ADR，改看美股科技大盤（QQQ）的新聞情緒" : `美股 ADR ${usTicker} 的新聞情緒`}</p>

      {error != null && (
        <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-xs text-ink-2">
          {process.env.NEXT_PUBLIC_STATIC_DATA === "1"
            ? "新聞站的情緒資料暫時讀不到。稍後重新整理再試。"
            : "新聞站的後端（:8001）沒有啟動。"}
        </p>
      )}
      {loading && <p className="mt-3 text-sm text-ink-3">讀取中…</p>}

      {data && (
        <>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
            <span className="text-2xl font-semibold" style={{ color: `var(${LABEL[data.label].varName})` }}>
              {LABEL[data.label].text}
            </span>
            <span className="text-sm text-ink-2">
              指數 {fixed(data.score, 2, true)}，共 {data.article_count} 則
            </span>
          </div>
          <ScoreScale score={data.score} />

          {data.keywords.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="熱門關鍵字">
              {data.keywords.slice(0, 5).map((k) => (
                <li key={k.word} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-ink-2">
                  {k.word}
                </li>
              ))}
            </ul>
          )}

          {(data.is_mock || data.stale) && (
            <p className="mt-2 text-xs text-warn">
              {data.is_mock ? "情緒模型沒有載入，這是示意資料。" : "新聞來源暫時讀不到，顯示的是上一次的結果。"}
            </p>
          )}
        </>
      )}

      <p className="mt-3 border-t border-border pt-2 text-xs leading-relaxed text-ink-3">
        由新聞站（BERT 財經新聞情緒分析）提供，只涵蓋英文新聞；台股僅供跨市場參考，不是預測模型的輸入。這裡把正面標成紅色，與台股紅漲慣例一致。
      </p>
    </div>
  );
}
