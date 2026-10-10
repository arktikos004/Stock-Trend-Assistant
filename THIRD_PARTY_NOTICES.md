# 第三方套件與授權

盤點日：2026-10-04。Python 以 `pip-licenses`、前端以 `license-checker` 對實際安裝的版本產生；
資料、資料集與模型的來源與授權另見 [DATA_SOURCES.md](DATA_SOURCES.md)，生成式 AI 的使用見 [AI_USE.md](AI_USE.md)。

## 需要特別說明的項目

**本專案沒有使用 GPL 或 AGPL 授權的套件。** 下表列出弱 copyleft、有署名要求，或會隨網站散布的項目。

| 項目 | 授權 | 用在哪裡 | 是否隨成果散布 | 說明 |
| --- | --- | --- | --- | --- |
| certifi | MPL-2.0 | Python 的 HTTPS 憑證清單 | 否 | 只在伺服端與排程使用，未修改原始碼 |
| `@img/sharp-*`、`@img/sharp-libvips-*` | Apache-2.0 AND LGPL-3.0-or-later | Next.js 的選用影像處理相依（依作業系統安裝其一） | 否 | 只存在於建置環境；網站是靜態輸出，不含這些二進位檔 |
| lightningcss | MPL-2.0 | CSS 建置工具 | 否 | 只在建置時執行 |
| axe-core | MPL-2.0 | ESLint 外掛的相依 | 否 | 開發工具 |
| caniuse-lite | CC-BY-4.0 | 瀏覽器相容性資料 | 否 | 只在建置時讀取 |
| argparse（npm） | Python-2.0 | 開發工具的相依 | 否 | 開發工具 |
| lightweight-charts | Apache-2.0（另有署名要求） | 網站 K 線圖 | 是 | 依其授權要求，網站頁尾放上 TradingView 連結，圖上保留 TradingView 標誌；NOTICE 原文見文末 |
| lucide-react | ISC | 網站圖示 | 是 | 用到的圖示在建置時打包成 SVG 隨網站提供，未修改。網站文字改用使用者裝置的系統字體，不再隨附字型檔 |

## Python 套件（後端 API、每日排程與模型訓練；不隨網站散布）

| 套件 | 版本 | 授權 |
| --- | --- | --- |
| annotated-doc | 0.0.5 | MIT |
| annotated-types | 0.8.0 | MIT |
| anyio | 4.15.1 | MIT |
| beautifulsoup4 | 4.15.0 | MIT |
| certifi | 2026.7.22 | MPL-2.0 |
| cffi | 2.1.1 | MIT-0 |
| charset-normalizer | 3.5.2 | MIT |
| click | 8.5.0 | BSD-3-Clause |
| colorama | 0.4.6 | BSD |
| cryptography | 50.0.2 | Apache-2.0 OR BSD-3-Clause |
| curl_cffi | 0.16.3 | MIT |
| Deprecated | 3.0.0 | MIT |
| fastapi | 0.139.0 | MIT |
| filelock | 3.32.3 | MIT |
| fsspec | 2026.7.0 | BSD-3-Clause |
| h11 | 0.16.0 | MIT |
| httpcore | 1.0.9 | BSD-3-Clause |
| httptools | 0.8.0 | MIT |
| httpx | 0.28.1 | BSD |
| idna | 3.20 | BSD-3-Clause |
| iniconfig | 2.3.0 | MIT |
| Jinja2 | 3.1.6 | BSD |
| joblib | 1.5.3 | BSD-3-Clause |
| limits | 5.8.0 | MIT |
| lxml | 6.1.3 | BSD-3-Clause |
| MarkupSafe | 3.0.3 | BSD-3-Clause |
| mpmath | 1.3.0 | BSD |
| multitasking | 0.0.13 | Apache-2.0 |
| narwhals | 2.26.0 | MIT |
| networkx | 3.6.1 | BSD-3-Clause |
| numpy | 2.5.1 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause |
| pandas | 3.0.3 | BSD |
| peewee | 4.5.2 | MIT（metadata 未填，依套件隨附 LICENSE 檔） |
| platformdirs | 4.12.3 | MIT |
| pluggy | 1.6.0 | MIT |
| protobuf | 7.36.2 | BSD-3-Clause |
| pyarrow | 25.0.0 | Apache-2.0 |
| pycparser | 3.0 | BSD-3-Clause |
| pydantic | 2.13.4 | MIT |
| pydantic_core | 2.46.4 | MIT |
| Pygments | 2.21.0 | BSD-2-Clause |
| pytest | 9.1.1 | MIT |
| python-dateutil | 2.9.0.post0 | Apache-2.0 OR BSD |
| python-dotenv | 1.2.4 | BSD-3-Clause |
| pytz | 2026.5 | MIT |
| PyYAML | 6.0.3 | MIT |
| requests | 2.34.2 | Apache-2.0 |
| scikit-learn | 1.9.0 | BSD-3-Clause |
| scipy | 1.18.0 | BSD |
| six | 1.17.0 | MIT |
| slowapi | 0.1.10 | MIT |
| soupsieve | 2.10 | MIT |
| starlette | 1.3.1 | BSD-3-Clause |
| sympy | 1.14.0 | BSD |
| threadpoolctl | 3.7.0 | BSD-3-Clause |
| torch | 2.11.0+cpu | BSD-3-Clause |
| typing-inspection | 0.4.4 | MIT |
| typing_extensions | 4.16.0 | PSF-2.0 |
| tzdata | 2026.3 | Apache-2.0 |
| urllib3 | 2.8.0 | MIT |
| uvicorn | 0.51.0 | BSD-3-Clause |
| watchfiles | 1.3.0 | MIT |
| websockets | 17.2 | BSD-3-Clause |
| wrapt | 2.5.0 | BSD-2-Clause |
| xgboost | 3.3.0 | Apache-2.0 |
| yfinance | 1.7.0 | Apache-2.0 |

