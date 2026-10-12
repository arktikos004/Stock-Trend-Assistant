import type { RankSummaryResponse } from "@/lib/api";
import { fixed, pct, share } from "@/lib/format";
import { LINKS } from "@/lib/links";

const month = (iso: string | null | undefined) => iso?.slice(0, 7);

/**
 * 相對強弱排序的回測摘要：Rank IC 為主要證據（Newey–West t），扣成本的組合只是示意。
 * 組合與全池的差距是兩個累積報酬相減，單位是百分點，不是比率；期間含用來選模型與持有期的驗證期，直接寫明。
 */
export default function StrategySummaryCard({ s }: { s: RankSummaryResponse | null }) {
  if (!s || !s.available) {
    return <p className="text-sm text-ink-3">回測摘要還沒有產生（需要先跑 cross_sectional report）。</p>;
  }
  // 顯著性看 Newey–West t（相鄰基準日的 5 日報酬重疊，樸素 t 會高估）；舊資料沒有時退回樸素 t
  const nw = s.test_rank_ic_t_nw ?? null;
  const t = nw ?? s.test_rank_ic_t;
  const testPeriod = s.test_start && s.test_end ? `${month(s.test_start)} 至 ${month(s.test_end)}` : null;
  const portfolioPeriod = s.val_start && s.test_end ? `${month(s.val_start)} 至 ${month(s.test_end)}` : null;
  return (
    <div>
      <dl>
        <dt className="text-xs text-ink-3">
          測試期 Rank IC
          {testPeriod && `（${testPeriod}${s.test_rank_ic_days ? `，${s.test_rank_ic_days} 個交易日` : ""}）`}
        </dt>
        <dd className="mt-0.5 flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-ink">{fixed(s.test_rank_ic, 3, true)}</span>
          <span className="text-sm text-ink-2">{nw != null ? `Newey–West t ${fixed(nw, 2)}` : `t ${fixed(s.test_rank_ic_t, 2)}`}</span>
        </dd>
        <dd className="mt-0.5 text-xs text-ink-3">
          {t != null && t >= 2 ? "達雙尾 5% 顯著（t ≥ 2）" : "未達雙尾 5% 顯著（t < 2）"}
          {nw != null && s.test_rank_ic_t != null && `；未處理重疊的樸素 t 為 ${fixed(s.test_rank_ic_t, 2)}`}
        </dd>
      </dl>
      {/* 組合只是示意：放在輔助說明裡，字級與顏色都不和主要證據 Rank IC 競爭 */}
      <p className="mt-3 text-sm leading-relaxed text-ink-2">
        示意組合（名次前 20%，每 {s.holding_days} 日換股）扣成本後比全池等權多{" "}
        {s.net_excess_cum == null ? "—" : (s.net_excess_cum * 100).toFixed(1)} 個百分點：組合累積 {pct(s.net_cum)}、全池等權 {pct(s.bench_cum)}
        {portfolioPeriod && `，期間 ${portfolioPeriod}`}。{share(s.win_rate)} 的換股期贏過全池（以扣成本前的報酬比較）。
      </p>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">
        持有期與模型都是用 2025 年的績效選的，這段期間不是獨立驗證；成本約 {s.cost_bps?.toFixed(0)} bp 來回，未計入滑價；全池等權的基準沒有扣成本。
      </p>
      <p className="mt-4 border-t border-border pt-3 text-sm leading-relaxed text-ink-2">
        Rank IC 是主要證據：不受多頭行情影響，測試期沒有用來選模型或持有期。組合只是示意，不是投資建議；絕對報酬多半來自市場 beta。方法依 Gu、Kelly 與 Xiu（2020）及 Grinold 主動管理基本定律。
        <a className="ml-1 text-accent underline-offset-2 hover:underline" href={LINKS.rankReport} target="_blank" rel="noopener noreferrer">
          完整回測報告
        </a>
      </p>
    </div>
  );
}
