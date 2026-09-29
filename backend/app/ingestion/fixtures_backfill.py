"""Sincronizacion de la temporada en curso via football-data.org: partidos
ya jugados (con marcador real, quedan HISTORICAL) y por jugar (SCHEDULED).

El historico "de fondo" (temporadas anteriores completas) viene de
soccerdata/MatchHistory (`historical_backfill.py`); football-data.org solo
cubre `currentSeason` de cada competicion, asi que esto nunca toca
temporadas ya cerradas. Se puede re-ejecutar en cualquier momento para
reflejar los resultados mas recientes: un partido que pasa de SCHEDULED a
FINISHED entre dos ejecuciones se actualiza con su marcador real.

Idempotente: se identifica un partido por (liga, temporada, local,
visitante) en vez de por fecha exacta, porque las fechas de partidos aun no
jugados pueden cambiar (aplazamientos) sin que deje de ser "el mismo
partido".
"""

import logging
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import IngestionRun, IngestionStatus, League, Match, MatchStatus, Season, Team
from app.ingestion.football_data_client import LEAGUE_CODE_MAP, FootballDataClient
from app.ingestion.team_names import TEAM_ALIASES, normalize

logger = logging.getLogger(__name__)

FINISHED_STATUS = "FINISHED"


def _season_name(start_date: str, end_date: str) -> str:
    """Convierte fechas ISO de football-data.org al formato de temporada usado
    en el resto del proyecto (soccerdata), ej. 2026-08-21/2027-05-30 -> "2627"."""
    start_year = int(start_date[:4])
    end_year = int(end_date[:4])
    return f"{start_year % 100:02d}{end_year % 100:02d}"


def _parse_utc(iso_datetime: str) -> datetime:
    return datetime.fromisoformat(iso_datetime.replace("Z", "+00:00")).replace(tzinfo=None)


def _get_or_create_season(db: Session, league_id: int, name: str, start: datetime, end: datetime) -> Season:
    season = db.query(Season).filter_by(league_id=league_id, name=name).one_or_none()
    if season is None:
        season = Season(league_id=league_id, name=name, start_date=start.date(), end_date=end.date())
        db.add(season)
        db.flush()
    return season


def _team_for(db: Session, cache: dict[str, Team], source_name: str, league_id: int) -> Team:
    if source_name in cache:
        return cache[source_name]

    canonical = TEAM_ALIASES.get(source_name, source_name)
    team = db.query(Team).filter_by(name=canonical).one_or_none()

    if team is None:
        normalized = normalize(canonical)
        team = next(
            (t for t in db.query(Team).filter_by(league_id=league_id).all() if normalize(t.name) == normalized),
            None,
        )

    if team is None:
        team = Team(name=canonical, league_id=league_id)
        db.add(team)
        db.flush()
        logger.info("Nuevo equipo creado desde football-data.org: %r -> %r", source_name, canonical)

    cache[source_name] = team
    return team


def sync_current_season_matches(db: Session, settings: Settings, leagues: list[str]) -> IngestionRun:
    run = IngestionRun(source="football_data_org.season_sync", status=IngestionStatus.RUNNING)
    db.add(run)
    db.commit()

    rows_ingested = 0
    finished_count = 0
    skipped_leagues: list[str] = []
    try:
        with FootballDataClient(settings) as client:
            for league_code in leagues:
                competition_code = LEAGUE_CODE_MAP.get(league_code)
                if competition_code is None:
                    skipped_leagues.append(league_code)
                    continue

                league = db.query(League).filter_by(code=league_code).one_or_none()
                if league is None:
                    league = League(code=league_code, name=league_code)
                    db.add(league)
                    db.flush()

                team_cache: dict[str, Team] = {}
                fixtures = client.get_season_matches(competition_code)

                for row in fixtures:
                    season_info = row["season"]
                    season_name = _season_name(season_info["startDate"], season_info["endDate"])
                    season = _get_or_create_season(
                        db,
                        league.id,
                        season_name,
                        _parse_utc(season_info["startDate"] + "T00:00:00Z"),
                        _parse_utc(season_info["endDate"] + "T00:00:00Z"),
                    )

                    home_team = _team_for(db, team_cache, row["homeTeam"]["name"], league.id)
                    away_team = _team_for(db, team_cache, row["awayTeam"]["name"], league.id)
                    match_date = _parse_utc(row["utcDate"])

                    is_finished = row["status"] == FINISHED_STATUS
                    full_time = row.get("score", {}).get("fullTime", {}) if is_finished else {}
                    home_goals = full_time.get("home") if is_finished else None
                    away_goals = full_time.get("away") if is_finished else None
                    if is_finished:
                        finished_count += 1

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

                    if match is None:
                        match = Match(
                            league_id=league.id,
                            season_id=season.id,
                            home_team_id=home_team.id,
                            away_team_id=away_team.id,
                            source_ids={"football_data_org_match_id": row["id"]},
                        )
                        db.add(match)
                    else:
                        match.source_ids = {
                            **(match.source_ids or {}),
                            "football_data_org_match_id": row["id"],
                        }

                    match.date = match_date
                    match.home_goals = home_goals
                    match.away_goals = away_goals
                    match.status = MatchStatus.HISTORICAL if is_finished else MatchStatus.SCHEDULED

                    rows_ingested += 1

        db.commit()
        run.status = IngestionStatus.SUCCESS
        run.rows_ingested = rows_ingested
        notes = [f"jugados={finished_count}", f"por_jugar={rows_ingested - finished_count}"]
        if skipped_leagues:
            notes.append(f"ligas sin mapeo a football-data.org: {skipped_leagues}")
        run.notes = " ".join(notes)[:2000]
        run.finished_at = datetime.utcnow()
        db.commit()
        logger.info(
            "football-data.org season sync: %d partidos procesados (%d jugados)",
            rows_ingested,
            finished_count,
        )
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        run.status = IngestionStatus.FAILED
        run.notes = str(exc)[:2000]
        run.finished_at = datetime.utcnow()
        db.commit()
        raise

    return run
