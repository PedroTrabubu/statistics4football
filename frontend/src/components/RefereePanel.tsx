import { useMemo, useState } from "react";
import { getMatchRefereeStats } from "../api/client";
import type { Match, MatchResult, RefereeScope } from "../api/types";
import { formatSeason } from "../lib/format";
import {
  average,
  bookingPoints,
  cards,
  hitRate,
  streak,
  viewFrom,
  type TeamMatchView,
} from "../lib/markets";
import { refereeFacts, refereeFactText, type RefereeFact } from "../lib/patterns";
import { useApi } from "../lib/useApi";
import { ErrorView, LoadingView } from "./StatusView";
import { TeamCrest, TeamName } from "./TeamCrest";

type TeamScope = "all" | "venue";

/** Por debajo de esto el porcentaje es poco fiable: se muestra atenuado. */
const LOW_SAMPLE = 5;
/** Una racha de 1 no dice nada: solo se muestran a partir de aqui. */
const MIN_STREAK = 2;

type Pick = (v: TeamMatchView) => number | null;
type Hit = (v: TeamMatchView) => boolean | null;

const pointsFor: Pick = (v) => bookingPoints(v.statsFor);
const pointsAgainst: Pick = (v) => bookingPoints(v.statsAgainst);
const cardsFor: Pick = (v) => cards(v.statsFor);
const cardsAgainst: Pick = (v) => cards(v.statsAgainst);
const sum = (a: Pick, b: Pick): Pick => (v) => {
  const x = a(v);
  const y = b(v);
  return x === null || y === null ? null : x + y;
};
const pointsTotal = sum(pointsFor, pointsAgainst);
const cardsTotal = sum(cardsFor, cardsAgainst);

const over = (value: Pick, line: number): Hit => (v) => {
  const x = value(v);
  return x === null ? null : x > line;
};
/** "Cada equipo": los dos equipos por encima de la linea. */
const eachOver = (a: Pick, b: Pick, line: number): Hit => (v) => {
  const x = a(v);
  const y = b(v);
  return x === null || y === null ? null : x > line && y > line;
};

interface LineSection {
  title: string;
  lines: { label: string; hit: Hit }[];
}

const SECTIONS: LineSection[] = [
  {
    title: "Puntos de tarjeta del partido",
    lines: [15, 25, 35, 45, 55, 65].map((line) => ({ label: `Más de ${line}`, hit: over(pointsTotal, line) })),
  },
  {
    title: "Puntos de tarjeta de cada equipo",
    lines: [5, 15, 25].map((line) => ({
      label: `Más de ${line}`,
      hit: eachOver(pointsFor, pointsAgainst, line),
    })),
  },
  {
    title: "Tarjetas del partido",
    lines: [1.5, 2.5, 3.5, 4.5, 5.5, 6.5].map((line) => ({ label: `Más de ${line}`, hit: over(cardsTotal, line) })),
  },
  {
    title: "Tarjetas de cada equipo",
    lines: [0.5, 1.5, 2.5].map((line) => ({ label: `Más de ${line}`, hit: eachOver(cardsFor, cardsAgainst, line) })),
  },
];

interface Column {
  key: string;
  label: string;
  /** Columna de un equipo: su escudo va junto a la etiqueta. */
  team?: string;
  views: TeamMatchView[];
  /** El arbitro no tiene "a favor / en contra". */
  isReferee: boolean;
}

function teamViews(matches: MatchResult[], teamId: number, onlyVenue: "home" | "away" | null): TeamMatchView[] {
  return matches
    .map((m) => viewFrom(m, m.home_team_id === teamId ? "home" : "away"))
    .filter((v): v is TeamMatchView => v !== null && (onlyVenue === null || v.venue === onlyVenue));
}

/** Arbitro designado vs los dos equipos, solo con partidos anteriores a este:
 * primero los hechos concretos con cada equipo (tarjetas y faltas que se han
 * repetido) y, plegadas, las medias y los % de cada linea. `history`: la
 * liga, para descartar lo que pasa casi siempre. */
