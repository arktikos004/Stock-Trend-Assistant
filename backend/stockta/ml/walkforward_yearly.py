"""逐年樣本外驗證：規則見 docs/walkforward_prereg.md（v1）。

    python -m stockta.ml.walkforward_yearly prepare  --universe U1
    python -m stockta.ml.walkforward_yearly validate --universe U1 --variant V0
    python -m stockta.ml.walkforward_yearly select   --universe U1 --variant V0
    python -m stockta.ml.walkforward_yearly test     --universe U1 --variant V0
    python -m stockta.ml.walkforward_yearly report

- prepare：用本機快取（不下載）建資料集、各列的基準分數與重現用的紀錄。
- validate：每一折、每組超參數、每個種子訓練一次，只讀驗證年；模型存進快取，測試期不再訓練。
- select：依驗證年選出的超參數寫進 docs/walkforward_yearly.json。這份選擇 commit 之後，test 才會執行。
- test：每一折的測試年只讀一次；已讀過的不重跑，除非給 --rerun-reason（會記進結果）。
- report：把結果寫成 docs/walkforward_yearly.md 與 .json，只有統計量，不含價格、逐檔報酬與逐日分數。

中間結果放在 git 忽略的 backend/wf_cache/。
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import subprocess
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from stockta.config import BACKEND_ROOT, MARKET_INDEX_TICKER, STOCK_POOL
from stockta.data.manifest import content_sha
from stockta.data.pool import load_market, load_pool, print_skip
from stockta.data.provider import CacheOnlyProvider
from stockta.features.market import build_market_context
from stockta.ml.cross_sectional import build_cs_dataset, fit_cs, split_masks
from stockta.ml.cs_metrics import daily_rank_ic, rank_ic
from stockta.ml.wf_metrics import ic_diff_test, nw_t, rebalance_returns, sharpe

REPO_ROOT = BACKEND_ROOT.parent
CACHE_DIR = BACKEND_ROOT / "wf_cache"
RESULTS_JSON = REPO_ROOT / "docs" / "walkforward_yearly.json"
RESULTS_MD = REPO_ROOT / "docs" / "walkforward_yearly.md"
PREREG = REPO_ROOT / "docs" / "walkforward_prereg.md"
LISTING_PATH = BACKEND_ROOT / "data" / "universe" / "listing_dates.csv"

HISTORY_START = date(2004, 1, 1)
DATA_END = date(2026, 1, 31)  # 2025 年底的基準日要用到次年初的收盤當標籤
FIRST_TEST_YEAR, LAST_TEST_YEAR = 2010, 2025
GRID = ((3, 0.05), (3, 0.1), (5, 0.05), (5, 0.1))  # (深度, 學習率)
N_ESTIMATORS = 300
SEEDS = (42, 43, 44, 45, 46)
STRIDE = 2
N_JOBS = 16  # 固定執行緒數，記在結果裡
VARIANTS = ("V0", "V1", "V2", "V3")
UNIVERSES = ("U1", "U2")
BASELINES = ("momentum_20d", "reversal_5d")


@dataclass(frozen=True)
class Fold:
    test_year: int
    train_end: date
    val_end: date
    test_end: date


def yearly_folds(first: int = FIRST_TEST_YEAR, last: int = LAST_TEST_YEAR) -> list[Fold]:
    """測試年 Y：訓練到 Y−2 年底、驗證 Y−1 整年、測試 Y 整年。"""
    return [Fold(y, date(y - 2, 12, 31), date(y - 1, 12, 31), date(y, 12, 31)) for y in range(first, last + 1)]


def fold_masks(dates: np.ndarray, label_end: np.ndarray, fold: Fold, start: date = HISTORY_START):
    return split_masks(dates, label_end, fold.train_end, fold.val_end, train_start=start, test_end=fold.test_end, purge=True)


@dataclass
class WFData:
    """一個股票池、一個變體的資料集：特徵、標籤、5 日報酬與各列的基準分數。"""

    X: np.ndarray
    y: np.ndarray
    dates: np.ndarray
    tickers: np.ndarray
    ret_label: np.ndarray
    label_end: np.ndarray
    baselines: dict[str, np.ndarray] = field(default_factory=dict)


@dataclass(frozen=True)
class WFConfig:
    folds: tuple[Fold, ...]
    grid: tuple[tuple[int, float], ...] = GRID
    seeds: tuple[int, ...] = SEEDS
    n_estimators: int = N_ESTIMATORS
    stride: int = STRIDE
    n_jobs: int = N_JOBS
    start: date = HISTORY_START


def _params(config: WFConfig, depth: int, lr: float, seed: int) -> dict:
    return {"max_depth": depth, "learning_rate": lr, "n_estimators": config.n_estimators, "random_state": seed, "n_jobs": config.n_jobs}


def _model_path(cache: Path, fold: Fold, depth: int, lr: float, seed: int) -> Path:
    return cache / "models" / str(fold.test_year) / f"d{depth}_lr{lr}_s{seed}"


def _daily(dates: np.ndarray, scores: np.ndarray, rets: np.ndarray) -> dict[str, float]:
    return {pd.Timestamp(d).date().isoformat(): float(v) for d, v in daily_rank_ic(dates, scores, rets).items()}


# ── 驗證期 ───────────────────────────────────────────────────────────


def validate(data: WFData, config: WFConfig, cache: Path) -> dict:
    """每一折、每組超參數、每個種子訓練一次，只對驗證年評分；模型與標準化參數存進 cache。"""
    from xgboost import XGBClassifier  # noqa: F401  確認裝得起來，再開始長時間的迴圈

    out: dict = {"folds": {}}
    for fold in config.folds:
        train, val, _test = fold_masks(data.dates, data.label_end, fold, config.start)
        entries = []
        for depth, lr in config.grid:
            averaged = np.zeros(int(val.sum()))
            per_seed = []
            for seed in config.seeds:
                model, scaler, rows = fit_cs(data.X, data.y, train, params=_params(config, depth, lr, seed))
                path = _model_path(cache, fold, depth, lr, seed)
                path.parent.mkdir(parents=True, exist_ok=True)
                model.save_model(str(path.with_suffix(".ubj")))
                np.savez(path.with_suffix(".npz"), mean=scaler.mean_, scale=scaler.scale_, n_train=len(rows))
                probs = model.predict_proba(scaler.transform(data.X[val]).astype(np.float32))[:, 1]
                per_seed.append(rank_ic(data.dates[val], probs, data.ret_label[val])["mean"])
                averaged += probs / len(config.seeds)
            ic = rank_ic(data.dates[val], averaged, data.ret_label[val])
            entries.append(
                {
                    "depth": depth,
                    "learning_rate": lr,
                    "val_mean_ic": ic["mean"],
                    "val_days": ic["n_days"],
                    "seed_ic_mean": float(np.mean(per_seed)),
                    "seed_ic_sd": float(np.std(per_seed, ddof=1)) if len(per_seed) > 1 else None,
                    "val_daily_ic": _daily(data.dates[val], averaged, data.ret_label[val]),
                }
            )
        best = min(entries, key=lambda e: (-e["val_mean_ic"], e["depth"], e["learning_rate"]))
        out["folds"][str(fold.test_year)] = {"entries": entries, "selected": {"depth": best["depth"], "learning_rate": best["learning_rate"]}}
    return out


# ── 選擇 ─────────────────────────────────────────────────────────────


def pooled_val_ic(validation: dict, upto: int | None = None) -> float | None:
    """各折選出的超參數在驗證年的逐日 IC，全部合起來取平均（upto＝只用測試年 ≤ upto 的折）。"""
    days: list[float] = []
    for year, fold in validation["folds"].items():
        if upto is not None and int(year) > upto:
            continue
        chosen = fold["selected"]
        entry = next(e for e in fold["entries"] if (e["depth"], e["learning_rate"]) == (chosen["depth"], chosen["learning_rate"]))
        days.extend(entry["val_daily_ic"].values())
    return float(np.mean(days)) if days else None


def select_variant(validations: dict[str, dict], years: list[int]) -> dict:
    """全域選擇（全部驗證年）與逐年選擇（第 Y 年只看 Y−1 以前的驗證年）。同分取較簡單的變體。"""

    def best(upto: int | None) -> str:
        scored = [(v, pooled_val_ic(validations[v], upto)) for v in VARIANTS if v in validations]
        scored = [(v, s) for v, s in scored if s is not None]
        return min(scored, key=lambda vs: (-vs[1], VARIANTS.index(vs[0])))[0]

    return {"global": best(None), "sequential": {str(y): best(y) for y in years}}


# ── 測試期 ───────────────────────────────────────────────────────────


def _load_model(cache: Path, fold: Fold, depth: int, lr: float, seed: int):
    from sklearn.preprocessing import StandardScaler
    from xgboost import XGBClassifier

    path = _model_path(cache, fold, depth, lr, seed)
    model = XGBClassifier()
    model.load_model(str(path.with_suffix(".ubj")))
    saved = np.load(path.with_suffix(".npz"))
    scaler = StandardScaler()
    scaler.mean_, scaler.scale_ = saved["mean"], saved["scale"]
    scaler.var_ = scaler.scale_**2
    scaler.n_features_in_ = len(scaler.mean_)
    return model, scaler


def score_test_years(data: WFData, config: WFConfig, cache: Path, selected: dict) -> dict[int, tuple[np.ndarray, np.ndarray]]:
    """每一折用驗證期選出的超參數、5 個種子的平均，對測試年評分。回傳 {測試年: (列遮罩, 分數)}。"""
    out = {}
    for fold in config.folds:
        _train, _val, test = fold_masks(data.dates, data.label_end, fold, config.start)
        chosen = selected[str(fold.test_year)]
        scores = np.zeros(int(test.sum()))
        for seed in config.seeds:
            model, scaler = _load_model(cache, fold, chosen["depth"], chosen["learning_rate"], seed)
            scores += model.predict_proba(scaler.transform(data.X[test]).astype(np.float32))[:, 1] / len(config.seeds)
        out[fold.test_year] = (test, scores)
    return out


def evaluate(data: WFData, scored: dict[int, tuple[np.ndarray, np.ndarray]]) -> dict:
    """逐年與合計的 Rank IC（Newey–West t）、多空與只做多、和基準的 Diebold–Mariano；只有統計量。"""
    per_year, all_model, all_base = {}, [], {b: [] for b in data.baselines}
    periods = []
    for year, (mask, scores) in sorted(scored.items()):
        common = np.ones(int(mask.sum()), dtype=bool)
        for b in data.baselines.values():
            common &= np.isfinite(b[mask])
        d, r, s = data.dates[mask][common], data.ret_label[mask][common], scores[common]
        model_ic = daily_rank_ic(d, s, r)
        base_ic = {name: daily_rank_ic(d, b[mask][common], r) for name, b in data.baselines.items()}
        ls = rebalance_returns(d, data.tickers[mask][common], s, r)
        per_year[str(year)] = {
            "rank_ic": nw_t(model_ic.to_numpy()),
            "ls_sharpe": sharpe(ls["ls_net"]) if len(ls) else None,
            "lo_net_mean": float(ls["lo_net"].mean()) if len(ls) else None,
            "pool_mean": float(ls["pool"].mean()) if len(ls) else None,
            "vs_baselines": {name: ic_diff_test(model_ic, ic) for name, ic in base_ic.items()},
        }
        all_model.append(model_ic)
        for name, ic in base_ic.items():
            all_base[name].append(ic)
        periods.append(ls)
    model_ic = pd.concat(all_model) if all_model else pd.Series(dtype=float)
    ls_all = pd.concat(periods) if periods else pd.DataFrame()
    pooled = {
        "rank_ic": nw_t(model_ic.to_numpy()),
        "ls_sharpe": sharpe(ls_all["ls_net"]) if len(ls_all) else None,
        "lo_net_mean": float(ls_all["lo_net"].mean()) if len(ls_all) else None,
        "pool_mean": float(ls_all["pool"].mean()) if len(ls_all) else None,
        "vs_baselines": {name: ic_diff_test(model_ic, pd.concat(ics)) for name, ics in all_base.items() if ics},
        "baseline_rank_ic": {name: nw_t(pd.concat(ics).to_numpy()) for name, ics in all_base.items() if ics},
    }
    return {"per_year": per_year, "pooled": pooled}


# ── 結果檔 ───────────────────────────────────────────────────────────


def _read_results(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _write_results(path: Path, results: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(results, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")


def record_selection(path: Path, universe: str, variant: str, validation: dict, provenance: dict) -> dict:
    results = _read_results(path)
    block = results.setdefault("selection", {}).setdefault(universe, {})
    block[variant] = {
        "folds": {year: fold["selected"] for year, fold in validation["folds"].items()},
        "pooled_val_ic": pooled_val_ic(validation),
        "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        **provenance,
    }
    _write_results(path, results)
    return results


def selection_is_committed(path: Path) -> bool:
    """結果檔已在 git 追蹤中，而且工作目錄裡沒有未 commit 的修改。"""
    tracked = subprocess.run(["git", "-C", str(path.parent), "ls-files", "--error-unmatch", path.name], capture_output=True)
    if tracked.returncode != 0:
        return False
    return subprocess.run(["git", "-C", str(path.parent), "diff", "--quiet", "HEAD", "--", path.name]).returncode == 0


def run_test(
    data: WFData,
    config: WFConfig,
    cache: Path,
    path: Path,
    universe: str,
    variant: str,
    *,
    require_committed: bool = True,
    rerun_reason: str | None = None,
    is_committed: Callable[[Path], bool] = selection_is_committed,
) -> dict:
    results = _read_results(path)
    selected = results.get("selection", {}).get(universe, {}).get(variant)
    if selected is None:
        raise SystemExit(f"{path.name} 沒有 {universe}/{variant} 的選擇紀錄：先跑 select，commit 之後才讀測試年")
    if require_committed and not is_committed(path):
        raise SystemExit(f"{path.name} 的選擇紀錄還沒 commit：先 commit（最好也推上去），測試年才會讀")
    tests = results.setdefault("tests", {}).setdefault(universe, {})
    if variant in tests and not rerun_reason:
        raise SystemExit(f"{universe}/{variant} 的測試年已經讀過；真的要重跑請給 --rerun-reason")
    scored = score_test_years(data, config, cache, selected["folds"])
    tests[variant] = {
        **evaluate(data, scored),
        "read_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "rerun_reason": rerun_reason,
        "previous_reads": tests.get(variant, {}).get("previous_reads", 0) + (1 if variant in tests else 0),
    }
    _write_results(path, results)
    return results


# ── 真實資料 ─────────────────────────────────────────────────────────


def load_listing_dates(path: Path = LISTING_PATH) -> dict[str, date]:
    with open(path, encoding="utf-8-sig", newline="") as handle:
        return {row["ticker"]: date.fromisoformat(row["listed"]) for row in csv.DictReader(handle)}


def baseline_scores(pool: dict[str, pd.DataFrame], dates: np.ndarray, tickers: np.ndarray) -> dict[str, np.ndarray]:
    """20 日動量與 5 日反轉（定義同 docs/baseline_prereg.md 第 2.1 節），對到資料集的每一列。"""
    out = {}
    for name, lookback, sign in (("momentum_20d", 20, 1), ("reversal_5d", 5, -1)):
        values = np.full(len(dates), np.nan)
        for ticker, frame in pool.items():
            close = frame["close"].astype("float64")
            factor = sign * (close / close.shift(lookback) - 1)
            rows = np.where(tickers == ticker)[0]
            values[rows] = factor.reindex(pd.DatetimeIndex(dates[rows])).to_numpy()
        out[name] = values
    return out


def _git(*args: str) -> str:
    return subprocess.run(["git", "-C", str(REPO_ROOT), *args], capture_output=True, text=True).stdout.strip()


def provenance(pool: dict[str, pd.DataFrame], market: pd.DataFrame) -> dict:
    """重現用的紀錄：價格內容雜湊（不含價格本身）、套件版本、程式與預先聲明的版本、運算設定。"""
    from importlib.metadata import version

    prices = {t: content_sha(df) for t, df in sorted(pool.items())}
    prices[MARKET_INDEX_TICKER] = content_sha(market)
    return {
        "price_sha256": prices,
        "prices_digest": hashlib.sha256(json.dumps(prices, sort_keys=True).encode("utf-8")).hexdigest(),
        "listing_dates_sha256": hashlib.sha256(LISTING_PATH.read_bytes()).hexdigest(),
        "code_commit": _git("rev-parse", "HEAD"),
        "prereg_blob": _git("rev-parse", "HEAD:docs/walkforward_prereg.md"),
        "packages": {p: version(p) for p in ("numpy", "pandas", "scipy", "scikit-learn", "xgboost")},
        "device": "cpu",
        "n_jobs": N_JOBS,
    }


def prepare(universe: str, variant: str = "V0") -> tuple[WFData, dict]:
    if universe != "U1":
        raise SystemExit("U2 需要從 2004 年起的成分股事件表，補齊並通過 validate() 之後才能跑")
    if variant != "V0":
        raise SystemExit(f"{variant} 的特徵還沒實作")
    provider = CacheOnlyProvider()
    raw = load_pool(provider, HISTORY_START, DATA_END, tickers=list(STOCK_POOL), on_skip=print_skip)
    market = load_market(provider, HISTORY_START, DATA_END)
    # 上市日閘門一次套在價格上：特徵、大盤寬度與基準分數都不會用到換股上市前接上來的歷史
    listing = load_listing_dates()
    pool = {t: df.loc[df.index >= pd.Timestamp(listing[t])] if t in listing else df for t, df in raw.items()}
    context = build_market_context(market, pool)
    ds = build_cs_dataset(pool, context)
    keep = pd.DatetimeIndex(ds.dates) <= pd.Timestamp(date(LAST_TEST_YEAR, 12, 31))
    data = WFData(
        ds.X[keep], ds.y[keep], ds.dates[keep], ds.tickers[keep], ds.ret_label[keep], ds.label_end[keep],
        baselines={k: v[keep] for k, v in baseline_scores(pool, ds.dates, ds.tickers).items()},
    )
    return data, provenance(raw, market)


def _dataset_path(universe: str, variant: str) -> Path:
    return CACHE_DIR / f"{universe}_{variant}.npz"


def _save_dataset(data: WFData, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(path, X=data.X, y=data.y, dates=data.dates, tickers=data.tickers, ret_label=data.ret_label, label_end=data.label_end,
             **{f"base_{k}": v for k, v in data.baselines.items()})


def _load_dataset(path: Path) -> WFData:
    if not path.exists():
        raise SystemExit(f"找不到 {path}，先跑 prepare")
    z = np.load(path, allow_pickle=False)
    return WFData(z["X"], z["y"], z["dates"], z["tickers"], z["ret_label"], z["label_end"],
                  baselines={k[5:]: z[k] for k in z.files if k.startswith("base_")})


def write_report(results: dict, path: Path = RESULTS_MD) -> None:
    """結果檔的可讀版本：逐年與合計的 Rank IC、多空 Sharpe 與和基準的比較。"""
    lines = ["# 逐年樣本外驗證結果", "", "規則見 `docs/walkforward_prereg.md`；機器可讀的完整結果在 `docs/walkforward_yearly.json`。", ""]
    for universe, variants in sorted(results.get("tests", {}).items()):
        for variant, res in sorted(variants.items()):
            lines += [f"## {universe} · {variant}", "", "| 年 | Rank IC | Newey–West t | 天數 | 多空 Sharpe（年化、扣成本） |", "| --- | --- | --- | --- | --- |"]
            for year, r in sorted(res["per_year"].items()):
                ic, ls = r["rank_ic"], r["ls_sharpe"] or {}
                lines.append(
                    f"| {year} | {ic['mean']:+.4f} | {ic['t']:.2f} | {ic['n']} | {ls.get('annualized') or float('nan'):+.2f} |"
                    if ic["mean"] is not None and ic["t"] is not None else f"| {year} | — | — | {ic['n']} | — |"
                )
            pooled = res["pooled"]["rank_ic"]
            lines += ["", f"2010–2025 合計：Rank IC {pooled['mean']:+.4f}，Newey–West t {pooled['t']:.2f}（{pooled['n']} 天）。", ""]
    path.write_text("\n".join(lines), encoding="utf-8", newline="\n")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="逐年樣本外驗證（docs/walkforward_prereg.md）")
    parser.add_argument("phase", choices=("prepare", "validate", "select", "test", "report"))
    parser.add_argument("--universe", choices=UNIVERSES, default="U1")
    parser.add_argument("--variant", choices=VARIANTS, default="V0")
    parser.add_argument("--rerun-reason", help="測試年已讀過還要重跑時，寫明原因（會記進結果）")
    parser.add_argument("--folds", type=int, nargs=2, metavar=("FIRST", "LAST"), help="只跑這幾折（量時間用，不寫選擇與結果）")
    args = parser.parse_args(argv)

    years = tuple(args.folds) if args.folds else (FIRST_TEST_YEAR, LAST_TEST_YEAR)
    config = WFConfig(folds=tuple(yearly_folds(*years)))
    cache = CACHE_DIR / args.universe / args.variant
    if args.phase == "prepare":
        data, prov = prepare(args.universe, args.variant)
        _save_dataset(data, _dataset_path(args.universe, args.variant))
        (cache / "provenance.json").parent.mkdir(parents=True, exist_ok=True)
        (cache / "provenance.json").write_text(json.dumps(prov, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
        print(f"資料集 {len(data.y):,} 列 × {data.X.shape[1]:,} 欄，{pd.Timestamp(data.dates.min()).date()}～{pd.Timestamp(data.dates.max()).date()}")
        return
    if args.phase == "report":
        write_report(_read_results(RESULTS_JSON))
        print(f"已寫入 {RESULTS_MD}")
        return

    data = _load_dataset(_dataset_path(args.universe, args.variant))
    if args.phase == "validate":
        validation = validate(data, config, cache)
        target = cache / ("validation.json" if not args.folds else f"validation_{years[0]}_{years[1]}.json")
        target.write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
        for year, fold in validation["folds"].items():
            print(year, fold["selected"])
        return
    if args.folds:
        raise SystemExit("--folds 只用在 validate（量時間）")
    validation = json.loads((cache / "validation.json").read_text(encoding="utf-8"))
    if args.phase == "select":
        prov = json.loads((cache / "provenance.json").read_text(encoding="utf-8"))
        record_selection(RESULTS_JSON, args.universe, args.variant, validation, prov)
        print(f"選擇已寫入 {RESULTS_JSON}：commit（最好也推上去）之後才跑 test")
        return
    run_test(data, config, cache, RESULTS_JSON, args.universe, args.variant, rerun_reason=args.rerun_reason)
    print(f"測試年已讀；結果在 {RESULTS_JSON}。記得在 docs/test_set_ledger.md 記一筆")


if __name__ == "__main__":
    main()
