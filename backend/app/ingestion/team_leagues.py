"""Liga actual de cada equipo.

Un equipo es una sola fila en `teams` aunque cambie de liga (asciende o
desciende entre LaLiga y LaLiga Hypermotion, por ejemplo). Su `league_id` es
la liga de su partido más reciente, incluidos los programados: así un recién
ascendido aparece en su liga nueva en cuanto se cargan sus partidos.
"""

from sqlalchemy.orm import Session

from app.db.models import Match, Team


def refresh_team_leagues(db: Session) -> int:
    """Actualiza `teams.league_id`. Devuelve cuántos equipos han cambiado de liga."""
    latest: dict[int, tuple] = {}
    for date, league_id, home_id, away_id in db.query(Match.date, Match.league_id, Match.home_team_id, Match.away_team_id):
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
