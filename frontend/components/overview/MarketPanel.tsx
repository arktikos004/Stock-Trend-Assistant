import { Skeleton } from "@/components/ui/Feedback";
import Panel from "@/components/ui/Panel";
import type { MarketResponse } from "@/lib/api";
import { pct, share, toneVar } from "@/lib/format";

/** 大盤：加權指數漲跌、上漲家數比、均線乖離與波動。這些也是模型的市場特徵。 */
export default function MarketPanel({ market }: { market: MarketResponse | undefined }) {
  return (
    <Panel title="大盤" description={market ? `加權指數，資料日 ${market.as_of}` : undefined}>
      {!market ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <dt className="text-xs text-ink-3">1 日</dt>
              <dd className="text-lg font-semibold" style={{ color: toneVar(market.ret_1d) }}>
                {pct(market.ret_1d, 2)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">5 日</dt>
              <dd className="text-lg font-semibold" style={{ color: toneVar(market.ret_5d) }}>
                {pct(market.ret_5d, 2)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">20 日均線乖離</dt>
              <dd className="text-sm font-semibold text-ink">{pct(market.ma20_bias, 2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">20 日波動（日）</dt>
              <dd className="text-sm font-semibold text-ink">{share(market.vol20, 2)}</dd>
            </div>
          </dl>
          <div className="mt-4">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-ink-3">上漲家數比</span>
              <span className="text-sm font-semibold text-ink">{share(market.breadth_up)}</span>
            </div>
            <div className="relative mt-1.5 h-1.5 rounded-full bg-surface-3" aria-hidden="true">
              <div className="absolute inset-y-0 left-0 rounded-full bg-ink-3" style={{ width: `${market.breadth_up * 100}%` }} />
              <div className="absolute -top-1 h-3.5 w-px bg-ink" style={{ left: "50%" }} />
            </div>
            <p className="mt-1.5 text-xs text-ink-3">
              5 日平均 {share(market.breadth_ma5)}；中線為 50%。樣本是台灣 50 成分股。
            </p>
          </div>
        </>
      )}
    </Panel>
  );
}
