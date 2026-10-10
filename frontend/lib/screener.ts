/**
 * 篩選器的組成、條件與分數拆解（規則見 docs/screener_prereg.md）。篩選頁與個股頁共用。
 * 組成的顏色是驗證過的類別色（globals.css 的 --series-1..5，避開台股漲跌的紅綠），順序＝堆疊順序。
 */

import type { ConditionKey, ScreenerComponentKey, ScreenerResponse, ScreenerStock } from "@/lib/api";

export const COMPONENTS: { key: ScreenerComponentKey; label: string; color: string; hint: string }[] = [
  { key: "rank", label: "排序", color: "var(--series-1)", hint: "相對強弱排序模型的百分位" },
  { key: "momentum", label: "動能", color: "var(--series-2)", hint: "20 日、60 日報酬的百分位" },
  { key: "valuation", label: "評價", color: "var(--series-3)", hint: "盈餘殖利率、現金殖利率、淨值市價比" },
  { key: "revenue", label: "營收", color: "var(--series-4)", hint: "月營收與累計營收年增率；金融保險業不計" },
  { key: "chips", label: "籌碼", color: "var(--series-5)", hint: "融資餘額變化、千張大戶持股週變化" },
];

export const CONDITIONS: Record<ConditionKey, string> = {
  C1: "相對強弱前 40%",
  C2: "60 日報酬高於中位數",
  C3: "評價分數 ≥ 50",
  C4: "月營收年增",
  C5: "融資未增加",
  C6: "突破前高或均線多頭",
};

export const CONDITION_KEYS = Object.keys(CONDITIONS) as ConditionKey[];

export const TIER_TITLE = { T1: "適用條件全部符合", T2: "少一項", T3: "少兩項" } as const;

/** 各組成對綜合評分的貢獻：權重在有分數的組成之間重新正規化，加總＝綜合評分。 */
export function contributions(stock: ScreenerStock, weights: ScreenerResponse["weights"]) {
  const present = COMPONENTS.filter((c) => stock.components[c.key] != null);
  const total = present.reduce((sum, c) => sum + weights[c.key], 0);
  return present.map((c) => {
    const score = stock.components[c.key] as number;
    const weight = weights[c.key] / total;
    return { ...c, score, weight, value: weight * score };
  });
}
