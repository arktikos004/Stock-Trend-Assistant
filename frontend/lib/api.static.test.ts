/**
 * 靜態站（stock.sekinv.com）的 API：讀每日匯出的 /data/*.json，在瀏覽器端重做後端帶參數端點的切片規則。
 * 這些規則必須與 backend/stockta/api/routers 一致，否則公開站和本機 API 會給出不同的結果。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const META = {
  generated_at: "2026-10-08T07:30:00+00:00",
  last_trading_day: "2026-10-08",
  data_as_of: "2026-10-08",
  model_version: "gru-test",
  cs_model: "xgb",
  range_days: { "1mo": 30, "1y": 365 },
  candles_source: "twse-openapi",
  candles_adjusted: false,
  candles_start: "2026-09-01",
  candles_end: "2026-10-08",
  history_start: "2026-09-01",
};

const CANDLES = {
  ticker: "2330.TW",
  candles: ["2026-09-01", "2026-09-08", "2026-10-02", "2026-10-07", "2026-10-08"].map((time) => ({
    time,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
  })),
};

const HISTORY = {
  ticker: "2330.TW",
  start: "2026-09-01",
  end: "2026-10-08",
  count: 3,
  hits: 2,
  hit_rate: 2 / 3,
  // 後端 history_series 的順序：新到舊
  records: [
    { date: "2026-10-01", signal: "漲", confidence: 0.5, actual: "漲", actual_return: 0.03, hit: true },
    { date: "2026-09-30", signal: "跌", confidence: 0.5, actual: "觀望", actual_return: 0.0, hit: false },
    { date: "2026-09-29", signal: "觀望", confidence: 0.5, actual: "觀望", actual_return: 0.0, hit: true },
  ],
};

const SCAN_INDEX = {
  latest: "2026-10-08",
  sessions: ["2026-10-01", "2026-10-02", "2026-10-06", "2026-10-07"],
  dates: ["2026-10-01", "2026-10-02", "2026-10-07"], // 10-06 那天匯出失敗
};

const ROUTES: Record<string, unknown> = {
  "/data/meta.json": META,
  "/data/stocks/2330.TW/candles-twse.json": CANDLES,
  "/data/stocks/2330.TW/history.json": HISTORY,
  "/data/scan/index.json": SCAN_INDEX,
  "/data/scan/latest.json": { base_date: "latest" },
  "/data/scan/2026-10-02.json": { base_date: "2026-10-02" },
};

/** 假的靜態檔：routes 以外的路徑一律 404 */
function serve(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url in routes
        ? new Response(JSON.stringify(routes[url]), { status: 200, headers: { "content-type": "application/json" } })
        : new Response("not found", { status: 404 }),
    ),
  );
}

/** 每次重新載入模組：STATIC_DATA 在載入時讀環境變數，siteMeta 與 staticOnce 也有模組層快取 */
async function loadStaticApi(routes: Record<string, unknown> = ROUTES) {
  serve(routes);
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_STATIC_DATA", "1");
  return (await import("@/lib/api")).staticApi;
}

const times = (r: { candles: { time: string }[] }) => r.candles.map((c) => c.time);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("staticApi.candles", () => {
  it("range 從最後交易日往前算日曆天，兩端都包含", async () => {
    const api = await loadStaticApi();
    // 2026-10-08 往前 30 天＝2026-09-08（含）
    expect(times(await api.candles("2330.TW", "1mo"))).toEqual(["2026-09-08", "2026-10-02", "2026-10-07", "2026-10-08"]);
  });

  it("自訂區間兩端都包含", async () => {
    const api = await loadStaticApi();
    expect(times(await api.candles("2330.TW", "1mo", "2026-10-02", "2026-10-07"))).toEqual(["2026-10-02", "2026-10-07"]);
  });

  it("起訖顛倒回 INVALID_RANGE；早於資料起點回 OUT_OF_RANGE；不支援的 range 回 INVALID_RANGE", async () => {
    const api = await loadStaticApi();
    await expect(api.candles("2330.TW", "1mo", "2026-10-07", "2026-10-02")).rejects.toMatchObject({ status: 422, code: "INVALID_RANGE" });
    await expect(api.candles("2330.TW", "1mo", "2026-08-01", "2026-10-02")).rejects.toMatchObject({ status: 422, code: "OUT_OF_RANGE" });
    await expect(api.candles("2330.TW", "7y")).rejects.toMatchObject({ status: 422, code: "INVALID_RANGE" });
  });

  it("舊版網站資料（沒有證交所 K 線）回空清單，不顯示 yfinance 價格", async () => {
    const legacyMeta: Record<string, unknown> = { ...META };
    delete legacyMeta.candles_source;
    const api = await loadStaticApi({ ...ROUTES, "/data/meta.json": legacyMeta });
    expect((await api.candles("2330.TW", "1mo")).candles).toEqual([]);
  });
});

describe("staticApi.stockHistory", () => {
  it("取 (start, end]，並依篩選後的紀錄重算命中率", async () => {
    const api = await loadStaticApi();
    const r = await api.stockHistory("2330.TW", "2026-09-29", "2026-10-01");
    expect(r.records.map((x) => x.date)).toEqual(["2026-10-01", "2026-09-30"]);
    expect([r.count, r.hits, r.hit_rate]).toEqual([2, 1, 0.5]);
  });

  it("起日早於匯出範圍回 OUT_OF_RANGE", async () => {
    const api = await loadStaticApi();
    await expect(api.stockHistory("2330.TW", "2026-08-01", "2026-10-01")).rejects.toMatchObject({ status: 422, code: "OUT_OF_RANGE" });
  });
});

describe("staticApi.scan（歷史某日）", () => {
  it("不帶日期或日期 ≥ 最後交易日時讀最新一份", async () => {
    const api = await loadStaticApi();
    expect(await api.scan()).toEqual({ base_date: "latest" });
    expect(await api.scan("2026-10-08")).toEqual({ base_date: "latest" });
  });

  it("查詢日對齊到 ≤ 它的最後一個交易日", async () => {
    const api = await loadStaticApi();
    expect(await api.scan("2026-10-05")).toEqual({ base_date: "2026-10-02" });
  });

  it("對齊到的交易日沒有匯出時回 404，不改給別天", async () => {
    const api = await loadStaticApi();
    await expect(api.scan("2026-10-06")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("早於保留範圍回 OUT_OF_RANGE", async () => {
    const api = await loadStaticApi();
    await expect(api.scan("2026-09-30")).rejects.toMatchObject({ status: 422, code: "OUT_OF_RANGE" });
  });
});

describe("staticApi.chips", () => {
  const CHIPS = { ticker: "2330.TW", margin: [], holders: [], meta: { margin_start: null } };

  it("讀個股的 chips.json", async () => {
    const api = await loadStaticApi({ ...ROUTES, "/data/stocks/2330.TW/chips.json": CHIPS });
    expect(await api.chips("2330.TW")).toEqual(CHIPS);
  });

  it("這一版網站資料還沒有這個檔（404）時回 null：面板顯示說明，不是錯誤", async () => {
    const api = await loadStaticApi();
    expect(await api.chips("2330.TW")).toBeNull();
  });

  it("其他錯誤照常拋出", async () => {
    const api = await loadStaticApi();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 500 })));
    await expect(api.chips("2330.TW")).rejects.toMatchObject({ status: 500 });
  });
});
