# 簡單因子對照與可成交性：規則預先聲明（v1）

> **狀態**：規則定案於 2026-10-18。本檔先 commit，之後才實作並第一次用真實資料執行。
> **撰寫前看過的資料**：公開的 `monitor.json`（模型本身的逐日 Rank IC，基準日到 2026-10-16）。第 2、3、5 節的統計量在本檔 commit 之前都沒有用真實資料算過；第 4 節的公式在撰寫前用同一份 `monitor.json` 試算過一次（約 137 個到期日），這裡把公式固定下來。
> 之後改任何定義、門檻或樣本，都要升版（v2……），在「版本紀錄」寫明改了什麼、為什麼。
> 本檔不改 `docs/monitor_prereg.md` v1：模型的狀態（正常／留意／失效警示）仍只依 v1 判定。

## 1. 共同設定

| 項目 | 規則 |
| --- | --- |
| 價格 | 內部還原權值收盤價，與線上 Rank IC 同一個快取；只公開衍生的統計量，不公開價格 |
| 交易日 | 每檔股票以它自己的價格序列計位置：Cₜ₋ₖ 是基準日 t 往前第 k 個有收盤價的交易日，Cₜ₊ₖ 是往後第 k 個 |
| 排序分數 | `predictions.db` 的 `rank_predictions`（現行排序模型版本，每日存證並串入雜湊鏈），不另外重算 |
| 每日樣本 | 該基準日有分數、而且該節需要的值都齊全的股票；少於 10 檔，或分數、報酬沒有變異時，該日不計 |
| 統計量 | 逐日 Spearman 相關，跨日取平均；t ＝ 平均 ÷ Newey–West (1987) HAC 標準誤（Bartlett kernel、落後 4 期，與 v1 相同） |
| 股票池 | 2026-10-19 起換成 50 檔；各節依當天實際有分數的股票計算，不另行調整 |

## 2. 和簡單因子比

### 2.1 三個因子（基準日 t 收盤時就可得）

| 因子 | 定義 | 依據 |
| --- | --- | --- |
| 短期反轉 | −(Cₜ ÷ Cₜ₋₅ − 1) | Jegadeesh (1990)、Lehmann (1990)：短期報酬反轉 |
| 20 日動量 | Cₜ ÷ Cₜ₋₂₀ − 1 | Jegadeesh & Titman (1993) |
| 60 日動量 | Cₜ ÷ Cₜ₋₆₀ − 1 | 同上 |

數值越大代表預期越強，短期反轉因此取負號。只取 60 日以內，因為排序模型的輸入視窗就是 60 個交易日；更長的 12-1 月動量是模型看不到的資訊，不列入。

報酬：基準日 t 收盤到 t+5 收盤，與 v1 的線上 Rank IC 相同。

### 2.2 中和後 Rank IC（主要檢定，有判讀）

每一天：

1. 把模型分數與三個因子各自轉成名次分數：在當天的樣本內排名（同分取平均名次），線性映到 [−1, 1]，即 2 ×（名次 − 1）÷（檔數 − 1）− 1。這是 Gu, Kelly & Xiu (2020) 處理特徵的方式。
2. 以截面最小平方法，把模型的名次分數對三個因子的名次分數（含截距）迴歸，取殘差。
3. 殘差與 5 日報酬的 Spearman 相關，就是當天的中和後 Rank IC。殘差的標準差小於 1e-9 時（分數幾乎完全由三個因子決定），該日不計。

樣本：全部已到期的基準日（即時記錄與事後重建一併，與 v1 的狀態判定同一批）。

| 判定 | 規則 |
| --- | --- |
| 排除反轉與動量後仍有資訊 | 計入 ≥ 20 天，且 t ≥ 2 |
| 排除後為負 | 計入 ≥ 20 天，且 t ≤ −2 |
| 無法和反轉、動量區分 | 計入 ≥ 20 天，其餘 |
| 資料不足 | 計入不足 20 天 |

同時列出 Harvey, Liu & Zhu (2016) 的 3.0 供參考；與 v1 的技能檢定一樣，兩個門檻都列，不挑對自己有利的那個。

### 2.3 描述性對照（只列數字，不判讀）

在同一批天數與股票上：

- 各因子自己的 Rank IC（平均與 t）。
- 模型減因子的逐日 IC 差：dₜ ＝ 模型 ICₜ − 因子 ICₜ，取平均與 t。以兩個預測的逐期損失差搭配 HAC 標準誤比較預測力，是 Diebold & Mariano (1995) 的做法，Gu, Kelly & Xiu (2020) 也用它比較模型。
- 模型分數與各因子的逐日 Spearman 相關，取平均：兩者有多像。

