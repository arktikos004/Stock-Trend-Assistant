"""簡單因子對照與可成交性（docs/baseline_prereg.md）：定義、無前視、中和、判讀與彙總。"""

import math
from datetime import date, timedelta

import numpy as np
import pytest

from stockta import baselines as b
from stockta.baselines import DayPanel, Obs

START = date(2026, 8, 3)


def _closes(n: int = 80) -> np.ndarray:
    return np.array([100.0 + i for i in range(n)])


def test_factor_values_follow_the_declared_definitions():
    c = _closes()
    f = b.factor_values(c, 70)
    assert f["reversal_5d"] == pytest.approx(-(c[70] / c[65] - 1))
    assert f["momentum_20d"] == pytest.approx(c[70] / c[50] - 1)
    assert f["momentum_60d"] == pytest.approx(c[70] / c[10] - 1)


def test_factor_values_need_sixty_prior_closes_and_valid_prices():
    c = _closes()
    assert b.factor_values(c, 59) is None
    assert b.factor_values(c, 60) is not None
    gap = c.copy()
    gap[10] = np.nan  # 60 日前的收盤缺值
    assert b.factor_values(gap, 70) is None


@pytest.mark.leakage
def test_factor_values_ignore_prices_after_the_base_date():
    c = _closes()
    later = c.copy()
    later[71:] *= 3
    assert b.factor_values(c, 70) == b.factor_values(later, 70)


def test_forward_return_from_the_close_and_from_the_next_close():
    c = _closes(20)
    assert b.forward_return(c, 10) == pytest.approx(c[15] / c[10] - 1)
    assert b.forward_return(c, 10, start=b.NEXT_CLOSE) == pytest.approx(c[16] / c[11] - 1)
    assert b.forward_return(c, 14) is not None
    assert b.forward_return(c, 14, start=b.NEXT_CLOSE) is None  # 要到 t+6 收盤才到期


def test_rank_score_maps_ranks_to_minus_one_to_one_with_average_ties():
    assert b.rank_score([3, 1, 2]).tolist() == [1.0, -1.0, 0.0]
    assert b.rank_score([1, 2, 2, 3]).tolist() == pytest.approx([-1.0, 0.0, 0.0, 1.0])


def test_neutralize_drops_a_score_the_factors_explain_completely():
    rng = np.random.default_rng(1)
    f = rng.normal(size=30)
    assert b.neutralize(2 * f + 1, [f, rng.normal(size=30), rng.normal(size=30)]) is None


def test_neutralize_keeps_what_the_factors_cannot_explain():
    rng = np.random.default_rng(2)
    f1, f2, f3, z = (rng.normal(size=40) for _ in range(4))
    resid = b.neutralize(f1 + 2 * z, [f1, f2, f3])
    assert resid is not None
    assert b.spearman(resid, z) > 0.5


def test_spearman_needs_ten_names_and_variation():
    assert b.spearman(range(9), range(9)) is None
    assert b.spearman([1.0] * 12, range(12)) is None
    assert b.spearman(range(12), range(12)) == pytest.approx(1.0)


def _world(days: int, names: int, seed: int, score_of) -> list[DayPanel]:
    """合成的逐日截面：報酬＝獨立訊號 z 的一半＋0.3 倍 20 日動量＋雜訊；分數由 score_of(z, 因子) 決定。"""
    rng = np.random.default_rng(seed)
    panels = []
    for d in range(days):
        obs = []
        for i in range(names):
            f = {key: float(rng.normal()) for key, *_ in b.FACTORS}
            z = float(rng.normal())
            ret = 0.5 * z + 0.3 * f["momentum_20d"] + float(rng.normal())
            obs.append(Obs(f"{1100 + i}.TW", score_of(z, f, rng), f, ret, ret))
        panels.append(DayPanel(day=START + timedelta(days=d), live=True, obs=tuple(obs)))
    return panels


def test_a_score_with_its_own_information_is_beyond_the_factors():
    out = b.factor_comparison(_world(30, 40, seed=3, score_of=lambda z, f, _rng: z + f["momentum_20d"]))
    assert out["n_days"] == 30
    assert out["neutral"]["verdict"] == "beyond"
    by_key = {x["key"]: x for x in out["factors"]}
    assert by_key["momentum_20d"]["ic"]["mean"] > 0
    assert by_key["momentum_20d"]["corr_mean"] > by_key["reversal_5d"]["corr_mean"]


