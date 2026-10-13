"""Estadísticas provisionales de ESPN para los partidos recién jugados."""

from app.ingestion.espn_stats import parse_boxscore


def _team(side, corners, yellow="2", fouls="11"):
    return {
        "homeAway": side,
        "statistics": [
            {"name": "wonCorners", "displayValue": corners},
            {"name": "yellowCards", "displayValue": yellow},
            {"name": "redCards", "displayValue": "0"},
            {"name": "foulsCommitted", "displayValue": fouls},
            {"name": "totalShots", "displayValue": "15"},
            {"name": "shotsOnTarget", "displayValue": "7"},
            {"name": "possessionPct", "displayValue": "55.4"},
        ],
    }


def test_parse_boxscore_maps_espn_names_to_our_fields():
    stats = parse_boxscore({"boxscore": {"teams": [_team("home", "8"), _team("away", "2", "5", "15")]}})
    assert stats["home"] == {"corners_for": 8, "yellow_cards": 2, "red_cards": 0, "fouls": 11, "shots": 15, "shots_on_target": 7}
    assert stats["away"]["corners_for"] == 2 and stats["away"]["fouls"] == 15


def test_no_stats_yet_means_wait():
    assert parse_boxscore({}) is None
    assert parse_boxscore({"boxscore": {"teams": [_team("home", "8"), {"homeAway": "away", "statistics": []}]}}) is None


def test_only_clear_errors_are_corrected():
    from app.db.models import TeamMatchStats
    from app.ingestion.espn_stats import corrections

    def fd(yellow, red, fouls=10):
        return TeamMatchStats(corners_for=4, yellow_cards=yellow, red_cards=red, fouls=fouls, shots=12, shots_on_target=5)

    box = {"home": {"corners_for": 4, "yellow_cards": 1, "red_cards": 0, "fouls": 10, "shots": 12, "shots_on_target": 5},
           "away": {"corners_for": 3, "yellow_cards": 3, "red_cards": 1, "fouls": 11, "shots": 9, "shots_on_target": 4}}  # fmt: skip
    # Cero tarjetas en los dos: se usan las de ESPN.
    assert {(s, f, n) for s, f, _, n in corrections(fd(0, 0), fd(0, 0, 11), box)} == {
        ("home", "yellow_cards", 1), ("away", "yellow_cards", 3), ("away", "red_cards", 1),
    }  # fmt: skip
    # Tarjetas distintas pero no a cero: otra forma de contar, no se toca.
    assert corrections(fd(2, 0), fd(4, 0, 11), box) == []
    # Un dato que falta se rellena.
    missing = fd(1, 0)
    missing.fouls = None
    assert ("home", "fouls", None, 10) in corrections(missing, fd(3, 1, 11), box)
