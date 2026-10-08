"""Backfill historico: resultados + cuotas de cierre via soccerdata.MatchHistory.

Fuente unica de verdad para partidos jugados en esta fase. xG (Understat) y
Elo (ClubElo) se reconcilian contra los partidos/equipos creados aqui.
"""

import logging
from datetime import date, datetime
from zoneinfo import ZoneInfo

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
    TeamMatchStats,
)
from app.ingestion.matchdays import refresh_estimated_matchdays
from app.ingestion.odds_columns import extract_all_odds
from app.ingestion.soccerdata_client import get_match_history_reader
from app.ingestion.team_leagues import refresh_team_leagues

logger = logging.getLogger(__name__)



UK_TZ = ZoneInfo("Europe/London")
UTC = ZoneInfo("UTC")


def uk_local_to_utc(local: datetime) -> datetime:
    """La hora del CSV de Football-Data.co.uk es la de Reino Unido. Toda la base
    guarda UTC sin zona (como football-data.org), y la web la convierte a la
    hora local del navegador."""
    return local.replace(tzinfo=UK_TZ).astimezone(UTC).replace(tzinfo=None)


def season_name_for(day: date) -> str:
    """Temporada que contiene ese día, en el formato de Football-Data.co.uk
    ("2627" para 2026-27). Las temporadas empiezan en julio."""
    start = day.year if day.month >= 7 else day.year - 1
    return f"{start % 100:02d}{(start + 1) % 100:02d}"


FIRST_SEASON = "2021"


def seasons_until(day: date) -> list[str]:
    """Desde la 20/21 hasta la temporada que contiene ese día, incluida. Sin
    temporadas explícitas, soccerdata deja fuera la temporada en curso de
    julio a diciembre."""
    first, last = int(FIRST_SEASON[:2]), int(season_name_for(day)[:2])
    return [f"{y:02d}{y + 1:02d}" for y in range(first, last + 1)]


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


def _int_or_none(value) -> int | None:
    return int(value) if pd.notna(value) else None


def _upsert_team_match_stats(db: Session, match_id: int, team_id: int, **fields) -> None:
    """Crea o actualiza solo los campos pasados; no toca xg/xga (los rellena
    xg_backfill.py por separado, ver app/ingestion/xg_backfill.py)."""
    stats = db.query(TeamMatchStats).filter_by(match_id=match_id, team_id=team_id).one_or_none()
    if stats is None:
        stats = TeamMatchStats(match_id=match_id, team_id=team_id)
        db.add(stats)
    for key, value in fields.items():
        setattr(stats, key, value)


def backfill_match_history(
    db: Session, leagues: list[str], seasons: list[str] | str | None = None
) -> IngestionRun:
    """Descarga (o usa cache) MatchHistory para `leagues`/`seasons` y puebla la BD.

    Idempotente: re-ejecutar actualiza resultados/cuotas de los mismos partidos
    en vez de duplicarlos. El partido se identifica por liga+temporada+equipos
    (cada cruce local/visitante es unico en una temporada), la misma clave que
    usa `fixtures_backfill.py`: no se usa la fecha porque la del CSV (hora UK o
    solo dia) no coincide con la hora UTC que guarda football-data.org, y eso
    duplicaba partidos de la temporada en curso. La fecha solo se fija al
    crear el partido, para no pisar la hora UTC mas precisa de football-data.org.
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

            match_datetime = uk_local_to_utc(match_date.to_pydatetime())
            match = (
                db.query(Match)
                .filter_by(
                    league_id=league.id,
                    season_id=season.id,
                    home_team_id=home_team.id,
                    away_team_id=away_team.id,
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
            home_ht_goals = _int_or_none(row.get("HTHG"))
            away_ht_goals = _int_or_none(row.get("HTAG"))
            if home_ht_goals is not None and away_ht_goals is not None:
                match.home_ht_goals = home_ht_goals
                match.away_ht_goals = away_ht_goals
            referee = row.get("referee")
            if isinstance(referee, str) and referee.strip():
                match.referee = referee.strip()
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

            if has_score:
                # Corners/tarjetas/faltas/tiros: mismo CSV de MatchHistory
                # (columnas HC/AC, HY/AY, HR/AR, HF/AF, HS/AS, HST/AST), solo
                # disponibles para partidos ya jugados.
                _upsert_team_match_stats(
                    db,
                    match.id,
                    home_team.id,
                    shots=_int_or_none(row.get("HS")),
                    shots_on_target=_int_or_none(row.get("HST")),
                    corners_for=_int_or_none(row.get("HC")),
                    corners_against=_int_or_none(row.get("AC")),
                    fouls=_int_or_none(row.get("HF")),
                    yellow_cards=_int_or_none(row.get("HY")),
                    red_cards=_int_or_none(row.get("HR")),
                )
                _upsert_team_match_stats(
                    db,
                    match.id,
                    away_team.id,
                    shots=_int_or_none(row.get("AS")),
                    shots_on_target=_int_or_none(row.get("AST")),
                    corners_for=_int_or_none(row.get("AC")),
                    corners_against=_int_or_none(row.get("HC")),
                    fouls=_int_or_none(row.get("AF")),
                    yellow_cards=_int_or_none(row.get("AY")),
                    red_cards=_int_or_none(row.get("AR")),
                )

            rows_ingested += 1

        moved = refresh_team_leagues(db)
        refresh_estimated_matchdays(db)
        db.commit()
        run.status = IngestionStatus.SUCCESS
        run.rows_ingested = rows_ingested
        run.finished_at = datetime.utcnow()
        db.commit()
        logger.info("MatchHistory backfill: %d partidos procesados, %d equipos cambian de liga", rows_ingested, moved)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        run.status = IngestionStatus.FAILED
        run.notes = str(exc)[:2000]
        run.finished_at = datetime.utcnow()
        db.commit()
        raise

    return run
