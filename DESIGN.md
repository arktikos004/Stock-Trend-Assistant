---
name: 台股相對強弱排序與預測存證平台
description: 收盤後的研究工具：今天的相對強弱排序、它的存證狀態與到期成績並列。
colors:
  background: "#0a0f1a"
  surface: "#0f1623"
  surface-2: "#151e2e"
  surface-3: "#1c2739"
  border: "#1e2a3c"
  border-strong: "#2d3c54"
  ink: "#e7eef8"
  ink-2: "#a3b3c9"
  ink-3: "#8494ab"
  accent: "#3d8bff"
  accent-hover: "#6aa6ff"
  accent-fg: "#050b16"
  accent-soft: "#0e2142"
  accent-glow: "rgba(61, 139, 255, 0.45)"
  up: "#f85a6e"
  up-soft: "#2e121b"
  down: "#0ecb81"
  down-soft: "#0b2a20"
  hold: "#8f9db3"
  hold-soft: "#1c2739"
  warn: "#f0b90b"
  warn-soft: "#2b2208"
  series-1: "#3987e5"
  series-2: "#d95926"
  series-3: "#9085e9"
  series-4: "#c98500"
  series-5: "#d55181"
  chart-up: "#f6465d"
  chart-down: "#0ecb81"
  chart-grid: "rgba(122, 156, 214, 0.08)"
  selection: "rgba(61, 139, 255, 0.3)"
  scrim: "rgba(2, 6, 14, 0.62)"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", \"PingFang TC\", \"Microsoft JhengHei\", \"Noto Sans TC\", sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  figure:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", \"PingFang TC\", \"Microsoft JhengHei\", \"Noto Sans TC\", sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.556
    fontFeature: "\"tnum\""
  title:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", \"PingFang TC\", \"Microsoft JhengHei\", \"Noto Sans TC\", sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.375
  body:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", \"PingFang TC\", \"Microsoft JhengHei\", \"Noto Sans TC\", sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
    fontFeature: "\"tnum\""
  table:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", \"PingFang TC\", \"Microsoft JhengHei\", \"Noto Sans TC\", sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "\"tnum\""
  label:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", \"PingFang TC\", \"Microsoft JhengHei\", \"Noto Sans TC\", sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.333
    fontFeature: "\"tnum\""
  mono:
    fontFamily: "ui-monospace, \"SF Mono\", \"Cascadia Mono\", Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.625
rounded:
  mark: "2px"
  sm: "4px"
  control: "5px"
  md: "6px"
  lg: "8px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "10": "40px"
components:
  app-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    height: "56px"
  status-strip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-3}"
    typography: "{typography.label}"
    padding: "8px 16px"
  tab-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    height: "64px"
  tab-bar-active:
    textColor: "{colors.accent}"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "16px"
  panel-header:
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    padding: "12px 16px"
  table-header:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-3}"
    typography: "{typography.label}"
    padding: "8px 12px"
  table-cell:
    textColor: "{colors.ink}"
    typography: "{typography.table}"
    padding: "8px 12px"
  table-row-hover:
    backgroundColor: "{colors.surface-2}"
  badge-neutral:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "2px 6px"
  badge-accent:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.md}"
    padding: "2px 6px"
  badge-up:
    backgroundColor: "{colors.up-soft}"
    textColor: "{colors.up}"
    rounded: "{rounded.md}"
    padding: "2px 6px"
  badge-down:
    backgroundColor: "{colors.down-soft}"
    textColor: "{colors.down}"
    rounded: "{rounded.md}"
    padding: "2px 6px"
  badge-hold:
    backgroundColor: "{colors.hold-soft}"
    textColor: "{colors.hold}"
    rounded: "{rounded.md}"
    padding: "2px 6px"
  badge-warn:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn}"
    rounded: "{rounded.md}"
    padding: "2px 6px"
  badge-solid:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "2px 6px"
  segmented:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "2px"
  segmented-option-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "36px"
    padding: "0 12px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 12px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-fg}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  input-search:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 12px 0 32px"
  input-search-focus:
    backgroundColor: "{colors.surface}"
  rank-bar:
    backgroundColor: "{colors.surface-3}"
    rounded: "{rounded.full}"
    height: "6px"
    width: "96px"
  code-block:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
    padding: "4px 4px 4px 10px"
---

# Design System: 台股相對強弱排序與預測存證平台

