"""Tests de integracion de la API contra la BD de desarrollo ya poblada
(ingesta historica real). No son hermeticos (comparten BD con el dev), pero
las escrituras que disparan (predictions) son idempotentes."""

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db.models import League, Match, MatchStatus, Team
from app.db.session import SessionLocal
from app.main import app

client = TestClient(app)


def test_list_leagues_returns_configured_leagues() -> None:
    response = client.get("/leagues")
    assert response.status_code == 200
    codes = {league["code"] for league in response.json()}
    assert {"ENG-Premier League", "ESP-La Liga"}.issubset(codes)
    assert not codes & set(get_settings().context)  # las de contexto no salen en la web


def test_list_teams_filtered_by_league() -> None:
    db = SessionLocal()
    try:
        league = db.query(League).filter_by(code="ENG-Premier League").one()
    finally:
        db.close()

    response = client.get("/teams", params={"league_id": league.id})
    assert response.status_code == 200
    teams = response.json()
    assert len(teams) > 0
    assert all(t["league_id"] == league.id for t in teams)


def test_list_matches_respects_limit() -> None:
    response = client.get("/matches", params={"limit": 5})
    assert response.status_code == 200
    matches = response.json()
    assert len(matches) == 5
    for match in matches:
        assert {"home_team", "away_team", "league_code", "season"}.issubset(match.keys())


def test_get_match_not_found_returns_404() -> None:
    response = client.get("/matches/999999999")
    assert response.status_code == 404


def _first_historical_match_id() -> int:
    db = SessionLocal()
    try:
        match = (
            db.query(Match)
            .filter(Match.status == MatchStatus.HISTORICAL)
            .order_by(Match.date.desc())
            .first()
        )
        assert match is not None, "se esperaba tener partidos historicos ya ingeridos"
        return match.id
    finally:
        db.close()


