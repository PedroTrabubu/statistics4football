"""Ensambla todas las features point-in-time de un partido concreto.

Estas features (forma, H2H, xG rolling, Elo pre-partido) se usaran en la
Fase 4 tanto para mostrarlas en la ficha de partido como para alimentar el
nivel de confianza del motor de EV. El propio modelo Poisson/Dixon-Coles
(Fase 4) se ajusta sobre el historico completo de goles por separado.
"""

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.db.models import Match
from app.stats.elo import get_elo_at
from app.stats.form import TeamForm, compute_team_form
from app.stats.h2h import HeadToHead, compute_h2h
from app.stats.xg import XgForm, compute_xg_form


@dataclass
class MatchFeatures:
    home_form: TeamForm
    away_form: TeamForm
    h2h: HeadToHead
    home_xg_form: XgForm
    away_xg_form: XgForm
    home_elo: float | None
    away_elo: float | None


def compute_match_features(db: Session, match: Match, num_matches: int = 5) -> MatchFeatures:
    return MatchFeatures(
        home_form=compute_team_form(db, match.home_team_id, match.date, num_matches),
        away_form=compute_team_form(db, match.away_team_id, match.date, num_matches),
        h2h=compute_h2h(db, match.home_team_id, match.away_team_id, match.date, num_matches),
        home_xg_form=compute_xg_form(db, match.home_team_id, match.date, num_matches),
        away_xg_form=compute_xg_form(db, match.away_team_id, match.date, num_matches),
        home_elo=get_elo_at(db, match.home_team_id, match.date),
        away_elo=get_elo_at(db, match.away_team_id, match.date),
    )
