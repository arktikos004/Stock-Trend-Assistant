---
version: 1
slug: "frontend-app-page-tsx"
primary_target: "frontend/app/page.tsx"
related_targets: ["frontend/app/stock/page.tsx","frontend/app/scan/page.tsx","frontend/app/screener/page.tsx","frontend/app/monitor/page.tsx"]
---

## Scope

股價站的總覽頁（`/`），以及共用同一套外框與視覺的個股、排序、篩選、監控頁。Visitor mode: Operate。

## Audience and job

金融機構的研究人員與模型風控人員，收盤後確認今天的排序、它已經存證、模型仍然有效；競賽評審在決賽簡報中看示範。
內容來源：`rank/latest.json`、`monitor.json`、`meta.json`、`screener/latest.json`、`market.json`。
限制：靜態站、每日更新；漲紅跌綠；研究工具、不構成投資建議；不得出現個人或學校資訊。

## Direction contract

THESIS: 研究員收盤後第一個打開的頁面，今天的相對強弱排序、它的存證狀態與上一份到期成績並列；拒絕「行情網站加預測徽章」的排列（大 K 線在上、預測徽章在旁）。

OWN-WORLD: 業界標準的產品風格，以財報狗、TradingView 選股器的完成度為標準。系統字體（蘋方、微軟正黑體、Noto Sans TC）；冷灰中性底加一個藍色強調色；細線分隔的表格與面板、8px 圓角、不加陰影；表格緊湊、表頭固定、數字靠右並用等寬數字；漲紅跌綠只表示方向，T1／T2／T3 與狀態都附文字。

STORY: 研究員看到今天的排序、存證鏈節數與驗證結果、最新到期日的成績與監控狀態，相信紀錄沒被改過、模型目前可用；接著點一檔進個股頁，或到監控頁看完整檢定。

FIRST VIEWPORT: 桌機 1440×900。頂列：左邊站名，接著是總覽、排序、篩選、監控分頁，中間是代號搜尋，右邊是選單。頂列下方一條狀態列：基準日、資料更新時間、存證鏈節數與驗證結果、模型監控狀態、篩選候選數。主區分兩欄。左欄約 2/3，標題「今天的相對強弱排序」，下面是前 10 名表格（名次、股票、分數條與數值、百分位、分組、篩選層級），有「前 10 名／自選」分頁，表尾連到排序頁的全部 49 檔。右欄約 1/3，由上而下三個面板：存證（本日寫入列數、最新一節時間、雜湊前 8 碼、驗證方式連結）、到期成績（最新到期日的 Rank IC、近期平均與 Newey–West t、監控狀態）、大盤（加權指數 1 日與 5 日、上漲家數比）。主要動作是點表格列進個股頁。手機 390：頂列、可橫向捲動的狀態列、排序清單、三個面板、底部五鈕分頁列（總覽、排序、篩選、監控、選單）。

FORM: 業界標準（使用者在方向回合選的 standing exit），排在候選清單之外。方向由使用者指定，未執行 concept-seed，所以沒有 seed key。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Memorable moment

一進站就看到「今天的排序已經串進第 N 節存證鏈，驗證通過」，排序與成績並列。

## Unresolved

無。