def test_get_match_detail() -> None:
    match_id = _first_historical_match_id()
    response = client.get(f"/matches/{match_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == match_id
    assert body["status"] == "historical"


def test_get_match_stats_shape() -> None:
    match_id = _first_historical_match_id()
    response = client.get(f"/matches/{match_id}/stats")
    assert response.status_code == 200
    body = response.json()
    for key in ("home_form", "away_form", "h2h", "home_xg_form", "away_xg_form"):
        assert key in body
    assert "matches_played" in body["home_form"]


def test_get_match_predictions_include_confidence_and_risk() -> None:
    match_id = _first_historical_match_id()
    response = client.get(f"/matches/{match_id}/predictions")
    if not get_settings().enable_ev:
        # Modelo de valor retirado: la ficha ya no las pide.
        assert response.status_code == 404
        return
    assert response.status_code == 200
    predictions = response.json()
    for pred in predictions:
        assert "confidence" in pred
        assert "risk_level" in pred
        assert pred["risk_level"] in ("low", "medium", "high")


def test_list_recommendations_shape() -> None:
    response = client.get("/recommendations", params={"limit": 10})
    assert response.status_code == 200
    for rec in response.json():
        assert "confidence" in rec
        assert "risk_level" in rec
        assert ("ev" in rec) == get_settings().enable_ev
        assert "matches_used" in rec


def test_value_strategy_retired_without_flag() -> None:
    if get_settings().enable_ev:
        return
    assert client.get("/recommendations", params={"strategy": "valor"}).status_code == 404
    assert client.get("/recommendations/history", params={"strategy": "valor"}).status_code == 404
    assert client.get("/recommendations", params={"min_ev": 0.05}).status_code == 400


def test_list_recommendations_excludes_played_matches() -> None:
    """/recommendations es para partidos aun por jugar — los ya jugados
    (p.ej. los del backtest de scripts/generate_predictions.py) van en
    /recommendations/history, nunca mezclados aqui."""
    response = client.get("/recommendations", params={"limit": 200})
    assert response.status_code == 200
    db = SessionLocal()
    try:
        for rec in response.json():
            match = db.get(Match, rec["match_id"])
            assert match.status == MatchStatus.SCHEDULED
    finally:
        db.close()


def test_recommendation_history_shape_and_never_hides_losses() -> None:
    response = client.get("/recommendations/history", params={"limit": 200})
    assert response.status_code == 200
    body = response.json()
    summary = body["summary"]
    assert summary["total"] == summary["won"] + summary["lost"] + summary["pending"]
    # Si hay recomendaciones falladas en la BD, deben aparecer en el listado:
    # el principio de transparencia (nunca ocultar resultados negativos) se
    # verifica aqui, no solo se declara.
    if summary["lost"] > 0:
        assert any(item["outcome"] == "lost" for item in body["items"])
    for item in body["items"]:
        assert item["outcome"] in ("won", "lost", "pending")
    # Sin el modelo de valor no se sirve ni EV, ni PnL, ni ROI.
    if not get_settings().enable_ev:
        assert not {"roi", "pnl_units", "with_odds"} & summary.keys()
        assert all(not {"ev", "pnl_units"} & item.keys() for item in body["items"])
    if summary["margin_ci_low"] is not None:
        assert summary["margin_ci_low"] <= summary["margin_ci_high"]


def test_league_season_stats_shape() -> None:
    db = SessionLocal()
    try:
        league = db.query(League).filter_by(code="ENG-Premier League").one()
    finally:
        db.close()

    response = client.get(f"/leagues/{league.id}/season-stats")
    assert response.status_code == 200
    teams = response.json()
    assert len(teams) > 0
    for team in teams:
        for split in ("overall", "home", "away"):
            assert "over_2_5_pct" in team[split]
            assert "btts_pct" in team[split]


def test_league_seasons_lists_most_recent_first() -> None:
    db = SessionLocal()
    try:
        league = db.query(League).filter_by(code="ENG-Premier League").one()
    finally:
        db.close()

    response = client.get(f"/leagues/{league.id}/seasons")
    assert response.status_code == 200
    seasons = response.json()
    assert seasons == sorted(seasons, reverse=True)


def test_league_results_only_played_matches_of_one_season() -> None:
    db = SessionLocal()
    try:
        league = db.query(League).filter_by(code="ENG-Premier League").one()
    finally:
        db.close()

    seasons = client.get(f"/leagues/{league.id}/seasons").json()
    response = client.get(f"/leagues/{league.id}/results")
    assert response.status_code == 200
    matches = response.json()
    assert len(matches) > 0
    assert {m["season"] for m in matches} == {seasons[0]}
    assert all(m["status"] == "historical" for m in matches)
    assert all(m["home_goals"] is not None and m["away_goals"] is not None for m in matches)
    dates = [m["date"] for m in matches]
    assert dates == sorted(dates, reverse=True)
    # Premier League: el CSV de MatchHistory trae descanso, arbitro y stats.
    assert all(m["home_ht_goals"] is not None and m["referee"] for m in matches)
    assert all(m["home_ht_goals"] <= m["home_goals"] and m["away_ht_goals"] <= m["away_goals"] for m in matches)
    assert all(m["home_stats"] is not None and m["home_stats"]["corners"] is not None for m in matches)
    # xG de Understat: en la Premier sí (puede faltar en el último partido, si aún no lo ha publicado).
    assert any(m["home_stats"]["xg"] is not None for m in matches)

    older = client.get(f"/leagues/{league.id}/results", params={"season": seasons[-1]}).json()
    assert {m["season"] for m in older} == {seasons[-1]}


def test_league_context_results_only_for_champions() -> None:
    db = SessionLocal()
    try:
        champions = db.query(League).filter_by(code="INT-Champions League").one()
        laliga = db.query(League).filter_by(code="ESP-La Liga").one()
    finally:
        db.close()

    assert client.get(f"/leagues/{laliga.id}/context-results").json() == []
    matches = client.get(f"/leagues/{champions.id}/context-results").json()
    # Partidos jugados de sus equipos en sus ligas, nunca de la propia Champions.
    assert all(m["league_id"] != champions.id and m["status"] == "historical" for m in matches)
    assert len({m["season"] for m in matches}) <= 1


def test_league_upcoming_only_average_odds() -> None:
    db = SessionLocal()
    try:
        league = db.query(League).filter_by(code="ESP-La Liga").one()
    finally:
        db.close()

    response = client.get(f"/leagues/{league.id}/upcoming", params={"days": 14})
    assert response.status_code == 200
    matches = response.json()
    assert all(m["status"] == "scheduled" for m in matches)
    dates = [m["date"] for m in matches]
    assert dates == sorted(dates)
    for m in matches:
        # Solo la media de 1X2 y más/menos de 2,5 goles, con fecha y fuente de la toma.
        assert {o["market"] for o in m["odds"]} <= {"1x2", "over_under_2.5"}
        assert (m["odds_taken_at"] is None) == (not m["odds"]) == (m["odds_source"] is None)


def test_team_season_stats_shape() -> None:
    db = SessionLocal()
    try:
        league = db.query(League).filter_by(code="ENG-Premier League").one()
        team = db.query(Team).filter_by(league_id=league.id).first()
    finally:
        db.close()

    response = client.get(f"/teams/{team.id}/season-stats")
    assert response.status_code == 200
    body = response.json()
    assert body["team_id"] == team.id
    assert body["overall"]["matches_played"] > 0


def test_team_season_stats_404_for_unknown_team() -> None:
    response = client.get("/teams/999999/season-stats")
    assert response.status_code == 404


def test_match_referee_stats_is_point_in_time() -> None:
    db = SessionLocal()
    try:
        match = (
            db.query(Match)
            .filter(Match.status == MatchStatus.HISTORICAL, Match.referee.isnot(None))
            .order_by(Match.date.desc())
            .first()
        )
        assert match is not None
        match_id, referee, match_date = match.id, match.referee, match.date.isoformat()
    finally:
        db.close()

    for scope in ("season", "all"):
        response = client.get(f"/matches/{match_id}/referee-stats", params={"referee_scope": scope})
        assert response.status_code == 200
        body = response.json()
        assert body["referee"] == referee
        assert all(m["referee"] == referee for m in body["referee_matches"])
        for key in ("referee_matches", "home_matches", "away_matches"):
            assert all(m["date"] < match_date for m in body[key])
            assert all(m["id"] != match_id for m in body[key])

    season_only = client.get(f"/matches/{match_id}/referee-stats").json()
    all_seasons = client.get(f"/matches/{match_id}/referee-stats", params={"referee_scope": "all"}).json()
    assert len(all_seasons["referee_matches"]) >= len(season_only["referee_matches"])


def test_match_history_is_point_in_time_and_two_seasons() -> None:
    db = SessionLocal()
    try:
        match = (
            db.query(Match)
            .filter(Match.status == MatchStatus.HISTORICAL)
            .order_by(Match.date.desc())
            .first()
        )
        assert match is not None
        match_id, match_date, league_id = match.id, match.date.isoformat(), match.league_id
    finally:
        db.close()

    response = client.get(f"/matches/{match_id}/history")
    assert response.status_code == 200
    body = response.json()
    seasons = client.get(f"/leagues/{league_id}/seasons").json()
    assert body["seasons"] == seasons[:2]
    matches = body["matches"]
    assert len(matches) > 0
    # Nada del propio partido ni posterior: los patrones no pueden ver el futuro.
    assert all(m["date"] < match_date and m["id"] != match_id for m in matches)
    assert all(m["status"] == "historical" and m["league_id"] == league_id for m in matches)
    assert {m["season"] for m in matches} <= set(body["seasons"])
    dates = [m["date"] for m in matches]
    assert dates == sorted(dates, reverse=True)
    # Ya jugado: su resultado va aparte, para comprobar los picks.
    assert body["played"]["id"] == match_id
    assert body["played"]["home_goals"] is not None


def test_match_history_of_unplayed_match_has_no_result() -> None:
    db = SessionLocal()
    try:
        match = db.query(Match).filter(Match.status == MatchStatus.SCHEDULED).first()
        assert match is not None
        match_id = match.id
    finally:
        db.close()
    assert client.get(f"/matches/{match_id}/history").json()["played"] is None


def test_match_history_404_for_unknown_match() -> None:
    assert client.get("/matches/999999999/history").status_code == 404


def test_match_recent_is_point_in_time_and_only_both_teams() -> None:
    db = SessionLocal()
    try:
        match = (
            db.query(Match)
            .filter(
                Match.status == MatchStatus.HISTORICAL,
                Match.league.has(League.code != "INT-Champions League"),
            )
            .order_by(Match.date.desc())
            .first()
        )
        assert match is not None
        match_id, match_date = match.id, match.date.isoformat()
        home_id, away_id = match.home_team_id, match.away_team_id
    finally:
        db.close()

    response = client.get(f"/matches/{match_id}/recent")
    assert response.status_code == 200
    body = response.json()
    assert len(body["home"]) > 0 and len(body["away"]) > 0
    for key in ("h2h", "home", "away"):
        assert all(m["date"] < match_date and m["id"] != match_id for m in body[key])
        assert all(m["status"] == "historical" for m in body[key])
        dates = [m["date"] for m in body[key]]
        assert dates == sorted(dates, reverse=True)
    assert all({m["home_team_id"], m["away_team_id"]} == {home_id, away_id} for m in body["h2h"])
    assert all(home_id in (m["home_team_id"], m["away_team_id"]) for m in body["home"])
    assert all(away_id in (m["home_team_id"], m["away_team_id"]) for m in body["away"])
    # En una liga la Champions no cuenta, como en la forma reciente.
    assert all(m["league_code"] != "INT-Champions League" for key in ("h2h", "home", "away") for m in body[key])


def test_match_recent_404_for_unknown_match() -> None:
    assert client.get("/matches/999999999/recent").status_code == 404


def test_large_responses_are_gzipped() -> None:
    db = SessionLocal()
    try:
        league = db.query(League).filter_by(code="ENG-Premier League").one()
    finally:
        db.close()
    response = client.get(f"/leagues/{league.id}/results", headers={"Accept-Encoding": "gzip"})
    assert response.headers.get("content-encoding") == "gzip"
