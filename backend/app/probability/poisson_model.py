"""Modelo Dixon-Coles: goles esperados por equipo + correccion de marcadores
bajos, ajustado por maxima verosimilitud sobre el historico de goles.

Referencia: Dixon, M.J. and Coles, S.G. (1997), "Modelling Association
Football Scores and Inefficiencies in the Football Betting Market".

Cada equipo tiene una fuerza de ataque y de defensa. Goles esperados:
    lambda(local) = exp(ataque_local + defensa_visitante + ventaja_local)
    mu(visitante) = exp(ataque_visitante + defensa_local)
Los marcadores 0-0, 1-0, 0-1 y 1-1 se corrigen con un parametro rho, porque
un Poisson independiente puro infravalora los empates en partidos con pocos
goles.
"""

from dataclasses import dataclass
from datetime import datetime

import numpy as np
from scipy.optimize import minimize
from scipy.stats import poisson


@dataclass
class MatchResult:
    home_team_id: int
    away_team_id: int
    home_goals: int
    away_goals: int
    date: datetime


@dataclass
class DixonColesModel:
    team_ids: list[int]
    attack: dict[int, float]
    defense: dict[int, float]
    home_advantage: float
    rho: float
    matches_played: dict[int, int]  # nº de partidos usados en el ajuste, por equipo
    # Prior para un equipo sin historico en el ajuste (recien ascendido):
    # media de los equipos mas flojos de la liga, NO la media de la liga.
    # Un ascendido "medio" en realidad rinde por debajo de la media (hecho
    # empirico conocido); usar attack=defense=0 sobrestimaba sistematicamente
    # a estos equipos y generaba "valor" falso contra ellos en el backtest.
    promoted_attack_prior: float = 0.0
    promoted_defense_prior: float = 0.0

    def expected_goals(self, home_team_id: int, away_team_id: int) -> tuple[float, float]:
        attack_home = self.attack.get(home_team_id, self.promoted_attack_prior)
        defense_home = self.defense.get(home_team_id, self.promoted_defense_prior)
        attack_away = self.attack.get(away_team_id, self.promoted_attack_prior)
        defense_away = self.defense.get(away_team_id, self.promoted_defense_prior)

        lam = np.exp(attack_home + defense_away + self.home_advantage)
        mu = np.exp(attack_away + defense_home)
        return float(lam), float(mu)

    def score_matrix(self, home_team_id: int, away_team_id: int, max_goals: int = 10) -> np.ndarray:
        lam, mu = self.expected_goals(home_team_id, away_team_id)
        goals = np.arange(max_goals + 1)
        home_pmf = poisson.pmf(goals, lam)
        away_pmf = poisson.pmf(goals, mu)
        matrix = np.outer(home_pmf, away_pmf)

        for x, y in ((0, 0), (0, 1), (1, 0), (1, 1)):
            matrix[x, y] *= _tau(x, y, lam, mu, self.rho)

        matrix = np.clip(matrix, 0, None)
        matrix /= matrix.sum()
        return matrix


def _tau(x: int, y: int, lam: float, mu: float, rho: float) -> float:
    if x == 0 and y == 0:
        return 1 - lam * mu * rho
    if x == 0 and y == 1:
        return 1 + lam * rho
    if x == 1 and y == 0:
        return 1 + mu * rho
    if x == 1 and y == 1:
        return 1 - rho
    return 1.0


def _time_weights(dates: np.ndarray, as_of: datetime, xi: float) -> np.ndarray:
    days_ago = np.array([(as_of - d).days for d in dates], dtype=float)
    days_ago = np.clip(days_ago, 0, None)
    return np.exp(-xi * days_ago)


