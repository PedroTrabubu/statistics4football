"""Liga actual de cada equipo.

Un equipo es una sola fila en `teams` aunque cambie de liga (asciende o
desciende entre LaLiga y LaLiga Hypermotion, por ejemplo). Su `league_id` es
la liga de su partido más reciente, incluidos los programados: así un recién
ascendido aparece en su liga nueva en cuanto se cargan sus partidos. La
Champions no cuenta: un equipo sigue en su liga aunque su último partido sea
de Champions (los que solo juegan la Champions se quedan en ella).
"""

from sqlalchemy.orm import Session

from app.core.competitions import CHAMPIONS_LEAGUE
from app.db.models import League, Match, Team


def refresh_team_leagues(db: Session) -> int:
    """Actualiza `teams.league_id`. Devuelve cuántos equipos han cambiado de liga."""
    champions_id = db.query(League.id).filter_by(code=CHAMPIONS_LEAGUE).scalar()
    latest: dict[int, tuple] = {}
    matches = db.query(Match.date, Match.league_id, Match.home_team_id, Match.away_team_id)
    if champions_id is not None:
        matches = matches.filter(Match.league_id != champions_id)
    for date, league_id, home_id, away_id in matches:
        for team_id in (home_id, away_id):
            if team_id not in latest or date > latest[team_id][0]:
                latest[team_id] = (date, league_id)

    changed = 0
    for team in db.query(Team):
        league_id = latest.get(team.id, (None, team.league_id))[1]
        if team.league_id != league_id:
            team.league_id = league_id
            changed += 1
    db.flush()
    return changed
