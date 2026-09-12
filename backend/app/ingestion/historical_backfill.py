"""Backfill historico: resultados + cuotas de cierre via soccerdata.MatchHistory.

Fuente unica de verdad para partidos jugados en esta fase. xG (Understat) y
Elo (ClubElo) se reconcilian contra los partidos/equipos creados aqui.
"""

import logging
from datetime import datetime

import pandas as pd
from sqlalchemy.orm import Session

from app.db.models import (
    IngestionRun,
    IngestionStatus,
    League,
    Match,
    MatchOdds,
    MatchStatus,
    Season,
    Team,
)
from app.ingestion.odds_columns import extract_all_odds
from app.ingestion.soccerdata_client import get_match_history_reader

logger = logging.getLogger(__name__)


def _get_or_create_league(db: Session, code: str) -> League:
    league = db.query(League).filter_by(code=code).one_or_none()
    if league is None:
        league = League(code=code, name=code)
        db.add(league)
        db.flush()
    return league


def _get_or_create_season(db: Session, league_id: int, name: str) -> Season:
    season = db.query(Season).filter_by(league_id=league_id, name=name).one_or_none()
    if season is None:
        season = Season(league_id=league_id, name=name)
        db.add(season)
        db.flush()
    return season


def _get_or_create_team(db: Session, name: str, league_id: int) -> Team:
    team = db.query(Team).filter_by(name=name).one_or_none()
    if team is None:
        team = Team(name=name, league_id=league_id)
        db.add(team)
        db.flush()
    return team


def backfill_match_history(
    db: Session, leagues: list[str], seasons: list[str] | str | None = None
) -> IngestionRun:
    """Descarga (o usa cache) MatchHistory para `leagues`/`seasons` y puebla la BD.

    Idempotente: re-ejecutar actualiza resultados/cuotas de los mismos partidos
    en vez de duplicarlos (se busca el partido por liga+temporada+equipos+fecha).
    """
    run = IngestionRun(source="soccerdata.match_history", status=IngestionStatus.RUNNING)
    db.add(run)
    db.commit()

    rows_ingested = 0
    try:
        reader = get_match_history_reader(leagues=leagues, seasons=seasons)
        df = reader.read_games().reset_index()
        # Filas espurias (lineas en blanco al final del CSV, etc.) quedan con
        # league/date en NaN tras el mapeo a IDs canonicos: se descartan.
        df = df.dropna(subset=["league", "date"])

        for _, row in df.iterrows():
            match_date = row["date"]
            if pd.isna(match_date):
                continue

            league = _get_or_create_league(db, row["league"])
            season = _get_or_create_season(db, league.id, row["season"])
            home_team = _get_or_create_team(db, row["home_team"], league.id)
            away_team = _get_or_create_team(db, row["away_team"], league.id)

            match_datetime = match_date.to_pydatetime()
            match = (
                db.query(Match)
                .filter_by(
                    league_id=league.id,
                    season_id=season.id,
                    home_team_id=home_team.id,
                    away_team_id=away_team.id,
                    date=match_datetime,
                )
                .one_or_none()
            )

            home_goals = row.get("FTHG")
            away_goals = row.get("FTAG")
            has_score = pd.notna(home_goals) and pd.notna(away_goals)

            if match is None:
                match = Match(
                    league_id=league.id,
                    season_id=season.id,
                    home_team_id=home_team.id,
                    away_team_id=away_team.id,
                    date=match_datetime,
                    source_ids={"match_history_game_id": row["game"]},
                )
                db.add(match)
            else:
                match.source_ids = {
                    **(match.source_ids or {}),
                    "match_history_game_id": row["game"],
                }

            match.home_goals = int(home_goals) if has_score else None
            match.away_goals = int(away_goals) if has_score else None
            match.status = MatchStatus.HISTORICAL if has_score else MatchStatus.SCHEDULED
            db.flush()

            db.query(MatchOdds).filter_by(match_id=match.id).delete()
            for odds in extract_all_odds(row):
                db.add(
                    MatchOdds(
                        match_id=match.id,
                        bookmaker=odds["bookmaker"],
                        market=odds["market"],
                        selection=odds["selection"],
                        odds=odds["odds"],
                        line=odds["line"],
                        snapshot_time=match_datetime,
                    )
                )

            rows_ingested += 1

        db.commit()
        run.status = IngestionStatus.SUCCESS
        run.rows_ingested = rows_ingested
        run.finished_at = datetime.utcnow()
        db.commit()
        logger.info("MatchHistory backfill: %d partidos procesados", rows_ingested)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        run.status = IngestionStatus.FAILED
        run.notes = str(exc)[:2000]
        run.finished_at = datetime.utcnow()
        db.commit()
        raise

    return run
