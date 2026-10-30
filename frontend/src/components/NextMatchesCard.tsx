import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { matchPath } from "../lib/routes";
import { getUpcomingMatches } from "../api/client";
import type { League } from "../api/types";
import { formatDateTime } from "../lib/format";
import { leagueName } from "../lib/leagues";
import { useApi } from "../lib/useApi";
import { TeamCrest } from "./TeamCrest";

const SHOWN = 3;

/** Tarjeta del hero de Partidos: los próximos partidos de la liga elegida,
 * el primero destacado. Acceso directo a la ficha sin bajar por la jornada.
 * Sin liga (todas) o sin partidos por jugar, no se pinta. */
export function NextMatchesCard({ league }: { league: League | undefined }) {
  const { t } = useTranslation();
  const upcoming = useApi(
    () =>
      league
        ? getUpcomingMatches({ league_id: league.id, limit: 20 }).then((list) =>
            [...list].sort((a, b) => a.date.localeCompare(b.date)).slice(0, SHOWN),
          )
        : Promise.resolve([]),
    [league?.id],
  );

  if (!league) return null;
  if (upcoming.loading && !upcoming.data) {
    return (
      <div className="hero-card side-card" aria-hidden="true">
        <span className="sk" style={{ width: "55%", height: 14 }} />
        <span className="sk" style={{ height: 96, borderRadius: 14 }} />
        <span className="sk" style={{ height: 66, borderRadius: 12 }} />
        <span className="sk" style={{ height: 66, borderRadius: 12 }} />
      </div>
    );
  }
  const [first, ...rest] = upcoming.data ?? [];
  if (!first) return null;

  return (
    <div className="hero-card side-card">
      <span className="hero-card-kicker">{t("landing:preview.title", { league: leagueName(league.code) })}</span>
      <Link to={matchPath(first.id)} className="side-card-feature">
        <span className="num side-card-date">{formatDateTime(first.date)}</span>
        <span className="side-card-teams">
          <span className="side-card-team">
            <TeamCrest team={first.home_team} league={first.league_code} size="lg" eager />
            <span>{first.home_team}</span>
          </span>
          <em className="serif-accent side-card-vs">vs</em>
          <span className="side-card-team">
            <TeamCrest team={first.away_team} league={first.league_code} size="lg" eager />
            <span>{first.away_team}</span>
          </span>
        </span>
      </Link>
      {rest.map((match) => (
        <Link key={match.id} to={matchPath(match.id)} className="side-card-row side-card-match">
          <span className="num side-card-row-date">{formatDateTime(match.date)}</span>
          <span className="side-card-row-teams">
            <span className="side-card-match-team">
              <TeamCrest team={match.home_team} league={match.league_code} />
              <span className="side-card-match-name">{match.home_team}</span>
            </span>
            <em className="serif-accent">vs</em>
            <span className="side-card-match-team is-away">
              <span className="side-card-match-name">{match.away_team}</span>
              <TeamCrest team={match.away_team} league={match.league_code} />
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}
