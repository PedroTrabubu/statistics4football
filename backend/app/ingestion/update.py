"""Actualización de la temporada en curso, paso a paso. La usan
scripts/ingest_fixtures.py (a mano) y el programador (scripts/scheduler.py).

1. football-data.org: partidos jugados (con marcador) y por jugar.
2. CSV de la temporada de Football-Data.co.uk: resultados, cuotas, córners,
   tarjetas, faltas y tiros de los ya jugados. Football-Data lo actualiza un
   par de veces por semana: hasta entonces un partido jugado tiene marcador
   pero no esas estadísticas.
3. xG de Understat.
4. fixtures.csv de Football-Data.co.uk: la próxima jornada con sus cuotas.
5. ESPN: árbitros de partidos jugados y calendario de LaLiga Hypermotion, y
   estadísticas provisionales de los recién jugados hasta que llegue el CSV, y
   corrección de errores claros del CSV (cero tarjetas que ESPN sí tiene, datos
   que faltan).
6. Designaciones arbitrales oficiales de los próximos partidos.
   Champions League: todo desde ESPN (app/ingestion/champions.py).
7. data/arbitros_manual.csv, que siempre prevalece.

Cada paso que falla se anota y no impide los siguientes.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.ingestion.champions import LEAGUE_CODE as CHAMPIONS, sync_champions
from app.ingestion.designations import sync_designations
from app.ingestion.espn import sync_espn
from app.ingestion.espn_stats import correct_stats_from_espn, fill_stats_from_espn
from app.ingestion.fixtures_backfill import sync_current_season_matches
from app.ingestion.fixtures_csv import sync_fixtures_csv
from app.ingestion.historical_backfill import backfill_match_history, season_name_for
from app.ingestion.odds_api_client import LEAGUE_SPORT_KEY_MAP
from app.ingestion.referee_overrides import apply_referee_overrides
from app.ingestion.soccerdata_client import leagues_with_source
from app.ingestion.xg_backfill import backfill_understat_xg


def run_update(db: Session, settings: Settings, log: Callable[[str], None] = print) -> list[str]:
    """Todos los pasos; devuelve los que fallaron (vacío si todo fue bien)."""
    failures: list[str] = []
    season = season_name_for(date.today())

    def step(name: str, fn: Callable[[], str]) -> None:
        try:
            log(f"{name}: {fn()}")
        except Exception as exc:  # noqa: BLE001  (un paso caído no frena los demás)
            db.rollback()
            failures.append(name)
            log(f"AVISO {name}: {type(exc).__name__}: {exc}")

    def football_data_org() -> str:
        run = sync_current_season_matches(db, settings, leagues=settings.leagues)
        return f"status={run.status.value} partidos_procesados={run.rows_ingested} {run.notes or ''}".strip()

    def match_history() -> str:
        # Solo las ligas que tiene Football-Data.co.uk (la Champions no está), y las de contexto.
        leagues = leagues_with_source(settings.leagues + settings.context, "MatchHistory")
        run = backfill_match_history(db, leagues=leagues, seasons=[season])
        return f"status={run.status.value} partidos_procesados={run.rows_ingested}"

    def understat() -> str:
        run = backfill_understat_xg(db, leagues=leagues_with_source(settings.leagues, "Understat"), seasons=[season])
        return f"status={run.status.value} partidos_actualizados={run.rows_ingested}"

    def fixtures() -> str:
        odds_api_leagues = (
            {code for code in settings.model_leagues if code in LEAGUE_SPORT_KEY_MAP}
            if settings.the_odds_api_key
            else set()
        )
        run = sync_fixtures_csv(db, settings.leagues, odds_api_leagues)
        return f"status={run.status.value} {run.notes}"

    def espn() -> str:
        run = sync_espn(db, settings.leagues, [season], season)
        return f"status={run.status.value} {run.notes}"

    def espn_stats() -> str:
        run = fill_stats_from_espn(db, settings.leagues)
        return f"status={run.status.value} {run.notes}"

    def espn_corrections() -> str:
        run = correct_stats_from_espn(db, settings.leagues, [season])
        return f"status={run.status.value} {run.notes}"

    def designations() -> str:
        run = sync_designations(db, settings.leagues, 2000 + int(season[:2]))
        return f"status={run.status.value} {run.notes}"

    def champions() -> str:
        run = sync_champions(db, [season])
        return f"status={run.status.value} {run.notes}"

    def overrides() -> str:
        updated, unmatched = apply_referee_overrides(db)
        extra = "".join(f"\n  AVISO: arbitros_manual.csv sin partido para {label}" for label in unmatched)
        return f"{updated} actualizados{extra}"

    step("football-data.org", football_data_org)
    step(f"Football-Data.co.uk {season}", match_history)
    step(f"Understat xG {season}", understat)
    step("fixtures.csv", fixtures)
    step("ESPN", espn)
    step("Estadísticas provisionales (ESPN)", espn_stats)
    step("Correcciones de estadísticas (ESPN)", espn_corrections)
    step("Designaciones", designations)
    if CHAMPIONS in settings.leagues:
        step("Champions League (ESPN)", champions)
    step("Árbitros corregidos a mano", overrides)
    return failures
