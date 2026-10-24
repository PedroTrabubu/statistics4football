import { useTranslation } from "react-i18next";
import { getLeagueMatchdays, getMatches } from "../api/client";
import type { Match } from "../api/types";
import { formatDateRange, formatKickoff, formatMatchday, joinParts } from "../lib/format";
import { nextPendingMatchday } from "../lib/matchdays";
import { useApi } from "../lib/useApi";
import { IconCompare } from "./icons";
import { ErrorView } from "./StatusView";
import { TeamName } from "./TeamCrest";

/** Mercados: botón que despliega los partidos de la siguiente jornada. Va en
 * la fila de filtros; el panel (NextMatchdayPanel), debajo. */
export function NextMatchdayToggle({
  open,
  panelId,
  onToggle,
}: {
  open: boolean;
  panelId: string;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="next-compare-toggle"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      onClick={onToggle}
    >
      <IconCompare aria-hidden="true" />
      <span>{t("markets:page.nextCompare.button")}</span>
      <span className="next-compare-chevron" aria-hidden="true" />
    </button>
  );
}

/** Clave de una pareja de equipos, sin importar el orden. */
const pairKey = (keys: string[]) => [...keys].sort().join("|");
const teamKeys = (match: Match): [string, string] => [String(match.home_team_id), String(match.away_team_id)];

/** Los partidos pendientes de la siguiente jornada de la liga: cada uno
 * compara a sus dos equipos (como marcar «Comparar» en las dos tarjetas). Se
 * piden al abrir el panel. `available`: equipos con tarjeta en la temporada
 * que se está viendo; un partido sin alguno de los dos no se puede comparar. */
export function NextMatchdayPanel({
  id,
  leagueId,
  leagueCode,
  available,
  picked,
  onCompare,
}: {
  id: string;
  leagueId: number | undefined;
  leagueCode: string;
  available: Set<string>;
  picked: string[];
  onCompare: (keys: string[]) => void;
}) {
  const { t } = useTranslation();
  const { data, loading, error } = useApi(async () => {
    if (leagueId === undefined) return null;
    const info = await getLeagueMatchdays(leagueId);
    const matchday = nextPendingMatchday(info);
    if (matchday === null || !info.season) return { leagueId, matchday, matches: [] as Match[] };
    const matches = await getMatches({ league_id: leagueId, season: info.season, matchday, limit: 50 });
    return {
      leagueId,
      matchday,
      matches: matches
        .filter((m) => m.status === "scheduled" && m.league_id === leagueId)
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }, [leagueId]);

  // Al cambiar de liga, hasta que llegue la nueva jornada no se enseña la anterior.
  const current = data && data.leagueId === leagueId ? data : null;
  const matches = current?.matches ?? [];
  const selected = picked.length === 2 ? pairKey(picked) : null;
  const dates =
    matches.length > 0 ? formatDateRange(matches[0].date, matches[matches.length - 1].date) : null;

  return (
    <section id={id} className="next-compare-panel" aria-label={t("markets:page.nextCompare.button")}>
      {loading && !current && <p className="small muted next-compare-status">{t("markets:page.nextCompare.loading")}</p>}
      {error && <ErrorView message={t("markets:page.nextCompare.error", { error })} />}
      {current && matches.length === 0 && (
        <p className="small muted next-compare-status">{t("markets:page.nextCompare.empty")}</p>
      )}
      {matches.length > 0 && (
        <>
          <div className="next-compare-head">
            <p className="next-compare-title">{joinParts(formatMatchday(current?.matchday, leagueCode), dates)}</p>
            <p className="small muted">{t("markets:page.nextCompare.hint")}</p>
          </div>
          <ul className="next-compare-list">
            {matches.map((match) => {
              const keys = teamKeys(match);
              const missing = [match.home_team, match.away_team].filter((_, i) => !available.has(keys[i]));
              const active = selected === pairKey(keys);
              return (
                <li key={match.id}>
                  <button
                    type="button"
                    className="next-compare-card"
                    aria-pressed={active}
                    disabled={missing.length > 0}
                    title={missing.length > 0 ? t("markets:page.nextCompare.noData", { team: missing.join(" / ") }) : undefined}
                    aria-label={t("markets:page.nextCompare.card", { home: match.home_team, away: match.away_team })}
                    onClick={() => onCompare(active ? [] : keys)}
                  >
                    <span className="next-compare-date">{formatKickoff(match.date)}</span>
                    <TeamName team={match.home_team} league={leagueCode} className="next-compare-team" />
                    <TeamName team={match.away_team} league={leagueCode} className="next-compare-team" />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
