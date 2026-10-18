/**
 * 文件中心的目錄：每個主題一頁（/docs/<slug>）。左側分組目錄、右側「本頁內容」、搜尋與頁面上的提示都讀這一份。
 * slug 沿用舊「方法與限制」單頁的段落 id，所以 /method#rank 直接對應 /docs/rank。
 * headings 必須和 components/docs/topics.tsx 裡各主題的段落 id 一致（lib/docs.test.ts 檢查目錄本身，渲染由建置與截圖確認）。
 */

export type DocSlug =
  | "reading"
  | "rank"
  | "model"
  | "baselines"
  | "tradable"
  | "backtest"
  | "direction"
  | "screener"
  | "chips"
  | "market"
  | "chart"
  | "ledger"
  | "data";

export type DocGroup = "start" | "model" | "direction" | "screener" | "chart" | "ledger" | "data";

export interface DocEntry {
  slug: DocSlug;
  title: string;
  group: DocGroup;
  /** 一句話摘要：頁首副標，也是頁面提示的預設內容 */
  summary: string;
  headings: { id: string; label: string }[];
  keywords: string[];
}

export const DOC_GROUPS: { key: DocGroup; label: string }[] = [
  { key: "start", label: "開始" },
  { key: "model", label: "排序模型" },
  { key: "direction", label: "方向訊號" },
  { key: "screener", label: "篩選與籌碼" },
  { key: "chart", label: "圖表" },
  { key: "ledger", label: "存證" },
  { key: "data", label: "資料" },
];

export const DOCS: DocEntry[] = [
  {
    slug: "reading",
    title: "這個網站怎麼讀",
    group: "start",
    summary: "名次、方向訊號、篩選器回答三個不同的問題，都是研究用的統計輸出，不構成投資建議。",
    headings: [
      { id: "place", label: "相對強弱名次" },
      { id: "signal", label: "方向訊號" },
      { id: "list", label: "篩選器" },
    ],
    keywords: ["名次", "方向", "篩選", "投資建議", "怎麼讀"],
  },
  {
    slug: "rank",
    title: "相對強弱排序",
    group: "model",
    summary: "分數是模型估計贏過全池中位數的機率，沒有做過校準；名次只是相對位置，排名靠前仍可能下跌。",
    headings: [
      { id: "score", label: "模型分數與百分位" },
      { id: "groups", label: "分組" },
      { id: "recorded", label: "存證的排序" },
      { id: "pool", label: "股票池" },
    ],
    keywords: ["分數", "機率", "百分位", "前 20%", "後 20%", "台灣 50", "校準", "星等"],
  },
  {
    slug: "model",
    title: "模型效果怎麼看",
    group: "model",
    summary: "Rank IC 為 0 代表沒有預測力；t 值用 Newey–West 標準誤，狀態依預先聲明的規則判定，只顯示、不自動停用模型。",
    headings: [
      { id: "rank-ic", label: "Rank IC" },
      { id: "skill", label: "技能檢定" },
      { id: "groups", label: "線上成績的三組" },
      { id: "status", label: "狀態" },
      { id: "horizon", label: "還要多久" },
    ],
    keywords: ["Rank IC", "Newey-West", "t 值", "技能檢定", "失效", "留意", "即時記錄", "事後重建"],
  },
  {
    slug: "baselines",
    title: "和簡單因子比",
    group: "model",
    summary: "排除短期反轉與動量之後，模型還剩多少預測力；只有中和後 Rank IC 有判讀，其餘只描述。",
    headings: [
      { id: "factors", label: "三個因子" },
      { id: "neutral", label: "中和後 Rank IC" },
      { id: "descriptive", label: "描述性對照" },
    ],
    keywords: ["動量", "反轉", "中和", "因子", "Diebold-Mariano"],
  },
  {
    slug: "tradable",
    title: "收盤後才買得到的成績",
    group: "model",
    summary: "排序在收盤後才寫入，可成交版的報酬從下一個交易日收盤起算；前後 20% 只用即時記錄，未扣交易成本。",
    headings: [
      { id: "next-close", label: "可成交版 Rank IC" },
      { id: "quintiles", label: "前 20% 與後 20%" },
    ],
    keywords: ["可成交", "t+1", "前 20%", "後 20%", "價差", "交易成本"],
  },
  {
    slug: "backtest",
    title: "回測與示意組合",
    group: "model",
    summary: "測試期 Rank IC 未達雙尾 5% 顯著；示意組合包含選模型用的期間，不是獨立驗證，也沒有計入滑價。",
    headings: [
      { id: "periods", label: "訓練、驗證與測試" },
      { id: "portfolio", label: "示意組合" },
    ],
    keywords: ["回測", "測試期", "驗證期", "示意組合", "成本", "滑價"],
  },
  {
    slug: "direction",
    title: "方向訊號",
    group: "direction",
    summary: "漲跌＝5 日累積報酬超過 ±2%；機率沒有校準，命中率一定要和全猜觀望、全猜漲的基線比。",
    headings: [
      { id: "classes", label: "漲、跌與觀望" },
      { id: "baselines", label: "命中率與基線" },
      { id: "timing", label: "寫入時間" },
    ],
    keywords: ["漲", "跌", "觀望", "命中率", "基線", "校準", "bootstrap"],
  },
  {
    slug: "screener",
    title: "篩選器",
    group: "screener",
    summary: "依事先公開的固定規則整理成候選清單，不是預測，也不存證、不算命中率。",
    headings: [
      { id: "tiers", label: "綜合評分與分層" },
      { id: "revenue", label: "月營收" },
    ],
    keywords: ["綜合評分", "T1", "T2", "T3", "營收", "評價", "籌碼", "動能"],
  },
  {
    slug: "chips",
    title: "融資融券與大戶持股",
    group: "screener",
    summary: "只用可以公開再散布的開放資料；融資成本與維持率是本站的粗略估算。",
    headings: [
      { id: "sources", label: "資料來源" },
      { id: "margin", label: "融資融券" },
      { id: "holders", label: "大戶持股" },
      { id: "cost", label: "融資成本" },
      { id: "ratio", label: "融資維持率" },
      { id: "missing", label: "沒有的資料" },
    ],
    keywords: ["融資", "融券", "券資比", "大戶", "集保", "維持率", "當沖", "三大法人"],
  },
  {
    slug: "market",
    title: "大盤多空標籤",
    group: "screener",
    summary: "5 日報酬、20 日均線乖離與上漲家數比三項同向才標偏多或偏空；只描述已發生的狀態。",
    headings: [
      { id: "rule", label: "標籤規則" },
      { id: "inputs", label: "三個數字" },
      { id: "source", label: "資料來源" },
    ],
    keywords: ["偏多", "偏空", "中性", "上漲家數", "乖離", "加權指數"],
  },
  {
    slug: "chart",
    title: "K 線圖的均線與指標",
    group: "chart",
    summary: "K 線來自證交所開放資料、未還原權值；資料累積到足夠的交易日才畫指標。",
    headings: [
      { id: "ma", label: "均線與乖離率" },
      { id: "kd", label: "KD" },
      { id: "rsi", label: "RSI" },
      { id: "macd", label: "MACD" },
      { id: "warmup", label: "起算與暖機" },
      { id: "breakout", label: "前高前低與放量" },
      { id: "features", label: "模型輸入的技術指標" },
    ],
    keywords: ["K 線", "均線", "乖離率", "KD", "RSI", "MACD", "前高", "放量", "XQ"],
  },
  {
    slug: "ledger",
    title: "預測存證",
    group: "ledger",
    summary: "每天新寫入的預測串成雜湊鏈的一節，任何一列被改動，驗證都會失敗；任何人都能自己重算。",
    headings: [
      { id: "chain", label: "雜湊鏈" },
      { id: "first", label: "第 1 節" },
      { id: "verify", label: "自己驗證" },
    ],
    keywords: ["存證", "雜湊", "ledger", "驗證", "chain.jsonl", "節"],
  },
  {
    slug: "data",
    title: "資料與授權",
    group: "data",
    summary: "證交所與集保的開放資料依政府資料開放授權條款利用；模型訓練用的歷史價格只在內部使用。",
    headings: [
      { id: "open-data", label: "開放資料" },
      { id: "news", label: "新聞情緒" },
    ],
    keywords: ["開放資料", "授權", "證交所", "集保", "Yahoo", "新聞"],
  },
];

