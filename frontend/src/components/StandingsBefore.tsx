import { Fragment, useId } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { getLeagueResults } from "../api/client";
import type { Match, MatchResult } from "../api/types";
import { leagueName, leagueParam } from "../lib/leagues";
import { QUERY, ROUTES, withQuery } from "../lib/routes";
import { useApi } from "../lib/useApi";
import { compareStandings } from "../lib/standings";
import { ErrorView, LoadingView } from "./StatusView";
import { TeamName } from "./TeamCrest";

/** Filas que se enseñan por encima y por debajo de cada equipo del partido. */
const NEIGHBOURS = 2;

interface StandingRow {
  id: number;
  team: string;
  played: number;
  points: number;
  goals_for: number;
  goals_against: number;
}

/** Clasificación antes del partido, de los resultados publicados de su
 * temporada: solo los de jornadas anteriores jugados antes que él (ni este
 * partido ni los posteriores). Se ordena como en la página de clasificación;
 * los equipos sin partidos aún, al final y sin puesto. */
function standingsBefore(match: Match, results: MatchResult[]): StandingRow[] {
  const rows = new Map<number, StandingRow>();
  const rowOf = (id: number, team: string) => {
    let row = rows.get(id);
    if (!row) rows.set(id, (row = { id, team, played: 0, points: 0, goals_for: 0, goals_against: 0 }));
    return row;
  };
  const add = (row: StandingRow, scored: number, conceded: number) => {
    row.played += 1;
    row.goals_for += scored;
    row.goals_against += conceded;
    row.points += scored > conceded ? 3 : scored === conceded ? 1 : 0;
  };
  const kickoff = Date.parse(match.date);
  rowOf(match.home_team_id, match.home_team);
  rowOf(match.away_team_id, match.away_team);
  for (const r of results) {
    // Todos los equipos de la temporada, aunque aún no hayan jugado.
    const home = rowOf(r.home_team_id, r.home_team);
    const away = rowOf(r.away_team_id, r.away_team);
    if (r.home_goals === null || r.away_goals === null || r.matchday === null || match.matchday === null) continue;
    if (r.matchday >= match.matchday || Date.parse(r.date) >= kickoff) continue;
    add(home, r.home_goals, r.away_goals);
    add(away, r.away_goals, r.home_goals);
  }
  const byName = (a: StandingRow, b: StandingRow) => a.team.localeCompare(b.team);
  const all = [...rows.values()];
  return [
    ...all.filter((r) => r.played > 0).sort((a, b) => compareStandings(a, b) || byName(a, b)),
    ...all.filter((r) => r.played === 0).sort(byName),
  ];
}

/** Tramos de la tabla que se enseñan: cada equipo con sus vecinos; los que
 * se solapan o se tocan, unidos. Índices de inicio y fin, ambos incluidos. */
function standingsExcerpt(total: number, focus: number[], around = NEIGHBOURS): [number, number][] {
  const spans = focus
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)
    .map((i): [number, number] => [Math.max(0, i - around), Math.min(total - 1, i + around)]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1] + 1) last[1] = Math.max(last[1], span[1]);
    else merged.push(span);
  }
  return merged;
}

/** Clasificación de la liga antes del partido, en corto: los dos equipos y
 * sus vecinos. Solo en competiciones con una tabla única (la ficha la oculta
 * en las demás). */
export function StandingsBefore({ match }: { match: Match }) {
  const { t } = useTranslation();
  const titleId = useId();
  const { data, loading, error } = useApi(
    () => getLeagueResults(match.league_id, match.season),
    [match.league_id, match.season],
  );
  const rows = data ? standingsBefore(match, data) : null;
  const ranked = rows?.filter((r) => r.played > 0).length ?? 0;
  const mine = (r: StandingRow) => r.id === match.home_team_id || r.id === match.away_team_id;
  const spans = rows ? standingsExcerpt(rows.length, rows.flatMap((r, i) => (mine(r) ? [i] : []))) : [];
  const previous = (match.matchday ?? 1) - 1;
  const columns = [
    { key: "played", value: (r: StandingRow) => r.played },
    {
      key: "goalDifference",
      value: (r: StandingRow) => {
        const dg = r.goals_for - r.goals_against;
        return dg > 0 ? `+${dg}` : dg;
      },
    },
    { key: "points", value: (r: StandingRow) => <strong>{r.points}</strong> },
  ];

  return (
    <section className="detail-section" id="clasificacion" aria-labelledby={titleId}>
      <h2 id={titleId}>{t("matches:standings.title")}</h2>
      {previous > 0 && <p className="small muted">{t("matches:standings.note", { n: previous })}</p>}

      {loading && !data && <LoadingView label={t("matches:standings.loading")} />}
      {error && <ErrorView message={t("matches:standings.error", { error })} />}
      {rows && ranked === 0 && <p className="muted">{t("matches:standings.noneYet")}</p>}

      {rows && ranked > 0 && (
        <div className="win-prob-table">
          <div className="table-scroll">
            <table className="predictions-table team-ranking-table">
              <caption className="visually-hidden">
                {t("matches:standings.caption", { league: leagueName(match.league_code), n: previous })}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="num">
                    #
                  </th>
                  <th scope="col">{t("standings:team")}</th>
                  {columns.map(({ key }) => (
                    <th key={key} scope="col" className="num">
                      <abbr title={t(`standings:column.${key}.title`)}>{t(`standings:column.${key}.label`)}</abbr>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {spans.map(([start, end], s) => (
                  <Fragment key={start}>
                    {s > 0 && (
                      <tr>
                        <td colSpan={2 + columns.length} className="muted">
                          <span aria-hidden="true">…</span>
                          <span className="visually-hidden">
                            {t("matches:standings.omitted", { count: start - spans[s - 1][1] - 1 })}
                          </span>
                        </td>
                      </tr>
                    )}
                    {rows.slice(start, end + 1).map((row, i) => (
                      <tr key={row.id} className={mine(row) ? "is-current" : undefined}>
                        <td className="num muted">{row.played > 0 ? start + i + 1 : "—"}</td>
                        <td>
                          <TeamName team={row.team} league={match.league_code} />
                          {mine(row) && <span className="visually-hidden"> {t("matches:standings.thisMatch")}</span>}
                        </td>
                        {row.played > 0 ? (
                          columns.map(({ key, value }) => (
                            <td key={key} className="num">
                              {value(row)}
                            </td>
                          ))
                        ) : (
                          <td colSpan={columns.length} className="num muted">
                            {t("matches:standings.noMatchesYet")}
                          </td>
                        )}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="small">
        <Link to={withQuery(ROUTES.standings, { [QUERY.league]: leagueParam({ code: match.league_code }) })}>
          {t("matches:standings.full")}
        </Link>
      </p>
    </section>
  );
}
