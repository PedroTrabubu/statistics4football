"""Ensambla todas las features point-in-time de un partido concreto.

Estas features (forma, H2H, xG rolling, Elo pre-partido) se usaran en la
Fase 4 tanto para mostrarlas en la ficha de partido como para alimentar el
nivel de confianza del motor de EV. El propio modelo Poisson/Dixon-Coles
(Fase 4) se ajusta sobre el historico completo de goles por separado.
"""

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.competitions import CHAMPIONS_LEAGUE
from app.db.models import League, Match
from app.stats.discipline import DisciplineForm, compute_discipline_form
from app.stats.form import TeamForm, compute_team_form
from app.stats.h2h import HeadToHead, compute_h2h
from app.stats.own_elo import MatchElo, match_elo
from app.stats.xg import XgForm, compute_xg_form


@dataclass
class MatchFeatures:
    home_form: TeamForm
    away_form: TeamForm
    h2h: HeadToHead
    home_xg_form: XgForm
    away_xg_form: XgForm
    home_discipline: DisciplineForm
    away_discipline: DisciplineForm
    # Elo propio previo al partido (own_elo_pre); None cuando la ficha muestra
    # "—", con el motivo en `elo`. Ya no sale de ClubElo (`get_elo_at`).
    home_elo: float | None
    away_elo: float | None
    elo: MatchElo


def excluded_leagues(db: Session, match: Match) -> list[int]:
    """Ligas que no cuentan en la forma de los equipos de este partido. En las
    ligas, la Champions no cuenta (sus cifras siguen como antes de añadirla);
    en la Champions cuenta todo: los partidos de liga de cada equipo son su
    contexto, y los equipos de otras ligas solo tienen los de Champions."""
    champions = [league_id for (league_id,) in db.query(League.id).filter(League.code == CHAMPIONS_LEAGUE)]
    return [] if match.league_id in champions else champions


def compute_match_features(db: Session, match: Match, num_matches: int = 5) -> MatchFeatures:
    skip = excluded_leagues(db, match)
    elo = match_elo(db, match)
    return MatchFeatures(
        home_form=compute_team_form(db, match.home_team_id, match.date, num_matches, skip),
        away_form=compute_team_form(db, match.away_team_id, match.date, num_matches, skip),
        h2h=compute_h2h(db, match.home_team_id, match.away_team_id, match.date, num_matches, skip),
        home_xg_form=compute_xg_form(db, match.home_team_id, match.date, num_matches, skip),
        away_xg_form=compute_xg_form(db, match.away_team_id, match.date, num_matches, skip),
        home_discipline=compute_discipline_form(db, match.home_team_id, match.date, num_matches, skip),
        away_discipline=compute_discipline_form(db, match.away_team_id, match.date, num_matches, skip),
        home_elo=elo.home.elo,
        away_elo=elo.away.elo,
        elo=elo,
    )