深度學習框架 torch 在雲端排程安裝 CPU 版；本機訓練使用 CUDA 版時，另含 NVIDIA 的 CUDA 執行階段函式庫（依 NVIDIA 授權條款，僅在本機使用、不散布）。

## 前端正式相依（`dependencies` 及其相依）

其中只有在瀏覽器執行的程式（React、Next.js 的用戶端執行階段、圖表與 UI 元件）會打包進靜態網站；`@img/sharp-*`、`caniuse-lite` 等是 Next.js 在建置或伺服端才用到的相依，不在網站輸出裡。

| 套件 | 版本 | 授權 |
| --- | --- | --- |
| @img/colour | 1.1.0 | MIT |
| @img/sharp-win32-x64 | 0.34.5 | Apache-2.0 AND LGPL-3.0-or-later |
| @next/env | 16.2.10 | MIT |
| @next/swc-win32-x64-msvc | 16.2.10 | MIT |
| @swc/helpers | 0.5.15 | Apache-2.0 |
| baseline-browser-mapping | 2.10.42 | Apache-2.0 |
| caniuse-lite | 1.0.30001803 | CC-BY-4.0 |
| client-only | 0.0.1 | MIT |
| detect-libc | 2.1.2 | Apache-2.0 |
| fancy-canvas | 2.1.0 | MIT |
| lightweight-charts | 5.2.0 | Apache-2.0 |
| lucide-react | 1.55.0 | ISC |
| nanoid | 3.3.15 | MIT |
| next | 16.2.10 | MIT |
| picocolors | 1.1.1 | ISC |
| postcss | 8.4.31 | MIT |
| react | 19.2.4 | MIT |
| react-dom | 19.2.4 | MIT |
| scheduler | 0.27.0 | MIT |
| semver | 7.8.5 | ISC |
| sharp | 0.34.5 | Apache-2.0 |
| source-map-js | 1.2.1 | BSD-3-Clause |
| styled-jsx | 5.1.6 | MIT |
| tslib | 2.8.1 | 0BSD |

## 前端建置與開發工具（共 336 個套件；不隨網站散布）

| 授權 | 套件數 |
| --- | --- |
| MIT | 292 |
| Apache-2.0 | 17 |
| ISC | 13 |
| BSD-2-Clause | 7 |
| MPL-2.0 | 3 |
| Python-2.0 | 1 |
| BSD-3-Clause | 1 |
| CC0-1.0 | 1 |
| BlueOak-1.0.0 | 1 |

## lightweight-charts 的 NOTICE 原文

```text
TradingView Lightweight Charts™
Copyright (с) 2025 TradingView, Inc. https://www.tradingview.com/
```