## Overview

**Creative North Star: "收盤後的研究台帳"**

這是一套業界標準的產品介面，以財報狗、TradingView 選股器的完成度為標準，不加任何世界觀元素；預設穿上「深色交易終端」的配色。深藍黑中性底、一個電光藍強調色、交易所式鮮明紅綠、細線分隔的表格與面板；資訊密度高但不擁擠，表格緊湊、表頭固定、數字靠右並用等寬數字。版面的重心是「排序表＋旁邊的證據面板」：左欄約 2/3 放清單，右欄約 1/3 由上而下疊面板，手機時依同一個 DOM 順序變成單欄。

顏色只負責方向與狀態，從不單獨承載語意。台股慣例的漲紅跌綠只用在漲跌方向，等級、狀態、命中與否一律另附文字或中性圖形；「正常」不用綠（綠是跌），失效警示用實心墨色底而不是紅（紅是漲）。預設深色主題（使用者要求更有科技感後選定）；選單可切淺色（投影環境較亮時用），或跟隨系統（作業系統為淺色時用淺色，否則深色）。三種模式共用同一組 token 名稱，由 `html[data-theme]` 決定，開機腳本在首次繪製前套用，沒選過就是深色。

深度靠細線與底色層次，不靠陰影；陰影只出現在浮在內容上方的層（抽屜、搜尋清單、圖表提示框）。「科技感」只靠配色與一道克制的電光藍光暈，而光暈只出現在兩個地方：目前所在的分頁與鍵盤焦點框；面板、表格、按鈕、數值一律不發光。動態只有 150ms 的顏色轉換與載入骨架的脈動，且骨架只在 `motion-safe` 時脈動。

**Key Characteristics:**
- 深藍黑中性底（background → surface → surface-2 → surface-3）加一個電光藍強調色
- 1px 細線框、8px 圓角的面板，不加陰影也不加光暈
- 電光藍光暈只給選中分頁與焦點框
- 系統字體與等寬數字（`tabular-nums`）；等寬字體只給雜湊與指令
- 漲紅跌綠只表示方向，且一律搭配文字
- 固定在 56px 頂列下方的表頭；頂列下一條全站狀態列；手機底部五鈕分頁列

## Colors

深藍黑的中性階層撐起整個介面，電光藍是唯一的互動與「正常」色，交易所式的鮮明紅綠被保留給漲跌方向。每個文字色在四層深色底（background、surface、surface-2、surface-3）上都至少 4.5:1。

### Primary
- **電光藍**（`accent`）：連結、目前頁籤底線、手機分頁列的選中項、焦點框（2px outline、offset 2px）、輸入游標、RankBar 高於 0.5 的那一半、「驗證通過」與模型「正常」的徽章與圖示、站標最上面那一節鏈節。淺色主題改用 #1d4ed8。
- **電光藍・亮**（`accent-hover`）：強調色的 hover 狀態（深色往亮走；淺色主題為 #1e40af，往深走）。
- **電光藍上的字**（`accent-fg`）：電光藍實心底上的字，用近黑色，因為白字在電光藍上只有 3.3:1。淺色主題為 #ffffff。
- **電光藍・淡底**（`accent-soft`）：accent 徽章的底色。淺色主題為 #e8eefc。
- **電光藍光暈**（`accent-glow`）：只給選中分頁與焦點框的光暈色（見 Elevation & Depth）。淺色主題為 `transparent`，所以淺色沒有光暈。

### Secondary
- **交易所紅・漲**（`up` / `up-soft`）：上漲方向、排序分組「強」、方向訊號「漲」。比 K 線紅稍亮，最淺的 surface-3 上仍達 4.5:1。淺色主題為 #c0262d / #fdecec。
- **交易所綠・跌**（`down` / `down-soft`）：下跌方向、分組「弱」、方向訊號「跌」。淺色主題為 #13703a / #e6f4ea。
- **觀望灰**（`hold` / `hold-soft`）：觀望與中性分組「中」。
- **琥珀警示**（`warn` / `warn-soft`）：資料可能過期、模型「留意」、示意資料提醒、自選星號。
- **K 線紅綠**（`chart-up` / `chart-down`）：只給 lightweight-charts 的 K 棒與成交量（成交量用同色、深色 0.35、淺色 0.3 透明度）。深色用交易所原色，紅比文字用的 `up` 稍暗，因為它們是圖形而不是文字；淺色主題為 #d93a3a / #14915a，比文字用的紅綠亮。
- **圖表格線**（`chart-grid`）：帶藍調的極淡格線；淺色主題為 rgba(17, 24, 39, 0.06)。