def test_a_pure_momentum_score_leaves_nothing_to_judge():
    out = b.factor_comparison(_world(30, 40, seed=4, score_of=lambda _z, f, _rng: f["momentum_20d"]))
    assert out["n_days"] == 30
    assert out["neutral"]["n_days"] == 0  # 殘差全為 0，每一天都不計
    assert out["neutral"]["verdict"] == "insufficient"


def test_momentum_plus_noise_is_indistinct():
    out = b.factor_comparison(_world(30, 40, seed=5, score_of=lambda _z, f, rng: f["momentum_20d"] + 0.3 * float(rng.normal())))
    assert out["neutral"]["n_days"] == 30
    assert out["neutral"]["verdict"] == "indistinct"


def test_neutral_verdict_needs_twenty_days():
    out = b.factor_comparison(_world(19, 40, seed=3, score_of=lambda z, f, _rng: z + f["momentum_20d"]))
    assert out["neutral"]["verdict"] == "insufficient"


def test_days_with_too_few_complete_names_are_skipped():
    panels = _world(3, 12, seed=6, score_of=lambda z, _f, _rng: z)
    thin = DayPanel(day=panels[0].day, live=True, obs=tuple(Obs(o.ticker, o.score, None, o.ret, o.ret_next) for o in panels[0].obs))
    assert b.factor_comparison([thin, *panels[1:]])["n_days"] == 2


def test_tradable_ic_splits_all_and_live_days():
    panels = _world(4, 12, seed=7, score_of=lambda z, _f, _rng: z)
    panels[0] = DayPanel(day=panels[0].day, live=False, obs=panels[0].obs)
    unmatured = DayPanel(day=START + timedelta(days=10), live=True, obs=tuple(Obs(o.ticker, o.score, o.factors, o.ret, None) for o in panels[1].obs))
    out = b.tradable_ic([*panels, unmatured])
    assert out["all"]["n_days"] == 4
    assert out["live"]["n_days"] == 3


def test_days_needed_matches_the_declared_formula():
    out = b.days_needed(55, 0.0344, 0.0437)
    needed = math.ceil(55 * (2 * 0.0344 / 0.0437) ** 2)
    assert out["status"] == "ok"
    assert out["needed"] == needed
    assert out["remaining"] == needed - 55
    assert b.days_needed(500, 0.01, 0.04)["remaining"] == 0


def test_days_needed_refuses_short_or_unusable_inputs():
    assert b.days_needed(19, 0.03, 0.04)["status"] == "insufficient"
    assert b.days_needed(30, 0.03, 0.0)["status"] == "insufficient"
    assert b.days_needed(30, None, 0.04)["status"] == "insufficient"
    assert b.days_needed(30, 0.03, None)["status"] == "insufficient"


def _day(day: date, live: bool, rets_next: list[float | None]) -> DayPanel:
    """分數由高到低依序排列：第 i 檔的分數是 len − i。"""
    n = len(rets_next)
    return DayPanel(day=day, live=live, obs=tuple(Obs(f"{2000 + i}.TW", float(n - i), None, 0.0, r) for i, r in enumerate(rets_next)))


def test_quintile_returns_use_live_days_and_the_declared_cut_points():
    rets = [0.10, 0.08, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -0.02, -0.04]  # 10 檔：名次 1–2 是第 1 分位、9–10 是第 5 分位
    out = b.quintile_returns([_day(START, True, rets), _day(START + timedelta(days=1), False, [1.0] * 10)])
    assert out["n_days"] == 1
    assert out["top_mean"] == pytest.approx(0.09)
    assert out["bottom_mean"] == pytest.approx(-0.03)
    assert out["pool_mean"] == pytest.approx(sum(rets) / 10)
    assert out["spread_mean"] == pytest.approx(0.12)
    assert out["spread_t"] is None  # 少於 2 天不算 t


def test_quintile_returns_skip_thin_or_unmatured_days():
    nine = _day(START, True, [0.01] * 9)
    unmatured = _day(START + timedelta(days=1), True, [None] * 10)
    assert b.quintile_returns([nine, unmatured])["n_days"] == 0


def test_a_failing_section_does_not_block_the_others(monkeypatch):
    from stockta.api.routers import monitor as router

    empty = router._RankData(version="v", id_rows=[], rows=[], cache=None, sessions=[], on_time={}, per_day=[], pending=0)
    monkeypatch.setattr(router, "_rank_data", lambda: empty)

    def broken(_panels):
        raise RuntimeError("壞掉的區塊")

    monkeypatch.setattr(router.baselines, "quintile_returns", broken)
    out = router.get_baselines()
    assert out.quintiles is None
    assert out.failures == ["quintiles: RuntimeError"]
    assert out.factors is not None and out.tradable is not None and out.days_needed is not None
