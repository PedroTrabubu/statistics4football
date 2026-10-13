"""Duelo de córners: v1 frente a candidatos (protocolo: docs/DUELO_CORNERES_V2_PROTOCOLO.md).

Uso (desde backend/, con el venv activado):
    python scripts/experiments_corner_duel.py select   # ajuste 22/23-23/24, selección en 24/25
    python scripts/experiments_corner_duel.py test A   # comparación final con el candidato elegido (una vez)

Cada partido solo ve partidos anteriores de su liga, de su temporada y la anterior.
"""

import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.analysis.stats import bootstrap_mean_diff  # noqa: E402
from app.db.models import League, Match, MatchStatus, Season, TeamMatchStats  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.picks.count_model import fit_count_model  # noqa: E402

CAP = 14
DECAY = 0.0018
K = 5
MAX = 40
LEAGUES = ("ENG-Premier League", "ESP-La Liga", "ESP-La Liga 2", "FRA-Ligue 1")
FIT, SELECT, TEST = ("2223", "2324"), ("2425",), ("2526", "2627")


def previous(season: str) -> str:
    a = int(season[:2]) - 1
    return f"{a:02d}{a + 1:02d}"


def load():
    db = SessionLocal()
    stats = {(s.match_id, s.team_id): s for s in db.query(TeamMatchStats)}
    rows = []
    for m, code, season in (
        db.query(Match, League.code, Season.name)
        .join(League, League.id == Match.league_id)
        .join(Season, Season.id == Match.season_id)
        .filter(Match.status == MatchStatus.HISTORICAL, League.code.in_(LEAGUES))
    ):
        h, a = stats.get((m.id, m.home_team_id)), stats.get((m.id, m.away_team_id))
        if not (h and a) or None in (h.corners_for, a.corners_for, h.shots, a.shots):
            continue
        rows.append((code, season, m.date.timestamp() / 86400, m.id, m.home_team_id, m.away_team_id,
                     h.corners_for, a.corners_for, h.shots, a.shots))  # fmt: skip
    db.close()
    return rows


def nb_pmf(mean: float, alpha: float) -> np.ndarray:
    k = np.arange(MAX + 1)
    if alpha < 1e-6:
        logp = k * math.log(mean) - mean - np.array([math.lgamma(i + 1) for i in k])
    else:
        r = 1 / alpha
        logp = (np.array([math.lgamma(i + r) - math.lgamma(r) - math.lgamma(i + 1) for i in k])
                + r * math.log(r / (r + mean)) + k * math.log(mean / (r + mean)))  # fmt: skip
    p = np.exp(logp)
    return p / p.sum()


def duel(ph: np.ndarray, pa: np.ndarray) -> tuple[float, float, float]:
    cdf_a = np.concatenate([[0.0], np.cumsum(pa)[:-1]])
    home = float((ph * cdf_a).sum())
    draw = float((ph * pa).sum())
    return home, draw, 1 - home - draw