### Tertiary
- **類別色 series-1..5**（藍、橘、紫、黃、粉）：只給篩選器綜合評分的五個組成（排序、動能、評價、營收、籌碼），順序固定等於堆疊順序。兩種主題都以 dataviz 的 `validate_palette` 驗過色覺辨識（深色在 surface 上重驗）；五色刻意避開紅、綠與青綠，不會被讀成漲跌。黃、粉在淺色底低於 3:1，所以組成分數一律另以文字列出。

### Neutral
- **深藍黑頁底**（`background`）：頁面底色，也是 `themeColor`。
- **面板藍黑**（`surface`）：頂列、面板、抽屜、底部分頁列、浮層。
- **抬升層**（`surface-2`）：狀態列、表頭、表格 hover、分段切換的軌道、搜尋框靜止狀態、指令區塊。
- **骨架層**（`surface-3`）：骨架、RankBar 與機率條的軌道、ScoreBar 剩餘段；`hold-soft` 與它同值。
- **細線**（`border`）與**強細線**（`border-strong`）：所有框線與分隔線；強細線給分段切換選中項的 ring、RankBar 中線與捲軸。
- **墨色三階**（`ink` / `ink-2` / `ink-3`）：主要文字與數值／次要文字與說明／標籤、表頭、註腳。深色時是冷白到藍灰，淺色時回到深墨色；兩種主題下每個文字色在所有底色上都達 WCAG AA。
- 淺色主題的中性階層：#f5f6f8 頁底、#ffffff 面板、#f0f2f5／#e7eaef 兩層灰、#dde1e7／#c5ccd6 細線、#111827／#4b5563／#5f6877 墨色。

### Named Rules
**The 紅漲綠跌只說方向 Rule.** `up` 與 `down` 只表示漲跌方向（含分組強弱、方向訊號），而且旁邊一定有文字。等級（T1／T2／T3）用中性徽章；模型「正常」用藍、「留意」用琥珀、「失效警示」用實心墨色底，都不用紅綠。

**The 一個藍 Rule.** 介面只有一個強調色。可點的連結、目前位置、焦點與「通過／正常」都用它；沒有第二個品牌色。

**The 電光藍上用深字 Rule.** 電光藍實心底上的字與圖形一律用 `accent-fg` token，不寫死白色；深色主題的 `accent-fg` 是近黑，因為白字在電光藍上只有 3.3:1。

**The 類別色不碰漲跌 Rule.** `series-1..5` 只給篩選器的五個組成，順序不可調換，也不可拿來表示方向；需要新的類別時先重跑色覺驗證。

## Typography

**Display Font:** 無（產品介面不用展示字體）
**Body Font:** system-ui（拉丁字與數字用平台介面字，中文落到 PingFang TC／Microsoft JhengHei／Noto Sans TC）
**Label/Mono Font:** ui-monospace（SF Mono、Cascadia Mono、Consolas），只給雜湊與指令

**Character:** 平台原生的介面字，讓繁體中文與數字都像作業系統本身一樣清楚；所有數字預設等寬，欄位與跳動的數值才對得齊。

### Hierarchy
- **Headline**（600，24px，1.25，字距 -0.025em）：每頁唯一的 h1（頁面標題），下方接 14px 的 `ink-2` 說明，說明寬度上限 72ch。同一尺寸也用在個股頁的大數值（名次、方向訊號、綜合評分，行高 1）。
- **Figure**（600，18px）：統計卡與狀態摘要的數值（大盤漲跌、監控統計、個股摘要列）。
- **Title**（600，15px，1.375）：面板標題與站名。
- **Body**（400，14px，1.6）：內文、表單、按鈕、分段切換。
- **Table**（400，13px，1.4）：所有資料表的儲存格。
- **Label**（400 或 600，12px）：表頭、狀態列、徽章、說明、註腳、手機分頁列。不用全大寫、不加字距。
- **Mono**（400，12px）：雜湊（前 16 碼加省略號）與驗證指令。

### Named Rules
**The 數字一律等寬 Rule.** `body` 層級就開了 `font-variant-numeric: tabular-nums`，任何元件都不要關掉它；數值欄靠右。負號用 U+2212（−），與正號等寬；缺值一律顯示「—」。

