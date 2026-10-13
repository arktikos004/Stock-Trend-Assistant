# 台股相對強弱排序與預測存證平台

[![tests](https://github.com/arktikos004/Stock-Trend-Assistant/actions/workflows/leakage.yml/badge.svg)](https://github.com/arktikos004/Stock-Trend-Assistant/actions/workflows/leakage.yml)
[![lint](https://github.com/arktikos004/Stock-Trend-Assistant/actions/workflows/lint.yml/badge.svg)](https://github.com/arktikos004/Stock-Trend-Assistant/actions/workflows/lint.yml)
[![daily](https://github.com/arktikos004/Stock-Trend-Assistant/actions/workflows/daily.yml/badge.svg)](https://github.com/arktikos004/Stock-Trend-Assistant/actions/workflows/daily.yml)

每天收盤後預測台灣 50 成分股未來 5 個交易日的相對強弱，並把每一筆預測串進公開的雜湊鏈，任何人都能驗證紀錄沒被改過。

**公開站：<https://stock.sekinv.com>**（每個交易日收盤後自動更新）

> 個人研究原型（repo 名稱沿用 Stock-Trend-Assistant）。排序、訊號與評分都是研究用途，**不構成投資建議**。

## 目錄

- [功能](#功能)
- [專案狀態與主要結果](#專案狀態與主要結果)
- [快速開始](#快速開始)
- [自己驗證預測紀錄](#自己驗證預測紀錄)
- [重現研究結果](#重現研究結果)
- [專案結構](#專案結構)
- [文件](#文件)
- [問題回報與維護者](#問題回報與維護者)
- [授權](#授權)

## 功能

- **相對強弱排序（主模型）**：XGBoost 預測每一檔在未來 5 個交易日贏過當日全池中位數的機率，排出全池名次。
  這個問法在原理上不受大盤漲跌影響；為什麼從絕對方向改成排序，見[實驗記錄 #8](docs/experiment_log.md)。
- **預測存證**：`predictions.db` 每天公開在 `state` 分支，新增的資料列串進只新增、不覆寫的 `ledger` 分支雜湊鏈。
- **5 日方向訊號**：GRU 三分類（漲／觀望／跌），信心不足時降級為觀望，和排序一起每天上線驗證。
- **篩選器**：排序、動能、評價、營收、籌碼五個組成，依[事先公開的規則](docs/screener_prereg.md)算出 0–100 綜合評分與 T1／T2／T3 分層。
- **模型監控**：線上 Rank IC 的 Newey–West t、與回測比較的失效檢定、排名分位遷移、52 週新高新低（[規則](docs/monitor_prereg.md)）。
- **K 線**：只用臺灣證券交易所開放資料（未還原權值）；訓練用的 yfinance 價格不對外提供。

網站分為總覽、個股、排序、篩選器、監控五頁。

## 專案狀態與主要結果

每日排程持續運作中（台北時間 15:20 執行，16:50、19:30 補跑），細節見 [docs/deploy.md](docs/deploy.md)。
選型與門檻校準只用驗證期，測試期只做最終驗證；每次動到測試期都記在[測試集曝光帳本](docs/test_set_ledger.md)，
被否定的路線也寫成[實驗記錄](docs/experiment_log.md)。

| 項目 | 結果 |
| --- | --- |
| 相對強弱排序：回測（[報告](docs/cross_sectional_report.md)） | 測試期 Rank IC +0.0437（128 個交易日），Newey–West t = 1.55：方向為正，**未達統計顯著** |
| 相對強弱排序：線上 | 每天更新：[線上 Rank IC 報告](https://github.com/arktikos004/Stock-Trend-Assistant/blob/state/reports/online_rank_ic.md)、網站的「監控」頁 |
| 5 日方向訊號 | [回測](docs/backtest_report.md)與[線上實證](https://github.com/arktikos004/Stock-Trend-Assistant/blob/state/reports/online_predictions.md)；線上命中率要和「全猜觀望」的基線比 |
| 洩漏防治 | [打亂標籤測試](docs/leakage_report.md)、竄改未來資料的無前視測試、[特徵可用時點](docs/feature_availability.md) |
| 已知限制 | 股票池是人工維護的台灣 50 名單，與官方名單有出入（[倖存者偏誤研究](docs/survivorship_study.md)）；yfinance 會回頭改寫歷史價格（[實測](docs/data_revision_study.md)） |

## 快速開始

需求：Python 3.12（3.11 以上即可）、Node.js 20.9 以上（CI 用 24）。只有訓練深度模型需要 NVIDIA GPU。

### 後端

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate                     # macOS／Linux：source .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu   # 有 NVIDIA GPU 改用 .../whl/cu128
pip install -e ".[dev]"
pytest                                     # 全部測試；pytest -m leakage 只跑洩漏防治
uvicorn stockta.api.main:app --reload      # http://localhost:8000，互動式 API 文件在 /docs
```

- 沒有模型檔時 API 以 mock 模式啟動（回應的 `is_mock` 為 true）。要用正式模型就執行 `bash scripts/fetch_models.sh`：
  依 `backend/models.lock` 從 GitHub Release 下載並驗證 sha256（需要已登入的 gh CLI）。
- 價格資料用 `python -m stockta.data.fetch` 抓進 `backend/data_cache/`（yfinance，只供本機研究）。
- 推送前的洩漏測試閘門：`powershell -File scripts/install_hooks.ps1`。

### 前端

```powershell
cd frontend
npm install
npm run dev                                # http://localhost:3000，讀 http://localhost:8000 的 API
npm test                                   # lib/ 的單元測試；靜態檢查用 npm run lint
```

### 主要 API

| 端點 | 說明 |
| --- | --- |
| `GET /api/rank`（可加 `?date=`） | 相對強弱排序：資料庫有紀錄的基準日回傳紀錄（就是串入存證鏈的那幾列），沒有紀錄才以 point-in-time 重算 |
| `GET /api/rank/summary` | 回測摘要：Rank IC、Newey–West t、扣成本的組合報酬 |
| `GET /api/screener` | 篩選器的組成分數、條件與分層 |
| `GET /api/monitor` | 模型健康（即時記錄、事後重建或補寫、到期前已存證三組；窗口依實際交易日計算）、例外報表、存證鏈驗證結果 |
| `GET /api/ledger` | 存證鏈的狀態快照：驗證截至哪一天、尚未上鏈的列、最新一節（每日排程在上鏈之後匯出） |
| `GET /api/scan`（可加 `?date=`） | 全池 5 日方向訊號 |
| `GET /api/stocks/{ticker}/…` | `candles`（證交所 K 線）、`prediction`、`indicators`、`predictions`（線上紀錄）、`history`（歷史回放） |
| `GET /api/market`、`/api/track-record`、`/api/model`、`/api/stocks`、`/health` | 大盤情境、方向訊號的線上戰績、模型資訊、股票池 |

錯誤一律回 `{"error": {"code": ..., "message": ...}}`，代碼見 [api/errors.py](backend/stockta/api/errors.py)。

## 自己驗證預測紀錄

只需要 Python 3.10 以上，不用安裝本專案：

```bash
curl -LO https://raw.githubusercontent.com/arktikos004/Stock-Trend-Assistant/master/backend/stockta/ledger.py
curl -LO https://raw.githubusercontent.com/arktikos004/Stock-Trend-Assistant/state/predictions.db
curl -LO https://raw.githubusercontent.com/arktikos004/Stock-Trend-Assistant/ledger/chain.jsonl
python ledger.py verify --db predictions.db --chain chain.jsonl
```

已上鏈的任何一列被修改、刪除，或有資料列被塞進已上鏈的區間，驗證都會失敗。
鏈的格式與能證明的範圍見 [`ledger` 分支的說明](https://github.com/arktikos004/Stock-Trend-Assistant/tree/ledger)。

## 重現研究結果

報告都由程式產生，在 `backend/` 執行：

| 指令 | 產出 |
| --- | --- |
| `python -m stockta.ml.train --model gru` | 訓練三分類模型（`rf`、`xgb`、`lstm`、`gru`、`tcn`） |
| `python -m stockta.ml.compare` | [docs/model_comparison.md](docs/model_comparison.md) |
| `python -m stockta.ml.cross_sectional train --model xgb`，再執行 `report` | 相對強弱模型與 [docs/cross_sectional_report.md](docs/cross_sectional_report.md) |
| `python -m stockta.ml.backtest` | [docs/backtest_report.md](docs/backtest_report.md) |
| `python -m stockta.ml.walkforward` | [docs/experiment_walkforward.md](docs/experiment_walkforward.md) |
| `python -m stockta.ml.leakage_check` | [docs/leakage_report.md](docs/leakage_report.md) |
| `python -m stockta.ml.report_predictions`、`python -m stockta.ml.report_rank_predictions` | 線上實證報告（讀 `predictions.db`） |

訓練用的 yfinance 價格依 Yahoo 條款不能再散布，要先用 `python -m stockta.data.fetch` 在本機抓。
還原權值的價格會被資料源回頭改寫，所以重抓後的數字可能和報告略有差異；
報告當時的資料快照雜湊記在 `backend/data_cache/MANIFEST.json` 與各模型 artifact 的 metadata。

## 專案結構

```text
backend/stockta/
  api/               FastAPI 路由、回應契約（schemas.py）、錯誤格式
  data/              價格資料源與快取、證交所開放資料收集（twse.py）、成分股事件表
  features/          技術指標與市場情境特徵（訓練與推論共用 build_features）
  inference/         線上推論、決策規則（decision.py）、歷史回放、預測落地
  ml/                訓練、相對強弱模型、回測、門檻校準、洩漏檢查、報告
  screener.py        篩選器
  monitor.py         模型監控
  ledger.py          預測存證雜湊鏈（只用標準函式庫，可單獨下載執行）
  export_static.py   每日把 API 回應匯出成靜態站的 JSON
backend/tests/       pytest，不連網
frontend/            Next.js：app/ 五個頁面，lib/api.ts 讀即時 API 或靜態 JSON
scripts/             state 分支的加密封包、模型下載、git hooks
docs/                研究報告、實驗記錄、預先聲明、部署說明
```

另外三個分支：`state`（每日狀態，每次覆寫）、`ledger`（雜湊鏈，只新增）、`twse-data`（證交所開放資料，只新增）。

## 文件

- **方法與紀律**：[實驗記錄](docs/experiment_log.md)、[測試集曝光帳本](docs/test_set_ledger.md)、[洩漏報告](docs/leakage_report.md)、
  [倖存者偏誤](docs/survivorship_study.md)、[資料源修訂](docs/data_revision_study.md)、[特徵可用時點](docs/feature_availability.md)
- **模型與回測**：[模型比較](docs/model_comparison.md)、[回測](docs/backtest_report.md)、[相對強弱](docs/cross_sectional_report.md)、[walk-forward](docs/experiment_walkforward.md)
- **預先聲明的規則**：[篩選器](docs/screener_prereg.md)、[模型監控](docs/monitor_prereg.md)。
  修訂都記在各文件的「版本紀錄」：篩選器 v1.1（2026-10-12）改成每家公司各用自己最新已公布的月營收。
- **系統**：[架構](docs/architecture.md)、[特徵設計](docs/feature_engineering.md)、[資料探索](docs/data_exploration.md)、[部署與排程](docs/deploy.md)

## 問題回報與維護者

- 問題與建議：請開 [GitHub issue](https://github.com/arktikos004/Stock-Trend-Assistant/issues)。
- 維護者：[@arktikos004](https://github.com/arktikos004)。

## 授權

- 本 repo 的程式碼與文件未採用開源授權，保留所有權利。
- 模型權重（Release `models-v1`）以 Yahoo Finance 的價格資料訓練，僅供研究與重現本專案結果。
- 網站 K 線使用臺灣證券交易所的開放資料，依政府資料開放授權條款顯名；訓練用的歷史價格不對外提供。
- 第三方套件、資料與模型的授權見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 與 [DATA_SOURCES.md](DATA_SOURCES.md)。
