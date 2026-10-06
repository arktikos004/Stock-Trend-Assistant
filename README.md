# ledger：預測存證的雜湊鏈

本分支只存放 `chain.jsonl`。每個交易日的排程（`.github/workflows/daily.yml`）記錄完線上預測、保存狀態之後，
把 `predictions.db` 新增的資料列串成雜湊鏈的一節。本分支**只新增、不覆寫**：一般 commit，從不 force push。
每一節的 commit 時間（由 GitHub 記錄）就是那些預測已經存在的公開時間戳。

`predictions.db` 本身在 `state` 分支公開，但 `state` 每天整個覆寫，單看它無法確認舊的資料列沒被改過；
這條鏈補上這一點：某一節出現之後，它涵蓋的資料列只要改了任何一個位元，驗證就會失敗。

## 自己驗證

只需要 Python 3.10 以上，不用安裝本專案：

```bash
curl -LO https://raw.githubusercontent.com/arktikos004/Stock-Trend-Assistant/master/backend/stockta/ledger.py
curl -LO https://raw.githubusercontent.com/arktikos004/Stock-Trend-Assistant/state/predictions.db
curl -LO https://raw.githubusercontent.com/arktikos004/Stock-Trend-Assistant/ledger/chain.jsonl
python ledger.py verify --db predictions.db --chain chain.jsonl
```

驗證會逐節重算：前後節的串接、每一節自身的 hash、id 區間是否首尾相接、區間內的列數與來源計數、資料列內容的 SHA-256。
任何一列被修改、刪除，或被塞進已上鏈區間的空號，都會失敗。最後一節之後才寫入的列列為「尚未上鏈」，下一次排程會串進鏈裡。

## 每一節的欄位

| 欄位 | 意義 |
| --- | --- |
| `seq` | 第幾節，從 0 開始 |
| `recorded_at` | 上鏈時間（UTC，由排程寫入；公開的時間戳以 commit 時間為準） |
| `ranges` | 兩張表各自的 id 區間（`after_id` 之後到 `to_id`，含）與列數；`rank_predictions` 另依 `source` 分開計數：`live` 是當日收盤後即時記錄，`pit` 是事後以固定權重重建的歷史基準日 |
| `rows_sha256` | 區間內資料列正規化後的 SHA-256 |
| `prev_hash` | 前一節的 `hash`；第一節為 64 個 0 |
| `run_id` | 產生這一節的 GitHub Actions 執行編號 |
| `note` | 只有第一節有，說明它能證明的範圍 |
| `hash` | 本節去掉 `hash` 欄位後的 SHA-256 |

## 正規化（寫死；照這裡的規則，任何語言都能重算）

- 表依 `predictions`、`rank_predictions` 的順序，表內依 `id` 遞增。
- 每列寫成一行 JSON 陣列 `[表名, 欄位…]`，欄位順序固定：
  - `predictions`：`id, ticker, base_date, signal, confidence, model_version, created_at`
  - `rank_predictions`：`id, ticker, base_date, score, model_version, source, created_at`
- 浮點數（`confidence`、`score`）寫成 IEEE-754 binary64 大端序的 16 位十六進位字串，例如 0.5 寫成 `3fe0000000000000`；逐位元精確，與語言和版本無關。
- UTF-8、不轉義非 ASCII 字元、分隔符沒有空白（`,` 與 `:`），每行以換行字元結尾；`rows_sha256` 是這些位元組依序串接後的 SHA-256。
- 鏈節的 `hash`：鏈節去掉 `hash` 欄位，以鍵名排序、同樣的分隔符序列化成 JSON，再取 SHA-256。

## 為什麼以 id 區間為單位

排程有自癒補寫機制，同一個基準日的資料列可能分幾次寫入；兩張表的 `id` 都是 AUTOINCREMENT，用過的 id 不會再發，
所以「上一節記到的 id 之後新增的列」才是穩定的單位。重複的寫入被忽略（`INSERT OR IGNORE`）時 SQLite 也會用掉一個 id，
所以資料表本來就有 id 空號；鏈只雜湊實際存在的列。
程式只新增、從不更新或刪除這兩張表（實際走勢是產生報告時另外計算，不寫回），所以整列內容都進雜湊。

## 第一節能證明的範圍

第一節涵蓋上鏈之前（2026-07-09 起）就已存在的資料列。它只能證明這些列自第一節的 commit 時間起沒有被修改，
**不能證明更早**。之後的每一節涵蓋的，都是當天排程剛寫入的資料列。

## 不在本分支的資料

鏈檔只有 id 區間、列數與雜湊值，不含預測內容，也不含任何價格。