**The 等寬字只給機器 Rule.** `font-mono` 只用在雜湊與指令這類要被複製、比對的字串，不拿來營造「科技感」。

## Layout

內容寬度上限 1280px，置中；左右內距 16px，`lg`（1024px）以上 24px。主區頂部內距 24px，頁尾上方 40px。

- **外框**：56px 的 sticky 頂列（站名、總覽／排序／篩選／監控分頁、代號搜尋、選單），下方是全站狀態列（基準日、資料更新、存證鏈、模型監控、篩選候選），每一頁都看得到。狀態列在窄螢幕水平捲動、隱藏捲軸，項目之間以左側細線分隔。
- **兩欄**：總覽與個股頁在 `lg` 以上用 `2fr / 1fr` 兩欄、頂端對齊，欄距 20px；右欄面板之間 20px。`lg` 以下單欄。
- **DOM 順序＝視覺順序**：個股頁不用 `order-*` 或任何重排，桌機兩欄的閱讀順序、手機單欄順序、鍵盤與螢幕閱讀器順序完全一致。
- **手機**：`md`（768px）以下，頂列分頁收起，改為固定在底部的五鈕分頁列（總覽、排序、篩選、監控、選單），高 64px 加安全區；主內容底部預留 5rem 加安全區。`sm`（640px）以下搜尋框收成圖示按鈕。
- **表格欄位依寬度隱藏**：百分位在 `sm` 以上、篩選層級在 `md` 以上才顯示，讓 390px 寬也放得下，不需要水平捲動。
- **間距節奏**：4px 基準。表格儲存格 12×8px，面板內距 16px、標題列 16×12px，頁面標題下 20px。

### Named Rules
**The 表頭釘在頂列下 Rule.** 長資料表的表頭 `sticky` 在 `top-14`（56px，頂列正下方），底線用 `inset 0 -1px 0 var(--border)`。這些表格外面不包水平捲動容器，因為捲動容器會讓 sticky 失效；窄螢幕靠隱藏欄位解決寬度。只有限高、自己捲動的明細表（逐日數值、回放明細）把表頭 sticky 在自己容器的 `top-0`。

## Elevation & Depth

扁平系統。面板、表格、狀態列都靠 1px 細線與 `background`／`surface`／`surface-2` 的底色層次分出前後，靜止時沒有任何陰影。陰影只屬於浮在內容上方、會蓋住別的東西的層。唯一的發光是 `accent-glow` 的電光藍光暈，它標示「你在哪裡」與「鍵盤在哪裡」，不表示層次。

### Shadow Vocabulary
- **浮層**（`--shadow-pop`；深色 `0 14px 34px rgba(0, 0, 0, 0.55)`，淺色 `0 10px 28px rgba(17, 24, 39, 0.14), 0 2px 6px rgba(17, 24, 39, 0.06)`）：選單抽屜、代號搜尋的結果清單與「找不到」提示、監控頁 Rank IC 圖的 hover 提示框。
- **表頭底線**（`inset 0 -1px 0 var(--border)`）：不是陰影，是 sticky 表頭的分隔線（一般 border 在 sticky 時會跟著捲走）。
- **分頁光暈**（`box-shadow: 0 0 10px var(--accent-glow)`）：只加在桌機頂列目前分頁的 2px 電光藍底線上。
- **分頁圖示光暈**（`filter: drop-shadow(0 0 6px var(--accent-glow))`）：只加在手機底部分頁列選中項的圖示上。
- **焦點光暈**（`box-shadow: 0 0 12px var(--accent-glow)`）：與 2px `accent` outline 一起構成全站的 `:focus-visible` 焦點框。

### Named Rules
**The 細線不浮 Rule.** 嵌在版面裡的東西不加陰影也不加光暈；只有會疊在其他內容上方的抽屜、下拉清單與提示框使用 `--shadow-pop`。遮罩用 `scrim`。

**The 光暈只給位置與焦點 Rule.** `accent-glow` 只有三個用處：桌機目前分頁的底線、手機選中分頁的圖示、`:focus-visible` 焦點框。面板、卡片、徽章、按鈕、數值、圖表與 hover 狀態都不發光；淺色主題的光暈是 `transparent`，介面在沒有光暈時也必須完整可讀。

## Shapes

