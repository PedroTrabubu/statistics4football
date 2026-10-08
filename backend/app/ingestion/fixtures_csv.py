"""Próximos partidos y sus cuotas desde el fixtures.csv de Football-Data.co.uk.

Es la única fuente de calendario para las ligas que football-data.org no da
en su plan gratuito (LaLiga Hypermotion). Solo trae la próxima jornada: lo
renuevan a mitad de semana y antes del fin de semana. Sus columnas de cuotas
son las de los CSV históricos, así que la "Market Average" pre-partido es la
misma que usan los backtests.

Un partido se identifica igual que en `historical_backfill.py` (liga,
temporada, local, visitante): cuando llega su resultado en el CSV de la
temporada, se actualiza el mismo partido.
"""

import io
import logging
from datetime import datetime

import httpx
import pandas as pd
from sqlalchemy.orm import Session

from app.db.models import IngestionRun, IngestionStatus, Match, MatchOdds, MatchStatus
from app.ingestion.football_data_client import LEAGUE_CODE_MAP
from app.ingestion.historical_backfill import (
    _get_or_create_league,
    _get_or_create_season,
    _get_or_create_team,
    season_name_for,
    uk_local_to_utc,
)
from app.ingestion.matchdays import refresh_estimated_matchdays
from app.ingestion.odds_columns import extract_all_odds
from app.ingestion.soccerdata_client import LEAGUE_DICT, fetch_football_data_csv, leagues_with_source
from app.ingestion.team_leagues import refresh_team_leagues

logger = logging.getLogger(__name__)

FIXTURES_URL = "https://football-data.co.uk/fixtures.csv"


def _kickoff_utc(row: pd.Series) -> datetime:
    time = row["Time"] if isinstance(row.get("Time"), str) else "12:00"
    return uk_local_to_utc(pd.to_datetime(f"{row['Date']} {time}", dayfirst=True).to_pydatetime())


def sync_fixtures_csv(db: Session, leagues: list[str], odds_api_leagues: set[str]) -> IngestionRun:
    """Crea o actualiza los partidos por jugar de `leagues` que trae el CSV.

    Cuotas: en `odds_api_leagues` (las que refresca the-odds-api.com con
    `refresh_odds.py`) solo se rellenan si el partido aún no tiene ninguna,
    para no pisar un precio más reciente; en el resto se sustituyen siempre."""
    run = IngestionRun(source="football_data_uk.fixtures", status=IngestionStatus.RUNNING)
    db.add(run)
    db.commit()

    created = updated = already_played = with_odds = 0
    try:
        with httpx.Client(follow_redirects=True, timeout=30) as client:
            content = fetch_football_data_csv(client, FIXTURES_URL)
        df = pd.read_csv(io.BytesIO(content), encoding="utf-8-sig")

        league_of_division = {
            LEAGUE_DICT[code]["MatchHistory"]: code for code in leagues_with_source(leagues, "MatchHistory")
        }
        df = df[df["Div"].isin(league_of_division)].dropna(subset=["Date", "HomeTeam", "AwayTeam"])
        now = datetime.utcnow()

        for _, row in df.iterrows():
            league_code = league_of_division[row["Div"]]
            kickoff = _kickoff_utc(row)
            league = _get_or_create_league(db, league_code)
            season = _get_or_create_season(db, league.id, season_name_for(kickoff.date()))
            home_team = _get_or_create_team(db, row["HomeTeam"], league.id)
            away_team = _get_or_create_team(db, row["AwayTeam"], league.id)

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
            if match is not None and match.status == MatchStatus.HISTORICAL:
                already_played += 1
                continue

            if match is None:
                match = Match(
                    league_id=league.id,
                    season_id=season.id,
                    home_team_id=home_team.id,
                    away_team_id=away_team.id,
                    date=kickoff,
                    status=MatchStatus.SCHEDULED,
                    source_ids={"football_data_uk_fixture": True},
                )
                db.add(match)
                db.flush()
                created += 1
            else:
                # Sin football-data.org este CSV es la única fuente de la hora
                # (aplazamientos); con él, manda su hora UTC.
                if league_code not in LEAGUE_CODE_MAP:
                    match.date = kickoff
                updated += 1

            odds = extract_all_odds(row)
            has_odds = db.query(MatchOdds.id).filter_by(match_id=match.id).first() is not None
            if odds and (league_code not in odds_api_leagues or not has_odds):
                db.query(MatchOdds).filter_by(match_id=match.id).delete()
                for item in odds:
                    db.add(MatchOdds(match_id=match.id, snapshot_time=now, **item))
                with_odds += 1

        refresh_team_leagues(db)
        refresh_estimated_matchdays(db)
        db.commit()
        run.status = IngestionStatus.SUCCESS
        run.rows_ingested = created + updated
        run.notes = f"nuevos={created} actualizados={updated} ya_jugados={already_played} con_cuotas={with_odds}"
        run.finished_at = datetime.utcnow()
        db.commit()
        logger.info("fixtures.csv: %s", run.notes)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        run.status = IngestionStatus.FAILED
        run.notes = str(exc)[:2000]
        run.finished_at = datetime.utcnow()
        db.commit()
        raise

    return run
