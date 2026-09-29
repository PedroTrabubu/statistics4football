import { leagueName } from "../lib/leagues";
import { Link } from "react-router-dom";
import type { Match } from "../api/types";
import { formatDateTime } from "../lib/format";

export function MatchRow({ match }: { match: Match }) {
  const played = match.status === "historical";
  return (
    <Link to={`/matches/${match.id}`} className="match-row">
      <span className="match-row-when">
        <span className="match-row-date">{formatDateTime(match.date)}</span>
        <span className="match-row-league">{leagueName(match.league_code)}</span>
      </span>
      <span className="match-row-teams">
        <span className="match-row-team">{match.home_team}</span>
        {played ? (
          <span className="match-row-score">
            {match.home_goals} - {match.away_goals}
          </span>
        ) : (
          <span className="match-row-score match-row-vs">vs</span>
        )}
        <span className="match-row-team">{match.away_team}</span>
      </span>
      <span className={`status-pill status-${match.status}`}>
        {played ? "Jugado" : "Programado"}
      </span>
    </Link>
  );
}