小而一致的圓角：面板、提示框（Notice）與摘要列 8px；按鈕、輸入框、徽章、分段切換軌道、浮層與指令區塊 6px；分段切換內的選項 5px，剛好內縮於 2px 的軌道；骨架與狀態列的小元素 4px；堆疊條的小色塊與命中色帶 2px；RankBar、機率條與 ScoreBar 用全圓。框線一律 1px。站標「排序條加鏈節」（使用者設計）：6px 圓角的深藍黑方塊（#0A0F1A），三條由長到短的淺灰白橫條（#E7EEF8，代表排序）左端串在一條直線上（一筆接一筆的存證紀錄），最上面那一節是電光藍圓點（#3D8BFF，今天這一節）。顏色固定、不隨主題切換；分頁圖示（app/icon.svg）、頂列站標（BrandMark）與 iPhone 主畫面圖示（app/apple-icon.png，方形底，由系統套圓角）是同一個圖形。

## Components

### Buttons
- **Shape:** 6px 圓角，高 36px（圖示按鈕 36–40px 見方）。
- **Secondary（主要形式）:** `surface` 底、1px `border`、`ink-2` 文字、左右 12px，例如頂列的「選單」、個股頁的「加入自選」。
- **Hover / Focus:** hover 換成 `surface-2` 底與 `ink` 文字，150ms 顏色轉換；焦點一律是 2px `accent` outline、offset 2px，外加 12px 的 `accent-glow` 光暈。
- **Ghost 圖示按鈕:** 無框，`ink-2` 圖示，hover 同上。
- **Primary（只給送出查詢）:** 電光藍實心底、`accent-fg` 字、600、左右 16px，hover 換成 `accent-hover`。只用在表單的送出鈕（排序頁的「查詢」、個股頁歷史回放的「重算這段區間」），另一個實心藍底是「跳到主要內容」連結。其他主要動作是點表格列與連結。

### Chips（徽章）
- **Style:** 12px、600、行高 1，左右 6px、上下 2px，6px 圓角，可帶 13px 圖示。neutral 有 1px `border`，其餘色調框線透明。
- **State:** 色調依語意：neutral（T1／T2／T3、一般）、accent（驗證通過、正常）、up／down／hold（強／弱／中、漲／跌／觀望）、warn（留意）、solid 實心墨色（驗證不符、失效警示）。徽章文字永遠存在，顏色只是輔助。

### Cards / Containers（面板）
- **Corner Style:** 8px。
- **Background:** `surface`。
- **Shadow Strategy:** 無（見 Elevation & Depth）。
- **Border:** 1px `border`；標題列與內容之間一條細線。
- **Internal Padding:** 內容 16px；標題列 16×12px，標題 15px 半粗、可帶 12px `ink-3` 說明，右側放分段切換或徽章。放表格時內容區內距為 0，表尾另一條細線放連結與說明。面板只用在真正需要分組的地方，不拿來包每一段文字。

### Inputs / Fields
- **Style:** 高 36px、6px 圓角、1px `border`。搜尋框靜止時 `surface-2` 底、左側 16px 搜尋圖示；日期等一般欄位為 `surface` 底。
- **Focus:** 框線換成 `accent`，搜尋框底色換成 `surface`；游標色為 `accent`。
- **Search popover:** 下方 4px 浮出，`surface` 底、6px 圓角、細線框加 `--shadow-pop`，最多 8 筆；選中項 `surface-2` 底。

### Navigation
- **頂列（桌機）:** `surface` 底、底部細線、高 56px。分頁文字 14px `ink-2`，hover 變 `ink`；目前頁面為半粗 `ink`，底部一條 2px 全圓角的 `accent` 底線，底線帶 10px 的 `accent-glow` 光暈。
- **狀態列:** 頂列下方，`surface-2` 底、12px；標籤 `ink-3`、值半粗 `ink`，項目之間以左側細線分隔。可點項目 hover 加底線。過期資料以 `warn` 加三角圖示與文字標出。
- **底部分頁列（手機）:** 五等分、高 64px，20px 圖示疊 12px 文字；選中項 `accent`、半粗、圖示筆畫加粗到 2.2 並帶 6px 的 `accent-glow` 光暈，其餘 `ink-2`。第五鈕開選單抽屜。
- **選單抽屜:** 原生 `<dialog>`，從右側滑入、寬 min(22rem, 100vw)、全高，左側細線加 `--shadow-pop`，背後 `scrim` 遮罩；內有主題切換（三格分段）與規則文件連結。

