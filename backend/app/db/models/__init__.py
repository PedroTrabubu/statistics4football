"""Importa todos los modelos para que Alembic/SQLAlchemy los descubra."""

from app.db.models.elo import EloRating
from app.db.models.ingestion import IngestionRun, IngestionStatus
from app.db.models.league import League
from app.db.models.match import Match, MatchStatus
from app.db.models.odds import MatchOdds
from app.db.models.pick import PickCombo, PickLeg
from app.db.models.prediction import ModelPrediction, RiskLevel
from app.db.models.season import Season
from app.db.models.stats import TeamMatchStats
from app.db.models.team import Team

__all__ = [
    "EloRating",
    "IngestionRun",
    "IngestionStatus",
    "League",
    "Match",
    "MatchOdds",
    "MatchStatus",
    "ModelPrediction",
    "PickCombo",
    "PickLeg",
    "RiskLevel",
    "Season",
    "Team",
    "TeamMatchStats",
]
