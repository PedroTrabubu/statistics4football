"""Tests de integracion de la API contra la BD de desarrollo ya poblada
(ingesta historica real). No son hermeticos (comparten BD con el dev), pero
las escrituras que disparan (predictions) son idempotentes."""

from fastapi.testclient import TestClient

from app.db.models import League, Match, MatchStatus, Team
from app.db.session import SessionLocal
from app.main import app

client = TestClient(app)


def test_list_leagues_returns_configured_leagues() -> None:
    response = client.get("/leagues")
    assert response.status_code == 200
    codes = {league["code"] for league in response.json()}
    assert {"ENG-Premier League", "ESP-La Liga"}.issubset(codes)


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
        assert "ev" in rec
        assert "matches_used" in rec


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

    older = client.get(f"/leagues/{league.id}/results", params={"season": seasons[-1]}).json()
    assert {m["season"] for m in older} == {seasons[-1]}


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
