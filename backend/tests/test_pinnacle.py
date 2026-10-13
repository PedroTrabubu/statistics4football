"""Tests del cliente de cuotas de Pinnacle (sin red: JSON con la forma real y
respuestas reales recortadas en tests/fixtures/pinnacle)."""

import copy
import json
from datetime import datetime
from pathlib import Path

import pytest

from app.ingestion.pinnacle import (
    american_to_decimal,
    check_schema,
    main_total,
    moneyline,
    parse_league,
    parse_markets,
    parse_matchups,
)


def _matchup(matchup_id, *, units="Regular", parent=None, kind="matchup", home="Malaga", away="Espanyol"):
    suffix = "" if units == "Regular" else f" ({units})"
    return {
        "id": matchup_id,
        "parentId": parent,
        "type": kind,
        "units": units,
        "startTime": "2026-10-09T19:00:00Z",
        "participants": [
            {"alignment": "home", "name": f"{home}{suffix}"},
            {"alignment": "away", "name": f"{away}{suffix}"},
        ],
    }


def _market(matchup_id, kind, key, prices, *, period=0, status=None, alternate=None, side=None):
    market = {"matchupId": matchup_id, "type": kind, "key": key, "period": period, "prices": prices}
    if status is not None:
        market["status"] = status
    if alternate is not None:
        market["isAlternate"] = alternate
    if side is not None:
        market["side"] = side
    return market


MATCHUPS = [
    _matchup(1),
    _matchup(2, units="Corners", parent=1),
    _matchup(3, units="Bookings", parent=1),
    _matchup(4, kind="special", parent=1),  # resultado exacto, doble oportunidad...
    _matchup(5, home="Barcelona", away="Getafe"),
]


def test_american_to_decimal():
    assert american_to_decimal(201) == 3.01
    assert american_to_decimal(-122) == 1.82
    assert american_to_decimal(100) == 2.0
    with pytest.raises(ValueError):
        american_to_decimal(0)


def test_parse_matchups_keeps_matches_and_links_corners_and_bookings():
    matches, owners = parse_matchups(MATCHUPS)
    assert set(matches) == {1, 5}
    assert (matches[1].home, matches[1].away) == ("Malaga", "Espanyol")
    assert matches[1].start == datetime(2026, 10, 9, 19, 0)  # UTC sin zona, como en la BD
    assert owners == {1: (1, "goals"), 2: (1, "corners"), 3: (1, "bookings"), 5: (5, "goals")}


def test_parse_markets_converts_and_skips_what_it_does_not_understand():
    _, owners = parse_matchups(MATCHUPS)
    markets = [
        _market(1, "moneyline", "s;0;m", [
            {"designation": "home", "price": 201},
            {"designation": "draw", "price": 224},
            {"designation": "away", "price": 159},
        ]),
        _market(1, "team_total", "s;0;tt;1.5;home", [
            {"designation": "over", "price": 177, "points": 1.5},
            {"designation": "under", "price": -210, "points": 1.5},
        ]),
        _market(2, "total", "s;0;ou;9.0", [
            {"designation": "over", "price": -107, "points": 9.0},
            {"designation": "under", "price": -109, "points": 9.0},
        ], status="open", alternate=False),
        _market(3, "total", "s;0;ou;4.5", [{"designation": "over", "price": 109, "points": 4.5}], status="closed"),
        _market(4, "moneyline", "s;0;m", [{"designation": "home", "price": 300}]),  # especial
        _market(1, "total", "s;0;ou;2.5", [{"designation": "rare", "price": 100, "points": 2.5}]),
    ]
    odds = parse_markets(markets, owners)

    assert moneyline(odds, 1) == {"home": 3.01, "draw": 3.24, "away": 2.59}
    team = [o for o in odds if o.market == "team_total"]
    assert {(o.team, o.selection, o.line) for o in team} == {("home", "over", 1.5), ("home", "under", 1.5)}
    corners = [o for o in odds if o.units == "corners"]
    assert [(o.matchup_id, o.selection, o.odds, o.alternate) for o in corners] == [
        (1, "over", 1.935, False),
        (1, "under", 1.917, False),
    ]
    assert not [o for o in odds if o.units == "bookings"]  # mercado cerrado
    assert all(o.selection != "rare" for o in odds)
    assert len(odds) == 7


def test_main_total_is_the_most_balanced_line():
    _, owners = parse_matchups(MATCHUPS)
    markets = [
        _market(2, "total", f"s;0;ou;{line}", [
            {"designation": "over", "price": over, "points": line},
            {"designation": "under", "price": under, "points": line},
        ])
        for line, over, under in [(8.5, -139, 113), (9.0, -107, -109), (9.5, 114, -140)]
    ]
    odds = parse_markets(markets, owners)
    assert main_total(odds, 1, "corners") == (9.0, 1.935, 1.917)
    assert main_total(odds, 1, "bookings") is None


