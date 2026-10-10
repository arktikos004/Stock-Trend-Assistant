/** 對外連結：規則文件、存證鏈、資料來源與授權。全部指向公開的 GitHub repo 或官方網站。 */

export const REPO_URL = "https://github.com/arktikos004/Stock-Trend-Assistant";

export const LINKS = {
  repo: REPO_URL,
  ledger: `${REPO_URL}/tree/ledger`,
  screenerRules: `${REPO_URL}/blob/master/docs/screener_prereg.md`,
  monitorRules: `${REPO_URL}/blob/master/docs/monitor_prereg.md`,
  dataSources: `${REPO_URL}/blob/master/DATA_SOURCES.md`,
  onlineReport: `${REPO_URL}/blob/master/docs/online_predictions.md`,
  rankReport: `${REPO_URL}/blob/master/docs/cross_sectional_report.md`,
  openDataLicense: "https://data.gov.tw/license",
  tradingView: "https://www.tradingview.com/",
} as const;
