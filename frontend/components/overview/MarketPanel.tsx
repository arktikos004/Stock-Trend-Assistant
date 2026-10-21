import Badge from "@/components/ui/Badge";
import { Notice, Skeleton } from "@/components/ui/Feedback";
import Hint from "@/components/ui/Hint";
import Panel from "@/components/ui/Panel";
import type { MarketResponse } from "@/lib/api";
import { pct, share, toneVar } from "@/lib/format";
import { MARKET_BIAS_TONE, marketBias } from "@/lib/market";
import { errorText } from "@/lib/useAsync";

/**
 * 大盤：加權指數漲跌、上漲家數比、均線乖離與波動。這些也是模型的市場特徵。
 * 標題旁的偏多／中性／偏空只描述最近的狀態（規則在 lib/market.ts）；缺值時不標，規則收在提示裡。
 */
export default function MarketPanel({
  market,
  error,
  className,
}: {
  market: MarketResponse | undefined;
  error?: unknown;
  className?: string;
}) {
  const bias = market ? marketBias(market) : null;
  return (
    <Panel
      className={className}
      title="大盤"
      description={market ? `加權指數，資料日 ${market.as_of}` : undefined}
      actions={
        bias && (
          <span className="flex items-center gap-1">
            <Badge tone={MARKET_BIAS_TONE[bias]}>{bias}</Badge>
            <Hint to="market" anchor="rule" label="大盤標籤">
              <p>5 日報酬、20 日均線乖離、上漲家數比三項同向才標偏多或偏空，其餘是中性。只描述已發生的狀態，不是預測。</p>
            </Hint>
          </span>
        )
      }
    >
      {error ? (
        <Notice tone="error">{errorText(error, "大盤資料還沒有產生。")}</Notice>
      ) : !market ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <dt className="text-xs text-ink-3">1 日</dt>
              <dd className="text-xl font-light" style={{ color: toneVar(market.ret_1d) }}>
                {pct(market.ret_1d, 2)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">5 日</dt>
              <dd className="text-xl font-light" style={{ color: toneVar(market.ret_5d) }}>
                {pct(market.ret_5d, 2)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">20 日均線乖離</dt>
              <dd className="text-sm text-ink">{pct(market.ma20_bias, 2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">20 日波動（日）</dt>
              <dd className="text-sm text-ink">{share(market.vol20, 2)}</dd>
            </div>
          </dl>
          <div className="mt-5">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-ink-3">上漲家數比（台灣 50）</span>
              <span className="text-sm text-ink">{share(market.breadth_up)}</span>
            </div>
            <div className="relative mt-2 h-px bg-border-strong" aria-hidden="true">
              <div className="absolute -top-px left-0 h-[3px] bg-ink" style={{ width: `${market.breadth_up * 100}%` }} />
              <div className="absolute -top-1.5 h-3.5 w-px bg-ink-3" style={{ left: "50%" }} />
            </div>
            <p className="mt-2 text-xs text-ink-3">5 日平均 {share(market.breadth_ma5)}；刻度是 50%</p>
          </div>
        </>
      )}
    </Panel>
  );
}