三個因子各比一次就是三個比較，所以這一節只描述，不作為任何結論的依據。

## 3. 可成交版 Rank IC

排序在收盤後才寫入（每日排程在收盤後約 15:40 才開始），基準日 t 的收盤價買不到。可成交版把報酬改成 t+1 收盤到 t+6 收盤（Cₜ₊₆ ÷ Cₜ₊₁ − 1），比照 Qlib 的預設標籤從下一個交易日起算的做法。

- 基準日要到 t+6 收盤後才算到期，比 v1 的 Rank IC 晚一天。
- 分兩組列出：全部到期日，以及即時記錄（與 `monitor.json` 的 `groups.live` 同一定義：live 列，且都在預測窗口開始前寫入）。
- 只描述，不判讀；v1 的狀態判定仍用原本的 Rank IC。

## 4. 還要多久才能判斷

假設真實的 Rank IC 等於回測測試期的平均（`backend/artifacts_cs/summary.json` 的 `test_rank_ic`，撰寫時為 +0.0437），而且逐日 IC 的變異與自我相關維持現在的水準，t 值的期望值要到 2 所需的已到期天數為：

N ＝ n ×（2 × SEₙ ÷ IC_回測）²；還要 ＝ max(0, ⌈N⌉ − n)

- n 與 SEₙ：v1 技能檢定用的同一序列（全部到期日）的天數與 Newey–West 標準誤。
- 這是 t 的「期望值」到 2 的天數，那時大約只有五成機會真的到 2；要有八成把握，約需（2.84 ÷ 2）² ≈ 2 倍的天數。真實 IC 若比回測小，需要更久。
- 想法仿 Bailey & López de Prado (2012) 的最短紀錄長度：先說清楚要累積多長的紀錄，才能拒絕「沒有技能」。
- n 不足 20 天、或回測 IC 不是正數時不推算，顯示資料不足。

## 5. 前 20% 與後 20% 的實際報酬

- 樣本：即時記錄的基準日（同第 3 節的定義），且可成交版報酬已到期。
- 分位：依 v1 第 2.1 節的公式 q ＝ ⌊（名次 − 1）× 5 ÷ n⌋ + 1，名次依當天分數由高到低排、同分依代號；q＝1 是前 20%，q＝5 是後 20%。
- 報酬：第 3 節的可成交版 5 日報酬，各組等權平均，不扣交易成本與滑價。
- 列出前 20%、後 20%、全池三組的跨日平均，以及價差（前 20% − 後 20%）的跨日平均與 Newey–West t；少於 2 天時不算 t。
- 相鄰基準日的報酬重疊，跨日平均不是一個能實際每天換股的投資組合報酬，只描述排序兩端實際發生了什麼。

## 6. 公開的內容

`baselines.json`：第 2～5 節的統計量、天數、期間與本檔版本；不含價格序列與逐檔報酬。

## 參考文獻

- Bailey, D. H., & López de Prado, M. (2012). The Sharpe ratio efficient frontier. *Journal of Risk*, 15(2), 3–44.
- Diebold, F. X., & Mariano, R. S. (1995). Comparing predictive accuracy. *Journal of Business & Economic Statistics*, 13(3), 253–263.
- Gu, S., Kelly, B., & Xiu, D. (2020). Empirical asset pricing via machine learning. *Review of Financial Studies*, 33(5), 2223–2273.
- Harvey, C. R., Liu, Y., & Zhu, H. (2016). … and the cross-section of expected returns. *Review of Financial Studies*, 29(1), 5–68.
- Jegadeesh, N. (1990). Evidence of predictable behavior of security returns. *Journal of Finance*, 45(3), 881–898.
- Jegadeesh, N., & Titman, S. (1993). Returns to buying winners and selling losers: Implications for stock market efficiency. *Journal of Finance*, 48(1), 65–91.
- Lehmann, B. N. (1990). Fads, martingales, and market efficiency. *Quarterly Journal of Economics*, 105(1), 1–28.
- Newey, W. K., & West, K. D. (1987). A simple, positive semi-definite, heteroskedasticity and autocorrelation consistent covariance matrix. *Econometrica*, 55(3), 703–708.

## 版本紀錄

- v1（2026-10-18）：初版。