# --- Respuestas reales recortadas (tests/fixtures/pinnacle) -------------------

FIXTURES = Path(__file__).parent / "fixtures" / "pinnacle"


def _fixture(name: str) -> tuple[list[dict], list[dict]]:
    return (
        json.loads((FIXTURES / f"{name}_matchups.json").read_text(encoding="utf-8")),
        json.loads((FIXTURES / f"{name}_markets.json").read_text(encoding="utf-8")),
    )


def test_real_laliga_response_parses_every_market_we_want():
    matchups, markets = _fixture("laliga")
    assert check_schema(matchups, markets) == []
    matches, odds = parse_league(matchups, markets)
    by_name = {(m.home, m.away): m for m in matches.values()}
    malaga = by_name[("Malaga", "Espanyol")]
    assert malaga.status == "pending" and not malaga.is_live and malaga.version
    assert malaga.cutoff_at == datetime(2026, 10, 9, 19, 0)

    own = [o for o in odds if o.matchup_id == malaga.matchup_id]
    kinds = {(o.units, o.period, o.market) for o in own}
    for kind in [
        ("goals", 0, "moneyline"), ("goals", 0, "total"), ("goals", 0, "team_total"), ("goals", 1, "total"),
        ("goals", 0, "btts"), ("goals", 1, "btts"), ("goals", 0, "double_chance"), ("goals", 1, "double_chance"),
        ("goals", 0, "draw_no_bet"), ("goals", 0, "team_to_score"), ("goals", 1, "team_to_score"),
        ("corners", 0, "total"), ("corners", 0, "team_total"), ("bookings", 0, "total"),
    ]:  # fmt: skip
        assert kind in kinds, kind
    # Lineas alternativas: varios totales de goles del partido entero.
    assert len({o.line for o in own if (o.units, o.period, o.market) == ("goals", 0, "total")}) > 3
    # Cada cuota lleva la apuesta maxima y la version de su mercado.
    assert all(o.max_stake and o.version for o in own if o.market != "spread")
    # Especiales con sus selecciones; los exoticos (resultado exacto,
    # descanso/final) no aparecen.
    assert {o.selection for o in own if o.market == "double_chance"} == {"home_draw", "draw_away", "home_away"}
    assert {(o.team, o.selection) for o in own if o.market == "team_to_score" and o.period == 0} == {
        ("home", "yes"), ("home", "no"), ("away", "yes"), ("away", "no"),
    }
    assert {o.market for o in odds} <= {
        "moneyline", "spread", "total", "team_total", "btts", "double_chance", "draw_no_bet", "team_to_score",
    }  # fmt: skip


def test_real_hypermotion_response_without_bookings_in_some_matches():
    matchups, markets = _fixture("hypermotion")
    assert check_schema(matchups, markets) == []
    matches, odds = parse_league(matchups, markets)
    assert len(matches) == 2
    booked = {m["parentId"] for m in matchups if m.get("units") == "Bookings"}
    for mid in matches:
        has_bookings = any(o.matchup_id == mid and o.units == "bookings" for o in odds)
        assert has_bookings == (mid in booked)


def test_missing_markets_leave_the_rest_intact():
    matchups, markets = _fixture("laliga")
    corners_ids = {m["id"] for m in matchups if m.get("units") == "Corners"}
    _, full = parse_league(matchups, markets)
    _, without = parse_league(matchups, [m for m in markets if m["matchupId"] not in corners_ids])
    assert not [o for o in without if o.units == "corners"]
    assert len(without) == len(full) - len([o for o in full if o.units == "corners"])


def test_unexpected_format_is_reported_and_does_not_break_parsing():
    matchups, markets = _fixture("laliga")
    matchups = copy.deepcopy(matchups) + ["no soy un objeto"]
    markets = copy.deepcopy(markets)
    del matchups[0]["participants"]  # falta un campo obligatorio
    markets[0]["newField"] = 1  # campo nuevo
    markets[1]["type"] = "exotic"  # tipo de mercado desconocido
    markets[2]["prices"].append({"designation": "over", "price": None, "boost": 3})  # precio raro
    markets[3]["period"] = None  # periodo ilegible

    warnings = check_schema(matchups, markets)
    assert any("falta el campo 'participants'" in w for w in warnings)
    assert any("campo nuevo 'newField'" in w for w in warnings)
    assert any("'exotic'" in w for w in warnings)
    assert any("campo nuevo 'boost'" in w for w in warnings)
    assert any("no son objetos" in w for w in warnings)
    matches, odds = parse_league(matchups, markets)  # no lanza
    assert odds

    assert check_schema({"error": "x"}, None) == [
        "matchups: se esperaba una lista y llegó dict",
        "markets: se esperaba una lista y llegó NoneType",
    ]
