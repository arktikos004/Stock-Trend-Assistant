import Badge from "@/components/ui/Badge";
import HelpLink from "@/components/ui/HelpLink";
import type { PredictionResponse, Signal } from "@/lib/api";
import { share } from "@/lib/format";
import RiskBadge from "./RiskBadge";

// 漲、跌用漲跌色（預設漲紅跌綠），觀望灰（另附文字）
const SIGNAL_VAR: Record<Signal, string> = { 漲: "--up", 跌: "--down", 觀望: "--hold" };
const ORDER: Signal[] = ["漲", "觀望", "跌"];

/**
 * 未來 5 個交易日的方向訊號。規則降級的「觀望」會標明，並列出三類機率，不讓低機率看起來像把握。
 * 機率是模型輸出，沒有做機率校準：標籤直接寫「模型機率」，並附漲、跌的定義。
 */
export default function PredictionCard({ prediction, testAuc }: { prediction: PredictionResponse; testAuc: number | null }) {
  const p = prediction.proba;
  const downgraded = p != null && prediction.signal === "觀望" && p["觀望"] < Math.max(p["漲"], p["跌"]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-semibold leading-none" style={{ color: `var(${SIGNAL_VAR[prediction.signal]})` }}>
            {prediction.signal}
          </span>
          {downgraded ? (
            <Badge tone="hold" title="漲或跌的模型機率未達決策門檻，依規則改為觀望">
              規則降級
            </Badge>
          ) : (
            <span className="text-sm text-ink-2">
              模型機率 <span className="font-semibold text-ink">{share(prediction.confidence)}</span>
            </span>
          )}
        </div>
        <RiskBadge risk={prediction.risk} />
      </div>

      {p && (
        <dl className="mt-4 space-y-2" aria-label="三類的模型機率（未經機率校準）">
          {ORDER.map((s) => (
            <div key={s} className="grid grid-cols-[2.5rem_1fr_3rem] items-center gap-2 text-sm">
              <dt className="font-semibold" style={{ color: `var(${SIGNAL_VAR[s]})` }}>
                {s}
              </dt>
              <div className="h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                <div className="h-full rounded-full" style={{ width: `${(p[s] ?? 0) * 100}%`, background: `var(${SIGNAL_VAR[s]})` }} />
              </div>
              <dd className="text-right text-ink-2">{share(p[s])}</dd>
            </div>
          ))}
        </dl>
      )}

      {downgraded && (
        <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-xs leading-relaxed text-ink-2">
          漲或跌的機率最高，但沒有達到決策門檻，依規則改為觀望。
        </p>
      )}

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-ink-3">基準日</dt>
        <dd className="text-right text-ink-2">{prediction.base_date}</dd>
        <dt className="text-ink-3">模型版本</dt>
        <dd className="text-right text-ink-2">{prediction.model_version}</dd>
        {testAuc != null && (
          <>
            <dt className="text-ink-3">測試集 Macro AUC</dt>
            <dd className="text-right text-ink-2">{testAuc.toFixed(4)}</dd>
          </>
        )}
      </dl>

      {prediction.is_mock && (
        <p className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-xs text-ink">模型還沒載入，這是示意資料，不能拿來判斷。</p>
      )}

      <p className="mt-4 border-t border-border pt-3 text-sm leading-relaxed text-ink-2">
        漲跌＝5 日累積報酬超過 ±2%；百分比是未校準的模型機率，不等於實際發生的機率。
        <HelpLink to="direction" className="ml-1" />
      </p>
    </div>
  );
}
