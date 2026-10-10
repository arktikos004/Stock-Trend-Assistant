# 生成式 AI 使用揭露

本專案開發過程使用了生成式 AI 工具。以下列出工具、用途，以及哪些部分由開發者本人負責。

## 使用的工具

| 工具 | 提供者 | 用在哪個階段 | 用途 |
| --- | --- | --- | --- |
| Claude Code（Claude 系列模型） | Anthropic（美國） | 開發 | 撰寫與重構程式碼、測試與技術文件；依開發者指定的方向實作實驗腳本；程式碼審查；網站介面設計與文案潤飾（依公開的 skill 指引：frontend-design、impeccable、humanizer、Humanizer-zh；設計方向與取捨由開發者決定） |

- 用 AI 協助完成的 commit 都以 `Co-Authored-By: Claude …` 標註，可在 git 歷史逐筆查到。
- 協作流程記錄在 [docs/agents/](docs/agents/)：由一個主工作階段規劃工作項目，再交給多個各自獨立的工作階段平行實作、審查與整合。
- **系統本身的預測不使用生成式 AI。** 五個模型（RF、XGBoost、LSTM、GRU、TCN）都是以價格資料從頭訓練的判別式模型，沒有用到大型語言模型或第三方預訓練權重。
- 本專案沒有使用中國大陸廠牌的生成式 AI。

## 開發者本人負責的部分

- 研究問題與目標的設定：預測什麼、用什麼標籤、以什麼指標驗收。
- 每一項實驗要不要採用的裁決。九個實驗的動機、結果與裁決都寫在 [docs/experiment_log.md](docs/experiment_log.md)，其中包含被否定的路線。
- 驗證紀律的訂定與執行：選型與門檻校準只用驗證期、測試期的每一次使用都記帳（[docs/test_set_ledger.md](docs/test_set_ledger.md)）、洩漏檢查掛在推送前的關卡。
- 資料來源、授權與對外公開範圍的決定（[DATA_SOURCES.md](DATA_SOURCES.md)）。
- 所有程式與文件變更的審閱，以及是否合併與部署的決定。

AI 產生的程式碼都經過自動化測試（含資料洩漏回歸測試）與每日線上實證的檢驗；
線上實證的數字不論好壞都公開在 [docs/online_predictions.md](docs/online_predictions.md) 與 [docs/online_rank_ic.md](docs/online_rank_ic.md)。
