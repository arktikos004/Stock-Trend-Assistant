import type { IndicatorsResponse } from "@/lib/api";
import { fixed, pct } from "@/lib/format";

/** 單一指標列：名稱、數值與簡短解讀。偏多用紅、偏空用綠（台股慣例），解讀一定有文字。 */
function Row({ name, value, hint, tone = "neutral" }: { name: string; value: string; hint?: string; tone?: "hot" | "cold" | "neutral" }) {
  const color = tone === "hot" ? "var(--up)" : tone === "cold" ? "var(--down)" : "var(--ink)";
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-sm text-ink-2">{name}</dt>
      <dd className="text-right">
        <span className="text-sm font-semibold" style={{ color }}>
          {value}
        </span>
        {hint && <span className="ml-1.5 text-xs text-ink-3">{hint}</span>}
      </dd>
    </div>
  );
}

export default function IndicatorPanel({ indicators }: { indicators: IndicatorsResponse }) {
  const rsi = indicators.rsi14;
  const k = indicators.kd_k;
  return (
    <div>
      <dl className="divide-y divide-border">
        <Row
          name="RSI（14）"
          value={(rsi * 100).toFixed(0)}
          hint={rsi > 0.7 ? "過熱" : rsi < 0.3 ? "超賣" : "中性"}
          tone={rsi > 0.7 ? "hot" : rsi < 0.3 ? "cold" : "neutral"}
        />
        <Row
          name="KD（K／D）"
          value={`${(k * 100).toFixed(0)}／${(indicators.kd_d * 100).toFixed(0)}`}
          hint={k > 0.8 ? "高檔" : k < 0.2 ? "低檔" : undefined}
          tone={k > 0.8 ? "hot" : k < 0.2 ? "cold" : "neutral"}
        />
        <Row
          name="MACD 柱"
          value={fixed(indicators.macd_hist, 4, true)}
          hint={indicators.macd_hist > 0 ? "多方" : "空方"}
          tone={indicators.macd_hist > 0 ? "hot" : "cold"}
        />
        <Row
          name="布林 %B"
          value={indicators.bb_pctb.toFixed(2)}
          hint={indicators.bb_pctb > 1 ? "突破上軌" : indicators.bb_pctb < 0 ? "跌破下軌" : undefined}
        />
        <Row name="量能比（20 日）" value={`${(indicators.vol_ratio * 100).toFixed(1)}%`} hint="相對 20 日均量" />
        <Row name="乖離 5 日" value={pct(indicators.ma_bias_5)} tone={indicators.ma_bias_5 > 0 ? "hot" : "cold"} />
        <Row name="乖離 20 日" value={pct(indicators.ma_bias_20)} tone={indicators.ma_bias_20 > 0 ? "hot" : "cold"} />
        <Row name="乖離 60 日" value={pct(indicators.ma_bias_60)} tone={indicators.ma_bias_60 > 0 ? "hot" : "cold"} />
      </dl>
      <p className="mt-2 text-xs text-ink-3">與模型輸入走同一條特徵管線，數值一致。資料日 {indicators.as_of}。</p>
    </div>
  );
}