const BY_SLUG = new Map(DOCS.map((d) => [d.slug, d]));

export function isDocSlug(value: string): value is DocSlug {
  return BY_SLUG.has(value as DocSlug);
}

export function getDoc(slug: DocSlug): DocEntry {
  return BY_SLUG.get(slug)!;
}

export function docHref(slug: DocSlug, anchor?: string): string {
  return `/docs/${slug}${anchor ? `#${anchor}` : ""}`;
}

/** 目錄順序裡的上一篇與下一篇 */
export function neighbours(slug: DocSlug): { prev: DocEntry | null; next: DocEntry | null } {
  const i = DOCS.findIndex((d) => d.slug === slug);
  return { prev: i > 0 ? DOCS[i - 1] : null, next: i >= 0 && i < DOCS.length - 1 ? DOCS[i + 1] : null };
}

/** 舊的「方法與限制」單頁：/method#<段落> → 對應的主題頁；不認得的錨點回文件中心首頁 */
export function methodRedirect(hash: string): string {
  const id = hash.replace(/^#/, "");
  return isDocSlug(id) ? docHref(id) : "/docs";
}

export interface DocHit {
  doc: DocEntry;
  heading: { id: string; label: string } | null;
}

/** 搜尋標題、摘要、段落標題與關鍵字（不分大小寫）；段落標題命中時直接連到那一段 */
export function searchDocs(query: string): DocHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: DocHit[] = [];
  for (const doc of DOCS) {
    const heading = doc.headings.find((h) => h.label.toLowerCase().includes(q)) ?? null;
    const inDoc =
      doc.title.toLowerCase().includes(q) || doc.summary.toLowerCase().includes(q) || doc.keywords.some((k) => k.toLowerCase().includes(q));
    if (heading || inDoc) hits.push({ doc, heading });
  }
  return hits;
}