def fit_dixon_coles(
    matches: list[MatchResult],
    xi: float = 0.0018,
    as_of: datetime | None = None,
    l2_reg: float = 0.02,
) -> DixonColesModel:
    """Ajusta el modelo por maxima verosimilitud (+ L2) sobre `matches`.

    xi: tasa de decaimiento temporal (Dixon-Coles). Con 0.0018/dia, un
    partido de hace 1 año pesa ~la mitad que uno de hoy. Con xi=0 todos los
    partidos pesan igual.

    l2_reg: penalizacion L2 sobre ataque/defensa (encoge hacia la media de
    la liga). Sin esto, un equipo con pocos partidos muy decaidos en el
    tiempo (peso casi nulo en la log-verosimilitud) puede quedar con un
    parametro desbocado sin que el optimizador lo "note" (ej. un equipo
    descendido hace años, visto una sola temporada antigua).
    """
    if not matches:
        raise ValueError("No hay partidos para ajustar el modelo.")

    team_ids = sorted({m.home_team_id for m in matches} | {m.away_team_id for m in matches})
    n = len(team_ids)
    idx = {tid: i for i, tid in enumerate(team_ids)}

    home_idx = np.array([idx[m.home_team_id] for m in matches])
    away_idx = np.array([idx[m.away_team_id] for m in matches])
    home_goals = np.array([m.home_goals for m in matches])
    away_goals = np.array([m.away_goals for m in matches])
    dates = np.array([m.date for m in matches])

    reference_date = as_of or max(m.date for m in matches)
    weights = _time_weights(dates, reference_date, xi)

    matches_played: dict[int, int] = {tid: 0 for tid in team_ids}
    for m in matches:
        matches_played[m.home_team_id] += 1
        matches_played[m.away_team_id] += 1

    # Partidos "efectivos" (ponderados por el decaimiento temporal) por
    # equipo: se usa para encoger hacia el prior de equipo flojo a los
    # equipos con poca evidencia real (recien ascendidos con solo un puñado
    # de partidos disputados esta temporada, no cero -> no caen en el
    # fallback de "sin historico", pero su MLE es igual de poco fiable con
    # tan pocos datos).
    effective_matches = np.zeros(n)
    np.add.at(effective_matches, home_idx, weights)
    np.add.at(effective_matches, away_idx, weights)

    # theta = [attack_0..attack_{n-2}, defense_0..defense_{n-2}, home_adv, rho]
    # El ultimo equipo no es libre: se fija para que ataque/defensa medios
    # sean 0 (si no, el modelo esta sobre-parametrizado: sumar una constante
    # a todos los ataques y restarla a todas las defensas no cambia nada).
    n_free = n - 1

    def unpack(theta: np.ndarray) -> tuple[np.ndarray, np.ndarray, float, float]:
        attack_free = theta[:n_free]
        defense_free = theta[n_free : 2 * n_free]
        home_adv = theta[2 * n_free]
        rho = theta[2 * n_free + 1]
        attack = np.append(attack_free, -attack_free.sum())
        defense = np.append(defense_free, -defense_free.sum())
        return attack, defense, home_adv, rho

    def neg_log_likelihood(theta: np.ndarray) -> float:
        attack, defense, home_adv, rho = unpack(theta)
        lam = np.exp(attack[home_idx] + defense[away_idx] + home_adv)
        mu = np.exp(attack[away_idx] + defense[home_idx])

        tau = np.ones_like(lam)
        for x, y in ((0, 0), (0, 1), (1, 0), (1, 1)):
            mask = (home_goals == x) & (away_goals == y)
            tau[mask] = _tau(x, y, lam[mask], mu[mask], rho)
        tau = np.clip(tau, 1e-10, None)

        log_lik = (
            np.log(tau)
            + poisson.logpmf(home_goals, lam)
            + poisson.logpmf(away_goals, mu)
        )
        penalty = l2_reg * (np.sum(attack**2) + np.sum(defense**2))
        return -float(np.sum(weights * log_lik)) + penalty

    theta0 = np.zeros(2 * n_free + 2)
    theta0[2 * n_free] = 0.25  # ventaja local inicial razonable
    theta0[2 * n_free + 1] = -0.05  # rho inicial

    bounds = [(None, None)] * (2 * n_free) + [(None, None), (-0.9, 0.9)]
    result = minimize(neg_log_likelihood, theta0, method="L-BFGS-B", bounds=bounds)

    attack, defense, home_adv, rho = unpack(result.x)

    # Prior de "recien ascendido": media del cuartil mas flojo de la liga
    # (menor ataque / peor defensa), no la media general. Con muy pocos
    # equipos, se usa al menos 1 para que el prior siga siendo el peor
    # disponible en vez de la media completa. Se calcula ANTES de encoger
    # nada, sobre las fuerzas ya ajustadas.
    bottom_n = max(1, n // 4)
    promoted_attack_prior = float(np.sort(attack)[:bottom_n].mean())
    promoted_defense_prior = float(np.sort(defense)[-bottom_n:].mean())

    # Encogido hacia ese prior para equipos con poca evidencia real (no
    # "sin historico", solo pocos partidos: p.ej. un ascendido a mitad de su
    # primera temporada). Sin esto, un equipo con ~8 partidos y un par de
    # resultados ajustados puede salir con una defensa "mejor que la de
    # Chelsea" solo por ruido de muestra pequeña. Un equipo con
    # MIN_EFFECTIVE_MATCHES partidos ponderados o mas no se toca.
    MIN_EFFECTIVE_MATCHES = 25.0
    shrink = np.clip(effective_matches / MIN_EFFECTIVE_MATCHES, 0.0, 1.0)
    attack = shrink * attack + (1 - shrink) * promoted_attack_prior
    defense = shrink * defense + (1 - shrink) * promoted_defense_prior

    return DixonColesModel(
        team_ids=team_ids,
        attack=dict(zip(team_ids, attack.tolist())),
        defense=dict(zip(team_ids, defense.tolist())),
        home_advantage=float(home_adv),
        rho=float(rho),
        matches_played=matches_played,
        promoted_attack_prior=promoted_attack_prior,
        promoted_defense_prior=promoted_defense_prior,
    )
