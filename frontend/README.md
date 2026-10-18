# 前端：台股相對強弱排序與預測存證平台

Next.js 16（App Router）＋ TypeScript ＋ Tailwind v4，K 線用 TradingView Lightweight Charts v5，圖示用 lucide-react。
這一版 Next.js 的 API 與慣例和舊版不同，寫程式前先看 `node_modules/next/dist/docs/` 裡對應的說明。

## 兩種執行方式

本機開發接即時後端：

```bash
npm install
npm run dev        # http://localhost:3000，後端 uvicorn 要先在 :8000 啟動（見根目錄 README）
```

公開站是靜態輸出，資料讀 `public/data/*.json`（每日排程匯出，不進版控）：

```bash
NEXT_PUBLIC_STATIC_DATA=1 NEXT_PUBLIC_NEWS_API_BASE=https://news.sekinv.com npm run build   # 輸出到 out/
npx serve out      # 或 npx wrangler pages dev out
```

`public/data` 的取得方式與部署流程見 [docs/deploy.md](../docs/deploy.md)。

## 檢查

```bash
npm run lint
npx tsc --noEmit
```

## 結構

| 位置 | 內容 |
| --- | --- |
| `app/` | 頁面：`/` 總覽、`/stock` 個股、`/scan` 排序、`/screener` 篩選器、`/monitor` 監控、`/docs` 文件中心（舊的 `/method#段落` 轉到對應主題） |
| `components/shell/` | 全站外框：頂列（含資料戳記）、手機底部分頁列、選單抽屜、代號搜尋 |
| `components/ui/` | 共用元件：面板、頁首、徽章、分段切換、點開才看到的提示（連到文件中心）、骨架與空狀態 |
| `components/docs/`、`lib/docs.ts` | 文件中心：各主題的內容，以及目錄、搜尋與舊錨點轉址共用的索引 |
| `lib/api.ts` | API client；靜態站模式下由瀏覽器端切片 JSON，規則逐一對照後端路由 |
| `app/globals.css` | 設計 token（深色為預設、淺色、跟隨系統） |