### Segmented（分段切換）
`surface-2` 軌道、1px 細線、6px 圓角、2px 內距；選中項 `surface` 底、`ink` 文字、1px `border-strong` ring、5px 圓角；未選中 `ink-2`，hover 變 `ink`。兩種尺寸：36px／14px 與 32px／12px。用 `aria-pressed` 標示目前選項。

### Data Table（資料表）
13px 儲存格、12×8px 內距、列與列之間細線；表頭 12px `ink-3`、`surface-2` 底、sticky 在頂列下方。數值欄靠右。整列可點（hover 換 `surface-2`），名稱本身是連結供鍵盤使用。可排序欄位的表頭是按鈕，選中時顯示 13px 箭頭並標 `aria-sort`。

### RankBar（分數條）
6px 高、96px 寬的全圓角 `surface-3` 軌道，以 0.5（贏過中位數的機率對半）為中線：高於 0.5 往右畫 `accent`，低於 0.5 往左畫 `ink-3`，長度以清單中離 0.5 最遠的距離縮放（至少 0.05）。中線是一條 1px、10px 高的 `border-strong` 刻度。分數條純裝飾，數值另以文字顯示；它刻意不用紅綠。

### ScoreBar（綜合評分堆疊條）
全圓角、段與段之間 1px 間隙，每段是一個組成的貢獻，依 `series-1..5` 順序上色，剩餘到 100 的部分用 `surface-3`。旁邊一定有組成分數的文字表。

### HitMark（命中標記）
命中與否用中性圖形：命中是 `ink` 的實心勾選圓圈、未命中是 `ink-3` 的叉圓圈、未到期是 `ink-3` 時鐘，各附螢幕閱讀器文字。個股的命中色帶以「實心＝命中、空心＝未命中」表達結果，顏色只表示當時預測的方向，並附圖例說明。

### Feedback
骨架與資料到了之後同尺寸，`surface-3`、只在 `motion-safe` 時脈動。提示框（Notice）8px 圓角、細線框、17px 圖示加文字，寫出發生什麼與怎麼處理；空狀態置中、22px `ink-3` 圖示、標題加不超過 48ch 的說明。

## Do's and Don'ts

### Do:
- **Do** 把漲跌方向交給 `up`（紅）與 `down`（綠），並在旁邊寫出「漲／跌／強／弱」或帶正負號的數字。
- **Do** 用 `accent` 表示「通過／正常」，用實心 `ink` 徽章表示「不符／失效警示」。
- **Do** 保持 `tabular-nums`，數值欄靠右，負號用 U+2212，缺值用「—」。
- **Do** 把長資料表的表頭 sticky 在 `top-14`，並以隱藏欄位處理窄螢幕，而不是包水平捲動容器。
- **Do** 面板用 1px `border`、8px 圓角、`surface` 底，標題列與內容之間一條細線。
- **Do** 讓 DOM 順序等於視覺順序；兩欄只靠 grid 欄位排列，不用 `order-*` 重排。
- **Do** 每個狀態都同時有圖示與文字，焦點一律是 2px `accent` outline 加 12px `accent-glow` 光暈。
- **Do** 在電光藍實心底上用 `accent-fg` 的字（深色主題為近黑）。
- **Do** 新增顏色時，先確認文字色在四層深色底與淺色底上都達 4.5:1。

### Don't:
- **Don't** 用綠色表示「正常」或「通過」，也不要用紅色表示錯誤、失效或警示；台股的紅綠已經是漲跌。
- **Don't** 引進第二個強調色，或把 `series-1..5` 用在篩選器組成以外的地方。
- **Don't** 在嵌入版面的面板、表格、卡片加陰影；`--shadow-pop` 只給抽屜、下拉清單與提示框。
- **Don't** 把 `accent-glow` 用在選中分頁與焦點框以外的地方（面板、徽章、按鈕、數值、hover 都不發光）。
- **Don't** 在電光藍實心底上寫死白字；深色主題下白字只有 3.3:1。
- **Don't** 用 `font-mono` 排一般數字或標題；它只給雜湊與指令。
- **Don't** 用流動字級（clamp）或展示字體；字級是固定的。
- **Don't** 在 sticky 表頭的表格外面包 `overflow-x-auto`。
