import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { TeamSeasonStats } from "../api/types";
import { formatFixed, formatPct, formatSeason } from "../lib/format";
import { leagueParam } from "../lib/leagues";
import { QUERY, ROUTES, withQuery } from "../lib/routes";
import { TeamName } from "./TeamCrest";

/** Una cifra de temporada de los dos equipos: valor y barra de cada uno
 * (local en negro, visitante en gris), sobre `max` (100 en porcentajes). */
function Tile({
  label,
  home,
  away,
  values,
  max,
}: {
  label: string;
  home: string;
  away: string;
  values: [number | null | undefined, number | null | undefined];
  max: number;
}) {
  const width = (v: number | null | undefined) => (v == null || max <= 0 ? 0 : Math.min(100, (v / max) * 100));
  return (
    <div className="season-tile">
      <span className="season-tile-label">{label}</span>
      <span className="season-tile-row">
        <span className="num">{home}</span>
        <span className="season-tile-bar is-home" aria-hidden="true">
          <span style={{ width: `${width(values[0])}%` }} />
        </span>
      </span>
      <span className="season-tile-row">
        <span className="num">{away}</span>
        <span className="season-tile-bar is-away" aria-hidden="true">
          <span style={{ width: `${width(values[1])}%` }} />
        </span>
      </span>
    </div>
  );
}

export function SeasonStatsSummary({
  homeStats,
  awayStats,
  homeTeam,
  awayTeam,
  league,
}: {
  homeStats: TeamSeasonStats | null;
  awayStats: TeamSeasonStats | null;
  homeTeam: string;
  awayTeam: string;
  league: string;
}) {
  const { t } = useTranslation();
  if (homeStats === null && awayStats === null) {
    return <p className="muted">{t("matches:seasonSummary.noData")}</p>;
  }

  const season = homeStats?.season ?? awayStats?.season;
  const home = homeStats?.overall;
  const away = awayStats?.overall;

  return (
    <div>
      <p className="muted small">{t("matches:seasonSummary.season", { season: season ? formatSeason(season) : "" })}</p>
      <div className="season-legend">
        <span className="season-legend-item is-home">
          <TeamName team={homeTeam} league={league} />
        </span>
        <span className="season-legend-item is-away">
          <TeamName team={awayTeam} league={league} />
        </span>
      </div>
      <div className="season-tiles">
        <Tile
          label={t("matches:seasonSummary.played")}
          home={home ? String(home.matches_played) : "—"}
          away={away ? String(away.matches_played) : "—"}
          values={[home?.matches_played, away?.matches_played]}
          max={Math.max(home?.matches_played ?? 0, away?.matches_played ?? 0)}
        />
        <Tile
          label={t("matches:seasonSummary.pointsPerGame")}
          home={home?.points_per_game != null ? formatFixed(home.points_per_game, 2) : "—"}
          away={away?.points_per_game != null ? formatFixed(away.points_per_game, 2) : "—"}
          values={[home?.points_per_game, away?.points_per_game]}
          max={3}
        />
        <Tile label={t("matches:seasonSummary.over15")} home={formatPct(home?.over_1_5_pct ?? null)} away={formatPct(away?.over_1_5_pct ?? null)} values={[home?.over_1_5_pct, away?.over_1_5_pct]} max={100} />
        <Tile label={t("matches:seasonSummary.over25")} home={formatPct(home?.over_2_5_pct ?? null)} away={formatPct(away?.over_2_5_pct ?? null)} values={[home?.over_2_5_pct, away?.over_2_5_pct]} max={100} />
        <Tile label={t("matches:seasonSummary.btts")} home={formatPct(home?.btts_pct ?? null)} away={formatPct(away?.btts_pct ?? null)} values={[home?.btts_pct, away?.btts_pct]} max={100} />
        <Tile label={t("matches:seasonSummary.cleanSheet")} home={formatPct(home?.clean_sheet_pct ?? null)} away={formatPct(away?.clean_sheet_pct ?? null)} values={[home?.clean_sheet_pct, away?.clean_sheet_pct]} max={100} />
      </div>
      <Link to={withQuery(ROUTES.standings, { [QUERY.league]: leagueParam({ code: league }) })} className="small">
        {t("matches:seasonSummary.fullTable")}
      </Link>
    </div>
  );
}