def features(prior: np.ndarray, t: float, h: int, a: int) -> dict | None:
    """prior: columnas [dia, local, visitante, córners L, córners V, tiros L, tiros V]."""
    if len(prior) == 0:
        return None
    w = np.exp(-DECAY * (t - prior[:, 0]))
    hc, ac = np.minimum(prior[:, 3], CAP), np.minimum(prior[:, 4], CAP)
    hs, as_ = prior[:, 5], prior[:, 6]
    W = w.sum()
    lh, la = (w * hc).sum() / W, (w * ac).sum() / W
    sh, sa = (w * hs).sum() / W, (w * as_).sum() / W
    var = (w * ((hc - lh) ** 2 + (ac - la) ** 2)).sum() / (2 * W)
    mb = (lh + la) / 2
    alpha = max(0.0, (var - mb) / mb**2)

    def shrink(mask, values, target, k=K):
        return ((w[mask] * values[mask]).sum() + k * target) / (w[mask].sum() + k)

    h_home, a_away = prior[:, 1] == h, prior[:, 2] == a
    h_away, a_home = prior[:, 2] == h, prior[:, 1] == a
    f = {"lh": lh, "la": la, "sh": sh, "sa": sa, "alpha": alpha}
    # v1: en el campo del partido, encogido hacia la liga.
    f["hf"], f["ha"] = shrink(h_home, hc, lh), shrink(h_home, ac, la)
    f["af"], f["aa"] = shrink(a_away, ac, la), shrink(a_away, hc, lh)
    # Todos los campos, en "equivalente" del campo del partido (corregido con la liga).
    rh, ra = lh / la, la / lh
    h_all = h_home | h_away
    a_all = a_home | a_away
    h_for = np.where(h_home, hc, ac * rh)  # lo que saca, como si jugara en casa
    h_ag = np.where(h_home, ac, hc * ra)  # lo que concede en casa
    a_for = np.where(a_away, ac, hc * ra)  # lo que saca, como si jugara fuera
    a_ag = np.where(a_away, hc, ac * rh)  # lo que concede fuera
    f["hf_all"], f["ha_all"] = shrink(h_all, h_for, lh), shrink(h_all, h_ag, la)
    f["af_all"], f["aa_all"] = shrink(a_all, a_for, la), shrink(a_all, a_ag, lh)
    # A: el del campo encogido hacia el de todos los campos.
    f["hf_A"], f["ha_A"] = shrink(h_home, hc, f["hf_all"]), shrink(h_home, ac, f["ha_all"])
    f["af_A"], f["aa_A"] = shrink(a_away, ac, f["af_all"]), shrink(a_away, hc, f["aa_all"])
    # Tiros (sin recorte), en el campo del partido y en todos.
    f["hs_f"], f["as_a"] = shrink(h_home, hs, sh), shrink(a_away, hs, sh)
    f["as_f"], f["hs_a"] = shrink(a_away, as_, sa), shrink(h_home, as_, sa)
    f["hs_f_all"] = shrink(h_all, np.where(h_home, hs, as_ * sh / sa), sh)
    f["as_f_all"] = shrink(a_all, np.where(a_away, as_, hs * sa / sh), sa)
    return f


def build(rows, seasons):
    """Features de cada partido de esas temporadas, con sus anteriores."""
    by_league = defaultdict(list)
    for r in rows:
        by_league[r[0]].append(r)
    out = []
    for code, rs in by_league.items():
        rs.sort(key=lambda r: r[2])
        for season in seasons:
            pool = np.array([[r[2], r[4], r[5], r[6], r[7], r[8], r[9]] for r in rs if r[1] in (season, previous(season))])
            for r in (r for r in rs if r[1] == season):
                prior = pool[pool[:, 0] < r[2]]
                f = features(prior, r[2], r[4], r[5])
                if f:
                    out.append({**f, "id": r[3], "season": season, "hc": r[6], "ac": r[7]})
    return out


def lam_v1(f, key=""):
    hf, aa, af, ha = (f[f"{n}{key}"] for n in ("hf", "aa", "af", "ha"))
    return hf * aa / f["lh"], af * ha / f["la"]


def x_home(f, shots):
    x = [math.log(f["hf"] / f["lh"]), math.log(f["aa"] / f["lh"]), math.log(f["hf_all"] / f["lh"]),
         math.log(f["aa_all"] / f["lh"]), math.log(f["lh"])]  # fmt: skip
    if shots:
        x += [math.log(f["hs_f"] / f["sh"]), math.log(f["as_a"] / f["sh"]), math.log(f["hs_f_all"] / f["sh"])]
    return x


def x_away(f, shots):
    x = [math.log(f["af"] / f["la"]), math.log(f["ha"] / f["la"]), math.log(f["af_all"] / f["la"]),
         math.log(f["ha_all"] / f["la"]), math.log(f["la"])]  # fmt: skip
    if shots:
        x += [math.log(f["as_f"] / f["sa"]), math.log(f["hs_a"] / f["sa"]), math.log(f["as_f_all"] / f["sa"])]
    return x


