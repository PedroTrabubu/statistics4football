from datetime import datetime

import numpy as np
import pytest

from app.probability.poisson_model import MatchResult, fit_dixon_coles


def _generate_synthetic_matches(seed: int = 42, repeats: int = 25) -> list[MatchResult]:
    """Genera partidos con Poisson a partir de fuerzas conocidas, para poder
    comprobar que el ajuste recupera (aproximadamente) la estructura real."""
    rng = np.random.default_rng(seed)

    true_attack = {1: 0.5, 2: 0.0, 3: -0.5}
    true_defense = {1: -0.3, 2: 0.0, 3: 0.3}
    home_advantage = 0.25

    matches = []
    team_ids = [1, 2, 3]
    for home in team_ids:
        for away in team_ids:
            if home == away:
                continue
            lam = np.exp(true_attack[home] + true_defense[away] + home_advantage)
            mu = np.exp(true_attack[away] + true_defense[home])
            for _ in range(repeats):
                matches.append(
                    MatchResult(
                        home_team_id=home,
                        away_team_id=away,
                        home_goals=int(rng.poisson(lam)),
                        away_goals=int(rng.poisson(mu)),
                        date=datetime(2024, 1, 1),
                    )
                )
    return matches


def test_fit_recovers_relative_team_strength():
    matches = _generate_synthetic_matches()
    model = fit_dixon_coles(matches, xi=0.0)  # xi=0: sin decaimiento temporal

    # Team 1 es el mas fuerte atacando, team 3 el mas debil.
    assert model.attack[1] > model.attack[2] > model.attack[3]
    # Team 1 defiende mejor (defense mas negativa = menos goles concedidos).
    assert model.defense[1] < model.defense[2] < model.defense[3]
    # Ventaja de jugar en casa deberia salir positiva y en un rango razonable.
    assert 0.05 < model.home_advantage < 0.5


def test_score_matrix_sums_to_one():
    matches = _generate_synthetic_matches()
    model = fit_dixon_coles(matches, xi=0.0)
    matrix = model.score_matrix(1, 2)
    assert matrix.sum() == pytest.approx(1.0)
    assert (matrix >= 0).all()


def test_stronger_team_has_higher_expected_goals():
    matches = _generate_synthetic_matches()
    model = fit_dixon_coles(matches, xi=0.0)
    lam, mu = model.expected_goals(home_team_id=1, away_team_id=3)
    assert lam > mu


def test_fit_raises_on_empty_input():
    with pytest.raises(ValueError):
        fit_dixon_coles([])


def test_unseen_team_falls_back_to_average_instead_of_crashing():
    """Equipo recien ascendido: no aparece en el historico de entrenamiento."""
    matches = _generate_synthetic_matches()
    model = fit_dixon_coles(matches, xi=0.0)

    lam, mu = model.expected_goals(home_team_id=1, away_team_id=999)
    assert lam > 0
    assert mu > 0
    assert model.matches_played.get(999, 0) == 0

    matrix = model.score_matrix(1, 999)
    assert matrix.sum() == pytest.approx(1.0)


def test_unseen_team_prior_is_below_average_not_league_average():
    """Un ascendido "medio" en la realidad rinde por debajo de la media de
    la liga: el prior para un equipo sin historico debe reflejar eso, no
    asumir que es un equipo mediocre-promedio (attack/defense=0)."""
    matches = _generate_synthetic_matches()
    model = fit_dixon_coles(matches, xi=0.0)

    league_avg_attack = sum(model.attack.values()) / len(model.attack)
    league_avg_defense = sum(model.defense.values()) / len(model.defense)

    assert model.promoted_attack_prior < league_avg_attack
    # defense: valores mas altos = peor defensa (concede mas)
    assert model.promoted_defense_prior > league_avg_defense