export function RefereePanel({ match, history }: { match: Match; history?: MatchResult[] | null }) {
  // Todas las temporadas por defecto: en una sola, el arbitro rara vez ha
  // pitado 3 partidos a un mismo equipo y no habria hechos que contar.
  const [refereeScope, setRefereeScope] = useState<RefereeScope>("all");
  const [teamScope, setTeamScope] = useState<TeamScope>("all");

  const { data, loading, error } = useApi(
    () => getMatchRefereeStats(match.id, refereeScope),
    [match.id, refereeScope],
  );
  const facts = useMemo(
    () => (data ? refereeFacts(match, data.referee_matches, { venueOnly: teamScope === "venue", history }) : []),
    [data, match, teamScope, history],
  );

  if (!match.referee) {
    return (
      <p className="muted">
        Árbitro aún no designado. Suele anunciarse 2 o 3 días antes del partido; aparecerá aquí en cuanto se
        sincronicen los partidos.
      </p>
    );
  }

  if (loading && !data) return <LoadingView label="Cargando estadísticas del árbitro..." />;
  if (error) return <ErrorView message={`No se pudieron cargar las estadísticas del árbitro: ${error}`} />;
  if (!data) return null;

  const venue = teamScope === "venue";
  const columns: Column[] = [
    {
      key: "referee",
      label: `Árbitro (${match.referee})`,
      views: data.referee_matches.map((m) => viewFrom(m, "home")).filter((v): v is TeamMatchView => v !== null),
      isReferee: true,
    },
    {
      key: "home",
      label: venue ? `${match.home_team} (local)` : match.home_team,
      team: match.home_team,
      views: teamViews(data.home_matches, match.home_team_id, venue ? "home" : null),
      isReferee: false,
    },
    {
      key: "away",
      label: venue ? `${match.away_team} (visitante)` : match.away_team,
      team: match.away_team,
      views: teamViews(data.away_matches, match.away_team_id, venue ? "away" : null),
      isReferee: false,
    },
  ];

  const averageRows: { label: string; pick: Pick; teamOnly: boolean; sub: boolean }[] = [
    { label: "Puntos de tarjeta", pick: pointsTotal, teamOnly: false, sub: false },
    { label: "A favor", pick: pointsFor, teamOnly: true, sub: true },
    { label: "En contra", pick: pointsAgainst, teamOnly: true, sub: true },
    { label: "Tarjetas", pick: cardsTotal, teamOnly: false, sub: false },
    { label: "A favor", pick: cardsFor, teamOnly: true, sub: true },
    { label: "En contra", pick: cardsAgainst, teamOnly: true, sub: true },
  ];

  const seasonLabel = formatSeason(match.season);
  const refereeSample = columns[0].views.length;

  return (
    <div className="referee-panel">
      <p className="referee-summary">
        <strong>{refereeSample}</strong> partido{refereeSample === 1 ? "" : "s"} anterior{refereeSample === 1 ? "" : "es"} de{" "}
        {match.referee} en {refereeScope === "season" ? `la temporada ${seasonLabel}` : "esta liga, todas las temporadas"}.
      </p>
      <div className="filters">
        <div className="tab-group" role="group" aria-label="Partidos del árbitro">
          <button
            type="button"
            className={refereeScope === "season" ? "tab-button tab-button-active" : "tab-button"}
            onClick={() => setRefereeScope("season")}
          >
            Árbitro: temporada {seasonLabel}
          </button>
          <button
            type="button"
            className={refereeScope === "all" ? "tab-button tab-button-active" : "tab-button"}
            onClick={() => setRefereeScope("all")}
          >
            Árbitro: todas las temporadas
          </button>
        </div>
        <div className="tab-group" role="group" aria-label="Partidos de los equipos">
          <button
            type="button"
            className={teamScope === "all" ? "tab-button tab-button-active" : "tab-button"}
            onClick={() => setTeamScope("all")}
          >
            Todos sus partidos
          </button>
          <button
            type="button"
            className={teamScope === "venue" ? "tab-button tab-button-active" : "tab-button"}
            onClick={() => setTeamScope("venue")}
          >
            Local / Visitante
          </button>
        </div>
      </div>

      {refereeSample < LOW_SAMPLE && (
        <p className="small muted intro-note">
          {refereeSample === 0
            ? `No hay partidos anteriores de ${match.referee} con datos en ${refereeScope === "season" ? `la temporada ${seasonLabel}` : "esta liga"}.`
            : `Solo ${refereeSample} partido${refereeSample === 1 ? "" : "s"} anterior${refereeSample === 1 ? "" : "es"} de ${match.referee}: muestra pequeña, tómalo como orientativo.`}
          {refereeScope === "season" && " Prueba con «todas las temporadas»."}
        </p>
      )}

      <RefereeFacts facts={facts} league={match.league_code} venueOnly={venue} />

      <details className="referee-details">
        <summary>Ver todas las medias y líneas del árbitro</summary>
        <div className="referee-tables">
          <div className="table-scroll">
            <table className="predictions-table referee-table">
              <caption>Medias por partido</caption>
              <thead>
                <tr>
                  <th></th>
                  {columns.map((c) => (
                    <th key={c.key} className="num">
                      <ColumnLabel column={c} league={match.league_code} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Partidos</td>
                  {columns.map((c) => (
                    <td key={c.key} className="num">
                      {c.views.length}
                    </td>
                  ))}
                </tr>
                {averageRows.map((row, i) => (
                  <tr key={i} className={row.sub ? "referee-sub" : "referee-group"}>
                    <td>{row.label}</td>
                    {columns.map((c) => {
                      const value = row.teamOnly && c.isReferee ? null : average(c.views, row.pick);
                      return (
                        <td key={c.key} className="num">
                          {value === null ? "" : value.toFixed(1)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="table-scroll">
            <table className="predictions-table referee-table">
              <caption>% de partidos que superan cada línea</caption>
              <thead>
                <tr>
                  <th></th>
                  {columns.map((c) => (
                    <th key={c.key}>
                      <ColumnLabel column={c} league={match.league_code} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SECTIONS.map((section) => [
                  <tr key={section.title} className="referee-section">
                    <td colSpan={columns.length + 1}>{section.title}</td>
                  </tr>,
                  ...section.lines.map((line) => (
                    <tr key={`${section.title}-${line.label}`}>
                      <td className="referee-line">{line.label}</td>
                      {columns.map((c) => (
                        <td key={c.key}>
                          <LineCell views={c.views} hit={line.hit} />
                        </td>
                      ))}
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        </div>

        <p className="small muted">
          Solo partidos anteriores a este. Los equipos, en la temporada {seasonLabel}. Puntos de tarjeta: amarilla =
          10, roja = 25 (aproximado: la fuente no distingue una roja directa de una segunda amarilla). «Cada equipo» =
          los dos equipos superan la línea. Racha = partidos seguidos, desde el más reciente, en los que se superó.
        </p>
      </details>
    </div>
  );
}

/** Lo que ya ha pasado con este arbitro en los partidos de cada equipo. */
function RefereeFacts({ facts, league, venueOnly }: { facts: RefereeFact[]; league: string; venueOnly: boolean }) {
  return (
    <div className="referee-facts">
      <h3>Con estos equipos</h3>
      {facts.length === 0 ? (
        <p className="muted">
          Este árbitro no tiene aún suficientes partidos con estos equipos para destacar patrones
          {venueOnly ? " jugando en el mismo campo que hoy" : ""}.
        </p>
      ) : (
        <ul className="referee-fact-list">
          {facts.map((fact) => (
            <li key={`${fact.side}-${fact.family}-${fact.option.key}`} className="referee-fact">
              <TeamCrest team={fact.team} league={league} />
              <div>
                <p className="referee-fact-text">{refereeFactText(fact)}</p>
                <p className="small muted referee-fact-meta">
                  {fact.smallSample && <span className="fact-small">Muestra pequeña: tómalo como orientativo.</span>}
                  {fact.refereeAverage && (
                    <span>
                      Media del árbitro en sus {fact.refereeAverage.matches} partidos: {fact.refereeAverage.value.toFixed(1)}{" "}
                      {fact.refereeAverage.label}.
                    </span>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ColumnLabel({ column, league }: { column: Column; league: string }) {
  if (!column.team) return <>{column.label}</>;
  return (
    <TeamName team={column.team} league={league}>
      {column.label}
    </TeamName>
  );
}

function LineCell({ views, hit }: { views: TeamMatchView[]; hit: Hit }) {
  const rate = hitRate(views, { hit });
  if (rate.pct === null) return <span className="muted">—</span>;

  const pct = Math.round(rate.pct * 100);
  const run = streak(views, hit);
  return (
    <div className={rate.total < LOW_SAMPLE ? "line-cell rate-low" : "line-cell"} title={`${rate.hits} de ${rate.total} partidos`}>
      <div className="line-bar">
        <div className="line-bar-fill" style={{ width: `${pct}%` }} />
        <span className="line-bar-label">{pct}%</span>
      </div>
      {run >= MIN_STREAK && <span className="line-streak">racha de {run}</span>}
    </div>
  );
}