def fit(train, shots):
    mh = fit_count_model(np.array([x_home(f, shots) for f in train]), np.array([f["hc"] for f in train], float))
    ma = fit_count_model(np.array([x_away(f, shots) for f in train]), np.array([f["ac"] for f in train], float))
    return mh, ma


def predict(name, f, models=None):
    if name == "v1":
        lh, la = lam_v1(f)
        return duel(nb_pmf(lh, f["alpha"]), nb_pmf(la, f["alpha"]))
    if name == "A":
        lh, la = lam_v1(f, "_A")
        return duel(nb_pmf(lh, f["alpha"]), nb_pmf(la, f["alpha"]))
    mh, ma = models
    shots = name == "C"
    return duel(nb_pmf(mh.mean(x_home(f, shots)), mh.alpha), nb_pmf(ma.mean(x_away(f, shots)), ma.alpha))


def outcome(f):
    return 0 if f["hc"] > f["ac"] else 1 if f["hc"] == f["ac"] else 2


def logloss_rows(data, name, models=None):
    return [-math.log(max(predict(name, f, models)[outcome(f)], 1e-12)) for f in data]


def report(data, name, models=None):
    probs = np.array([predict(name, f, models) for f in data])
    out = np.array([outcome(f) for f in data])
    ll = -np.log(np.clip(probs[np.arange(len(out)), out], 1e-12, 1)).mean()
    acc = (probs.argmax(axis=1) == out).mean()
    nl_home = probs[:, 0] + probs[:, 1] >= probs[:, 2] + probs[:, 1]
    nl_hit = np.where(nl_home, out != 2, out != 0).mean()
    return ll, acc, nl_hit, probs, out


def calibration(probs, out):
    p = probs.ravel()
    y = (np.arange(3)[None, :] == out[:, None]).astype(float).ravel()
    rows = []
    for lo, hi in [(0, .2), (.2, .3), (.3, .5), (.5, .6), (.6, 1.01)]:
        m = (p >= lo) & (p < hi)
        rows.append(f"{lo:.0%}–{min(hi, 1):.0%}: n={m.sum()} pred {p[m].mean():.1%} obs {y[m].mean():.1%}")
    return " | ".join(rows)


def main():
    stage = sys.argv[1]
    rows = load()
    if stage == "select":
        train, val = build(rows, FIT), build(rows, SELECT)
        print(f"ajuste: {len(train)} partidos · selección: {len(val)}")
        fitted = {"B": fit(train, False), "C": fit(train, True)}
        for name in ("v1", "A", "B", "C"):
            ll, acc, nl, _, _ = report(val, name, fitted.get(name))
            print(f"{name}: log-loss {ll:.4f} · más probable {acc:.1%} · no pierde {nl:.1%}")
    elif stage == "test":
        chosen = sys.argv[2]
        test = build(rows, TEST)
        models = fit(build(rows, FIT + SELECT), chosen == "C") if chosen in ("B", "C") else None
        if models:
            for side, m in zip(("local", "visitante"), models, strict=True):
                print(f"coeficientes {side}: {np.round(m.coef, 4).tolist()} alpha {m.alpha:.4f}")
        print(f"test: {len(test)} partidos")
        res = {}
        for name, mods in (("v1", None), (chosen, models)):
            ll, acc, nl, probs, out = report(test, name, mods)
            res[name] = logloss_rows(test, name, mods)
            print(f"{name}: log-loss {ll:.4f} · más probable {acc:.1%} · no pierde {nl:.1%}")
            print(f"   calibración {calibration(probs, out)}")
        diff, lo, hi = bootstrap_mean_diff([f["id"] for f in test], res[chosen], res["v1"])
        print(f"{chosen} − v1: {diff:+.4f} [{lo:+.4f}, {hi:+.4f}] -> {'se adopta' if hi < 0 else 'se queda v1'}")


if __name__ == "__main__":
    main()
