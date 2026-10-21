"""線上相對強弱實證報告（線上 Rank IC）：python -m stockta.ml.report_rank_predictions

讀 rank_predictions（cross-sectional 分數），對每筆以 parquet 快取算實際
LABEL_HORIZON_DAYS 日 forward return，逐日 Spearman(分數, 報酬) 得**線上 Rank IC**
——選股技能的標準指標，且**不受多頭 beta 影響**（問「贏過中位數」而非「漲」），因此
比絕對方向線上命中率更能為 experiment_log #8 的正面主線背書。

與絕對方向 online_predictions.md 互補：同一批線上交易日，絕對方向難、相對排序可行。
分數以固定 CS 權重點對點產生（無前視）；早期歷史基準日由 point-in-time 重建
（source=pit）以立即有可到期樣本，往後由每日 live 記錄延續。
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date

import numpy as np

from stockta.config import (
    ARTIFACTS_CS_DIR,
    BACKEND_ROOT,
    CS_TOP_FRACTION,
    DATA_CACHE_DIR,
    LABEL_HORIZON_DAYS,
    PREDICTIONS_DB_PATH,
)
from stockta.data.cache import ParquetCache
from stockta.ml.cs_metrics import NW_LAGS, quantile_spread, rank_ic
from stockta.ml.online import collect_matured, cs_production_version, daily_ic
from stockta.stats import MIN_DAYS

DOCS_DIR = BACKEND_ROOT.parent / "docs"


def _load_rows(version: str | None) -> list[tuple]:
    conn = sqlite3.connect(PREDICTIONS_DB_PATH)
    try:
        rows = conn.execute(
            "SELECT ticker, base_date, score, source FROM rank_predictions "
            "WHERE model_version=? ORDER BY base_date, ticker",
            (version,),
        ).fetchall()
    except sqlite3.OperationalError:
        rows = []  # 尚未建表
    conn.close()
    return rows


def _backtest_ic_text(days_unit: str = "個交易日") -> str:
    """回測測試期 Rank IC 的引用字串，一律讀 artifacts_cs/summary.json——不在文字裡寫死數字，
    以免回測重跑後報告與 README 各說各話（曾發生：寫死的 +0.0442/134 天 vs 實際 +0.0437/128 天）。
    摘要有 Newey–West t 時以它為主、樸素 t 附註（重疊的未來報酬讓樸素 t 高估顯著性）。"""
    try:
        s = json.loads((ARTIFACTS_CS_DIR / "summary.json").read_text(encoding="utf-8"))
        days = s.get("test_rank_ic_days")
        tail = f"、{days} {days_unit}" if days else ""
        nw = s.get("test_rank_ic_t_nw")
        if nw is None:
            return f"{s['test_rank_ic']:+.4f}, t={s['test_rank_ic_t']:.1f}{tail}"
        return f"{s['test_rank_ic']:+.4f}, Newey–West t={nw:.2f}（未處理重疊為 {s['test_rank_ic_t']:.1f}）{tail}"
    except (OSError, KeyError, ValueError, TypeError):
        return "見 docs/cross_sectional_report.md"


def _indistinguishable_from_zero(ic: dict) -> bool:
    """線上 Rank IC 與 0 無法區分：Newey–West |t| < 2，或到期日少於 20 天（天數太少時 t 值也不可盡信）。"""
    t = ic["t_nw"]
    return ic["n_days"] < MIN_DAYS or np.isnan(t) or abs(t) < 2


def _ic_range_text(per_day: list[tuple]) -> str:
    """逐日 IC 的實際範圍（例如「-0.45~+0.53」），由報告的逐日表算出；沒有可算的日子時回空字串。"""
    ics = [ic for _d, _n, ic, _src in per_day if ic is not None]
    return f"{min(ics):+.2f}~{max(ics):+.2f}" if ics else ""


def _interpret(ic: dict) -> str:
    """依到期天數與顯著性給出誠實、隨資料自動調整的判讀句（不誇大、不粉飾）。t 用 Newey–West t。"""
    n, mean, t = ic["n_days"], ic["mean"], ic["t_nw"]
    if n == 0:
        return "尚無到期樣本，無法判讀。"
    if _indistinguishable_from_zero(ic):
        sign = "略正" if mean > 0 else "略負" if mean < 0 else "約零"
        return (
            f"樣本不足（{n} 個到期交易日、窗重疊），線上 Rank IC {sign}且**與 0 無法區分**"
            f"（Newey–West |t|={abs(t):.2f}<2），既不佐證也不反駁回測（{_backtest_ic_text()}），僅為起步累積。"
        )
    if mean > 0:
        return f"線上 Rank IC 為正且顯著（Newey–West t={t:.2f}），與回測方向一致，開始佐證選股技能。"
    return f"線上 Rank IC 為負且顯著（Newey–West t={t:.2f}），與回測相左，需檢視模型是否失效或市況反轉。"


def main() -> int:
    version = cs_production_version()
    rows = _load_rows(version)
    cache = ParquetCache(DATA_CACHE_DIR)

    dates, scores, rets, sources, pending = collect_matured(rows, cache)

    dts = np.array(dates)
    sc = np.array(scores, dtype=float)
    rt = np.array(rets, dtype=float)
    ic = (
        rank_ic(dts, sc, rt)
        if len(dts)
        else {"mean": float("nan"), "t": float("nan"), "t_nw": float("nan"), "n_days": 0, "by_year": {}}
    )
    spread = quantile_spread(dts, sc, rt, CS_TOP_FRACTION) if len(dts) else float("nan")

    # 逐日 IC（與 rank_ic 同一過濾條件：每日 ≥10 名、分數與報酬皆有變異）
    per_day = daily_ic(dates, scores, rets, sources)

    matured_dates = {str(d.date()) for d in dts}
    pend_dates = sorted({bd for (_t, bd, _s, _src) in rows} - matured_dates)
    n_live = sum(1 for (_t, _b, _s, src) in rows if src == "live")
    n_pit = len(rows) - n_live

    lines = [
        "# 線上相對強弱實證報告（線上 Rank IC）",
        "",
        f"產出日：{date.today().isoformat()}；資料來源：`backend/predictions.db` 的 "
        "`rank_predictions` 表（cross-sectional 分數，每日排程即時記錄＋歷史 point-in-time 重建）。",
        "",
        f"分數＝**P(基準日後 {LABEL_HORIZON_DAYS} 個交易日贏過當日全池中位數)**（相對強弱，"
        "非絕對漲跌）；逐日 Spearman(分數, 實際報酬)＝當日 Rank IC，平均與 t 值為選股技能指標。",
        "",
        f"**現行 CS production 模型：`{version}`**。判準：**Rank IC 0.02~0.05 可用、"
        "0.05~0.10 好、0.10 頂尖；t>2 統計顯著**。"
        f"t 一律用 Newey–West 標準誤（落後 {NW_LAGS} 期）：相鄰基準日的 {LABEL_HORIZON_DAYS} 日報酬重疊，"
        "逐日 IC 會自我相關，樸素 t 會高估顯著性。",
        "",
    ]

    interp = _interpret(ic)
    if ic["n_days"]:
        lines.append(
            f"## 總覽：已到期 {ic['n_days']} 個交易日、線上 Rank IC **{ic['mean']:+.4f}**"
            f"（Newey–West t={ic['t_nw']:.2f}）；待驗證 {len(pend_dates)} 個基準日（{pending} 筆）"
        )
    else:
        lines.append(
            f"## 總覽：尚無到期樣本（基準日後未滿 {LABEL_HORIZON_DAYS} 個交易日）；"
            f"待驗證 {len(pend_dates)} 個基準日（{pending} 筆）"
        )
    lines += [
        "",
        f"**判讀**：{interp}",
        "",
        f"樣本組成：live 記錄 {n_live} 筆、point-in-time 重建 {n_pit} 筆"
        f"（來源見下表；PIT 與 live 由同一固定權重產生、逐位元一致，僅記錄時點不同）。",
        "",
        "> **與絕對方向對照**：同批線上交易日的絕對方向命中率見 `docs/online_predictions.md`"
        "（該報告自帶最新數字）。兩條線上實證都在累積、都誠實揭露；相對排序**在原理上**不受多頭 beta "
        "影響（問「贏過中位數」而非「漲」），但**是否成立仍須線上樣本說話**，不能只憑原理宣稱。"
        f"目前的主要統計證據是回測 `docs/cross_sectional_report.md`（測試期 Rank IC {_backtest_ic_text()}）；"
        "本報告是把它放到真實線上時序去持續檢驗。",
        "",
    ]

    if per_day:
        lines += [
            "## 逐日 Rank IC（已到期）",
            "",
            "| 基準日 | 名數 | 當日 Rank IC | 來源 |",
            "|---|---|---|---|",
        ]
        for d, n, di, src in per_day:
            ic_str = f"{di:+.4f}" if di is not None else "—（名數不足）"
            lines.append(f"| {d.date()} | {n} | {ic_str} | {src} |")
        lines.append("")
        lines.append(
            f"前/後 {int(CS_TOP_FRACTION * 100)}% 多空價差（gross，每 {LABEL_HORIZON_DAYS} 日）："
            f"{spread:+.2%}。"
        )
        lines.append("")

    if pend_dates:
        lines += [
            "## 待驗證基準日（分數已記、5 個交易日未到期）",
            "",
            "、".join(pend_dates),
            "",
        ]

    ic_range = _ic_range_text(per_day)
    swing = f"，逐日 IC 落在 {ic_range}（見上表）" if ic_range else ""
    standing = (
        "此線上切片與 0 無法區分，**尚不構成佐證亦不構成反證**，僅為起步。"
        if _indistinguishable_from_zero(ic)
        else "Newey–West |t| 已達 2，但樣本仍小，結論需隨資料累積持續複核。"
    )
    lines += [
        "## 誠實警告（勿誇大）",
        "",
        "- **無前視**：分數僅用 ≤基準日資料（build_features 由 test_no_lookahead 把關）、"
        f"CS 權重固定訓練至樣本內；報酬為基準日後 {LABEL_HORIZON_DAYS} 日實際 close-to-close。",
        "- **PIT 重建 vs live**：早期基準日以 point-in-time 重建（與回測同法、非當下即時記錄），"
        "往後由每日排程 live 累積；兩者對固定權重逐位元一致，但 live 段才是嚴格意義的「線上」。",
        f"- **小樣本＋重疊窗**：目前僅 {ic['n_days']} 個到期交易日，且基準日集中於數週內、"
        f"各自 {LABEL_HORIZON_DAYS} 日 forward 報酬彼此重疊（非獨立）；t 已用 Newey–West 標準誤處理重疊，"
        f"但樣本小時仍不穩{swing}。{standing}",
        f"- 主要統計證據仍是回測（測試期 Rank IC {_backtest_ic_text('天')}）；本線上序列需累積"
        "數週、待 live 段變厚才有獨立說服力。多空價差為 gross、未計滑價借券，僅概念參考。",
        "",
        "> 由 `python -m stockta.ml.report_rank_predictions` 產生；每日排程後自動重跑累積。"
        "與 `docs/online_predictions.md`（絕對方向）並列——兩條線上實證都誠實累積中。",
    ]

    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    out = DOCS_DIR / "online_rank_ic.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(
        f"現行 CS {version}：已到期 {ic['n_days']} 交易日、線上 Rank IC {ic['mean']:+.4f}"
        f"（Newey–West t={ic['t_nw']:.2f}）；待驗證 {len(pend_dates)} 基準日；報告已寫入 {out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
