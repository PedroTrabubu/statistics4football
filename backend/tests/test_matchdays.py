"""Tests de la jornada deducida de las fechas (app/ingestion/matchdays.py)."""

from datetime import datetime, timedelta
from types import SimpleNamespace

from app.ingestion.matchdays import derive_matchdays

FIRST_SATURDAY = datetime(2026, 8, 15, 16)  # UTC
TEAMS = list(range(1, 7))


def _round_robin() -> list[list[tuple[int, int]]]:
    """Doble vuelta de 6 equipos (método del círculo): 10 jornadas de 3 partidos."""
    teams = TEAMS[:]
    first_half = []
    for _ in range(len(teams) - 1):
        first_half.append([(teams[i], teams[-1 - i]) for i in range(len(teams) // 2)])
        teams = [teams[0], teams[-1], *teams[1:-1]]
    return first_half + [[(away, home) for home, away in r] for r in first_half]


def _season(moves: dict[tuple[int, int], datetime] | None = None):
    """Partidos en sábados consecutivos; `moves` cambia la fecha de algunos."""
    moves = moves or {}
    matches, truth, next_id = [], {}, 1
    for number, fixtures in enumerate(_round_robin(), start=1):
        for i, (home, away) in enumerate(fixtures):
            when = moves.get((home, away), FIRST_SATURDAY + timedelta(weeks=number - 1, hours=2 * i))
            matches.append(SimpleNamespace(id=next_id, home_team_id=home, away_team_id=away, date=when))
            truth[next_id] = number
            next_id += 1
    return matches, truth


def _wednesday_after(round_number: int) -> datetime:
    return FIRST_SATURDAY + timedelta(weeks=round_number - 1, days=4, hours=3)


def test_regular_schedule() -> None:
    matches, truth = _season()
    assert derive_matchdays(matches) == truth


def test_postponed_match_keeps_its_round() -> None:
    home, away = _round_robin()[2][0]  # jornada 3, aplazado hasta después de la 7
    matches, truth = _season({(home, away): _wednesday_after(7)})
    assert derive_matchdays(matches) == truth


def test_round_split_between_weekend_and_midweek() -> None:
    home, away = _round_robin()[4][2]  # jornada 5: dos partidos el sábado y uno el miércoles
    matches, truth = _season({(home, away): _wednesday_after(5)})
    assert derive_matchdays(matches) == truth


def test_team_twice_in_a_weekend() -> None:
    # Un aplazado de la jornada 6 se juega el viernes de la jornada 8, cuyo sábado
    # y domingo también juegan esos equipos: el viernes es el partido suelto.
    home, away = _round_robin()[5][0]
    friday = FIRST_SATURDAY + timedelta(weeks=7, days=-1)
    matches, truth = _season({(home, away): friday})
    assert derive_matchdays(matches) == truth


def test_exact_matchdays_are_kept() -> None:
    matches, truth = _season()
    exact = {mid: r for mid, r in truth.items() if mid % 2}
    assert derive_matchdays(matches, exact) == truth
