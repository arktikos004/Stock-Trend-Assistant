import type { RankSummaryResponse } from "@/lib/api";
import { fixed, pct, share } from "@/lib/format";
import { LINKS } from "@/lib/links";

/** 相對強弱排序的回測摘要：Rank IC 為主要證據（Newey–West t），扣成本的組合超額只是示意。 */
export default function StrategySummaryCard({ s }: { s: RankSummaryResponse | null }) {
  if (!s || !s.available) {
    return <p className="text-sm text-ink-3">回測摘要還沒有產生（需要先跑 cross_sectional report）。</p>;
  }
  // 顯著性看 Newey–West t（相鄰基準日的 5 日報酬重疊，樸素 t 會高估）；舊資料沒有時退回樸素 t
  const nw = s.test_rank_ic_t_nw ?? null;
  const t = nw ?? s.test_rank_ic_t;
  return (
    <div>
      <dl>
        <dt className="text-xs text-ink-3">測試期 Rank IC</dt>
        <dd className="mt-0.5 flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-ink">{fixed(s.test_rank_ic, 3, true)}</span>
          <span className="text-sm text-ink-2">{nw != null ? `Newey–West t ${fixed(nw, 2)}` : `t ${fixed(s.test_rank_ic_t, 2)}`}</span>
        </dd>
        <dd className="mt-0.5 text-xs text-ink-3">
          {t != null && t >= 2 ? "達雙尾 5% 顯著（t ≥ 2）" : "未達雙尾 5% 顯著（t < 2）"}
          {nw != null && s.test_rank_ic_t != null && `；未處理重疊的樸素 t 為 ${fixed(s.test_rank_ic_t, 2)}`}
        </dd>
      </dl>
      {/* 組合超額只是示意：放在輔助說明裡，字級與顏色都不和主要證據 Rank IC 競爭 */}
      <p className="mt-3 text-sm text-ink-2">
        示意組合（前 20% 對全池，每 {s.holding_days} 日換股）扣成本超額 {pct(s.net_excess_cum)}，勝率 {share(s.win_rate)}。
      </p>
      <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-ink-3">
        Rank IC 是主要證據（不受多頭行情影響，樣本外 2025–2026）。組合超額已扣約 {s.cost_bps?.toFixed(0)} bp 來回成本，只是示意，不是投資建議；絕對報酬多半來自市場 beta。方法依 Gu、Kelly 與 Xiu（2020）及 Grinold 主動管理基本定律。
        <a className="ml-1 text-accent underline-offset-2 hover:underline" href={LINKS.rankReport} target="_blank" rel="noopener noreferrer">
          完整回測報告
        </a>
      </p>
    </div>
  );
}
