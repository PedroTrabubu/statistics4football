import { leagueName } from "../lib/leagues";
import { Link } from "react-router-dom";
import type { Match } from "../api/types";
import { formatDateTime } from "../lib/format";
import { LeagueLogo } from "./LeagueLogo";
import { MatchTeams } from "./TeamCrest";

/** `eager`: la fila se ve sin hacer scroll, sus escudos no esperan. */
export function MatchRow({ match, eager = false }: { match: Match; eager?: boolean }) {
  const played = match.status === "historical";
  return (
    <Link to={`/matches/${match.id}`} className="match-row">
      <span className="match-row-when">
        <span className="match-row-date">{formatDateTime(match.date)}</span>
        <span className="match-row-league">
          <LeagueLogo code={match.league_code} />
          <span className="match-row-league-name">{leagueName(match.league_code)}</span>
        </span>
      </span>
      <MatchTeams
        className="match-row-teams"
        home={match.home_team}
        away={match.away_team}
        league={match.league_code}
        size="lg"
        eager={eager}
        middle={
          played ? (
            <span className="match-row-score">
              {match.home_goals} - {match.away_goals}
            </span>
          ) : (
            <span className="match-row-score match-row-vs">vs</span>
          )
        }
      />
      <span className={`status-pill status-${match.status}`}>
        {played ? "Jugado" : "Programado"}
      </span>
    </Link>
  );
}
