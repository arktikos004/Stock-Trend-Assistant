# 模型監控與例外報表：規則預先聲明（v1）

> **狀態**：規則定案於 2026-10-06。本檔先 commit，之後才實作並第一次用真實資料執行。
> 之後改任何門檻、視窗或資料範圍，都要升版（v2……），在「版本紀錄」寫明改了什麼、為什麼；不為了讓警示亮或不亮而改。
> 門檻的依據取自財務計量的期刊文獻（見文末參考文獻），不是看過資料後挑的。

## 1. 模型失效警示（forecast breakdown）

**定義**採 Giacomini & Rossi (2009)：模型的樣本外表現顯著差於其樣本內表現，稱為 forecast breakdown。
本專案的「樣本內」是相對強弱排序模型的回測測試期，「樣本外」是每日存證的線上紀錄。

| 項目 | 規則 |
| --- | --- |
| 績效指標 | 逐日線上 Rank IC：基準日的排序分數與其後 5 個交易日報酬的 Spearman 相關，每日至少 10 檔（與 `docs/online_rank_ic.md` 同一定義、同一段程式） |
| 比較基準 | 回測測試期的平均 Rank IC（`backend/artifacts_cs/summary.json` 的 `test_rank_ic`，目前 +0.0437） |
| 統計量 | dₜ ＝ 線上 ICₜ − 回測 IC；t ＝ d 的平均 ÷ Newey–West (1987) HAC 標準誤 |
| 標準誤 | Bartlett kernel，落後期數 4（預測期 5 日 − 1：相鄰基準日的 5 日報酬重疊，逐日 IC 因此自我相關） |
| 樣本 | 所有已到期的線上基準日（live 與 pit 一併，與線上報告相同），從線上紀錄開始的擴張視窗 |
| 判定 | 已到期 ≥ 20 個交易日才判定；t < −1.645（單尾 5%）→ **失效警示**；不足 20 日 → **資料不足**；其餘 → **正常** |
| 描述性提示（不是檢定） | 最近 20 個已到期交易日的平均 Rank IC < 0 → **留意**。單日 IC 的標準差約 0.2，20 日平均的標準誤約 ±0.05，這一項只當提示 |

同一頁另列**技能檢定**：線上 Rank IC 的平均是否顯著大於 0（同一個 Newey–West 標準誤）。
慣例以 t ≥ 2 為顯著；Harvey, Liu & Zhu (2016) 主張新因子要 t ≥ 3.0。本專案的排序模型不是新因子宣稱，報告時兩個門檻都列出，不挑對自己有利的那個。

- 警示只顯示、不自動停用或替換模型；是否重訓由人工依模型卡判斷。
- **已知限制**：擴張視窗的檢定每天重算，反覆檢視會提高誤報率。Giacomini & Rossi (2010) 的 Fluctuation test 以調整過的臨界值處理滾動視窗的反覆檢定；v1 先用較簡單的擴張視窗檢定並揭露這個限制。
- **對既有數字的提醒**：線上報告與回測報告的 t 值目前是逐日 IC 的樸素 t（未處理重疊），會高估顯著性。本監控一律用 Newey–West t，兩者並列時以此為準。

## 2. 例外報表

### 2.1 排名分位遷移

橫斷面排序的標準檢驗單位是分位數投資組合（例如 Jegadeesh & Titman (1993) 的十分位；本專案回測做多前 20%，即五分位的第 1 分位），
排名的不穩定則以投資組合成員的變動（換手）衡量（Novy-Marx & Velikov, 2016）。因此「排名大幅變動」定義成分位遷移，而不是名次差幾名：

- 把基準日 D 的股票池依排序分數分成五個分位：q ＝ ⌊(名次 − 1) × 5 ÷ n⌋ + 1（名次 1＝最強；49 檔時第 1 分位是前 10 名）。
- 比較 D 與往前第 5 個基準日（模型的預測期 5 日）。
- 列入例外：(a) 進入或離開第 1 分位；(b) 分位變動 ≥ 2（例如第 1 → 第 3）。一檔同時符合兩項時列一次、兩個標籤都標。
- 資料：`predictions.db` 的 `rank_predictions`（每日存證、上雜湊鏈的分數），不另外重算。

### 2.2 52 週新高與新低

採 George & Hwang (2004) 的 52 週高點：

- D 的收盤價高於 D 之前 250 個交易日（不含 D）的最高收盤價 → **52 週新高**；低於最低收盤價 → **52 週新低**。
- 以內部還原權值價格計算，只公開旗標與「收盤價 ÷ 52 週最高價」（衍生值），不公開價格。
- 與篩選器 C6（60 日突破前高）不同：篩選器的是短期趨勢條件，這裡是文獻上的長期極值事件。

### 2.3 模型失效警示

即第 1 節的狀態，放在例外報表最上方。

## 3. 存證鏈狀態

每日匯出時以 `stockta/ledger.py` 的 `verify` 檢查 `predictions.db` 與 `ledger` 分支的 `chain.jsonl`：
顯示鏈節數、已上鏈的列數、尚未上鏈的列數與驗證是否通過（不通過時列出問題）。

## 4. 公開的內容

`monitor.json`：逐日線上 Rank IC、Newey–West t、門檻與狀態；分位遷移、52 週新高新低的清單；存證鏈狀態。不含原始價格序列。

## 參考文獻

- George, T. J., & Hwang, C.-Y. (2004). The 52-week high and momentum investing. *Journal of Finance*, 59(5), 2145–2176.
- Giacomini, R., & Rossi, B. (2009). Detecting and predicting forecast breakdowns. *Review of Economic Studies*, 76(2), 669–705.
- Giacomini, R., & Rossi, B. (2010). Forecast comparisons in unstable environments. *Journal of Applied Econometrics*, 25(4), 595–620.
- Harvey, C. R., Liu, Y., & Zhu, H. (2016). … and the cross-section of expected returns. *Review of Financial Studies*, 29(1), 5–68.
- Jegadeesh, N., & Titman, S. (1993). Returns to buying winners and selling losers: Implications for stock market efficiency. *Journal of Finance*, 48(1), 65–91.
- Newey, W. K., & West, K. D. (1987). A simple, positive semi-definite, heteroskedasticity and autocorrelation consistent covariance matrix. *Econometrica*, 55(3), 703–708.
- Novy-Marx, R., & Velikov, M. (2016). A taxonomy of anomalies and their trading costs. *Review of Financial Studies*, 29(1), 104–147.

## 版本紀錄

- v1（2026-10-06）：初版。
