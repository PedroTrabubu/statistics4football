import { useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { getMatchRefereeStats } from "../api/client";
import type { Match, MatchResult, RefereeScope } from "../api/types";
import { t } from "../i18n";
import { formatFixed, formatLine, formatSeason, withPercent } from "../lib/format";
import {
  average,
  bookingPoints,
  cards,
  hitRate,
  matchRedCards,
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

/** `key`: su titulo, en matches:referee.section. Cada linea, "Más de X". */
interface LineSection {
  key: string;
  lines: { line: number; hit: Hit }[];
}

const SECTIONS: LineSection[] = [
  {
    key: "pointsMatch",
    lines: [15, 25, 35, 45, 55, 65].map((line) => ({ line, hit: over(pointsTotal, line) })),
  },
  {
    key: "pointsEach",
    lines: [5, 15, 25].map((line) => ({
      line,
      hit: eachOver(pointsFor, pointsAgainst, line),
    })),
  },
  {
    key: "cardsMatch",
    lines: [1.5, 2.5, 3.5, 4.5, 5.5, 6.5].map((line) => ({ line, hit: over(cardsTotal, line) })),
  },
  {
    key: "cardsEach",
    lines: [0.5, 1.5, 2.5].map((line) => ({ line, hit: eachOver(cardsFor, cardsAgainst, line) })),
  },
  {
    key: "redsMatch",
    lines: [0.5, 1.5].map((line) => ({ line, hit: over(matchRedCards, line) })),
  },
];

const anyRed = over(matchRedCards, 0.5);

const overLabel = (line: number) => t("markets:option.over", { line: formatLine(line) });

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
  const { t } = useTranslation();
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
    return <p className="muted">{t("matches:referee.notDesignated")}</p>;
  }

  if (loading && !data) return <LoadingView label={t("matches:referee.loading")} />;
  if (error) return <ErrorView message={t("matches:referee.error", { error })} />;
  if (!data) return null;

  const venue = teamScope === "venue";
  const columns: Column[] = [
    {
      key: "referee",
      label: t("matches:referee.column.referee", { name: match.referee }),
      views: data.referee_matches.map((m) => viewFrom(m, "home")).filter((v): v is TeamMatchView => v !== null),
      isReferee: true,
    },
    {
      key: "home",
      label: venue ? t("matches:referee.column.home", { team: match.home_team }) : match.home_team,
      team: match.home_team,
      views: teamViews(data.home_matches, match.home_team_id, venue ? "home" : null),
      isReferee: false,
    },
    {
      key: "away",
      label: venue ? t("matches:referee.column.away", { team: match.away_team }) : match.away_team,
      team: match.away_team,
      views: teamViews(data.away_matches, match.away_team_id, venue ? "away" : null),
      isReferee: false,
    },
  ];

  const averageRows: { label: string; pick: Pick; teamOnly: boolean; sub: boolean }[] = [
    { label: t("matches:referee.average.bookingPoints"), pick: pointsTotal, teamOnly: false, sub: false },
    { label: t("matches:referee.average.for"), pick: pointsFor, teamOnly: true, sub: true },
    { label: t("matches:referee.average.against"), pick: pointsAgainst, teamOnly: true, sub: true },
    { label: t("matches:referee.average.cards"), pick: cardsTotal, teamOnly: false, sub: false },
    { label: t("matches:referee.average.for"), pick: cardsFor, teamOnly: true, sub: true },
    { label: t("matches:referee.average.against"), pick: cardsAgainst, teamOnly: true, sub: true },
    { label: t("matches:referee.average.redCards"), pick: matchRedCards, teamOnly: false, sub: false },
  ];

  const seasonLabel = formatSeason(match.season);
  const refereeSample = columns[0].views.length;

  return (
    <div className="referee-panel">
      <p className="referee-summary">
        <Trans
          i18nKey={refereeScope === "season" ? "matches:referee.summary.season" : "matches:referee.summary.all"}
          count={refereeSample}
          values={{ name: match.referee, season: seasonLabel }}
          components={{ bold: <strong /> }}
        />
      </p>
      <div className="filters">
        <div className="tab-group" role="group" aria-label={t("matches:referee.refereeScope")}>
          <button
            type="button"
            className={refereeScope === "season" ? "tab-button tab-button-active" : "tab-button"}
            onClick={() => setRefereeScope("season")}
          >
            {t("matches:referee.scopeSeason", { season: seasonLabel })}
          </button>
          <button
            type="button"
            className={refereeScope === "all" ? "tab-button tab-button-active" : "tab-button"}
            onClick={() => setRefereeScope("all")}
          >
            {t("matches:referee.scopeAll")}
          </button>
        </div>
        <div className="tab-group" role="group" aria-label={t("matches:referee.teamScope")}>
          <button
            type="button"
            className={teamScope === "all" ? "tab-button tab-button-active" : "tab-button"}
            onClick={() => setTeamScope("all")}
          >
            {t("matches:referee.teamAll")}
          </button>
          <button
            type="button"
            className={teamScope === "venue" ? "tab-button tab-button-active" : "tab-button"}
            onClick={() => setTeamScope("venue")}
          >
            {t("matches:referee.teamVenue")}
          </button>
        </div>
      </div>

      {refereeSample < LOW_SAMPLE && (
        <p className="small muted intro-note">
          {refereeSample === 0
            ? t(refereeScope === "season" ? "matches:referee.noneSeason" : "matches:referee.noneLeague", {
                name: match.referee,
                season: seasonLabel,
              })
            : t("matches:referee.few", { count: refereeSample, name: match.referee })}
          {refereeScope === "season" && ` ${t("matches:referee.tryAllSeasons")}`}
        </p>
      )}

      <RefereeExtras views={columns[0].views} history={history ?? null} />

      <RefereeFacts facts={facts} league={match.league_code} venueOnly={venue} />

      <details className="referee-details">
        <summary>{t("matches:referee.details")}</summary>
        <div className="referee-tables">
          <div className="table-scroll">
            <table className="predictions-table referee-table">
              <caption>{t("matches:referee.averagesCaption")}</caption>
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
                  <td>{t("matches:referee.matches")}</td>
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
                          {value === null ? "" : formatFixed(value, 1)}
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
              <caption>{t("matches:referee.linesCaption")}</caption>
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
                  <tr key={section.key} className="referee-section">
                    <td colSpan={columns.length + 1}>{t(`matches:referee.section.${section.key}`)}</td>
                  </tr>,
                  ...section.lines.map((line) => (
                    <tr key={`${section.key}-${line.line}`}>
                      <td className="referee-line">{overLabel(line.line)}</td>
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

        <p className="small muted">{t("matches:referee.footnote", { season: seasonLabel })}</p>
      </details>
    </div>
  );
}

/** Expulsiones con este árbitro, junto a lo habitual en la liga (`history`).
 * Suceso raro: se da siempre con su muestra. */
function RefereeExtras({ views, history }: { views: TeamMatchView[]; history: MatchResult[] | null }) {
  const { t } = useTranslation();
  const leagueViews = (history ?? []).map((m) => viewFrom(m, "home")).filter((v): v is TeamMatchView => v !== null);
  const reds = hitRate(views, { hit: anyRed });
  const leagueReds = hitRate(leagueViews, { hit: anyRed });
  const pct = (x: number) => withPercent(String(Math.round(x * 100)));
  if (reds.pct === null) return null;

  return (
    <p className="referee-extras small">
      <Trans
        i18nKey="matches:referee.extras.reds"
        count={reds.total}
        values={{ hits: reds.hits, pct: pct(reds.pct) }}
        components={{ bold: <strong /> }}
      />
      {leagueReds.pct !== null && (
        <span className="muted"> · {t("matches:referee.extras.league", { value: pct(leagueReds.pct) })}</span>
      )}
    </p>
  );
}

/** Lo que ya ha pasado con este arbitro en los partidos de cada equipo. */
function RefereeFacts({ facts, league, venueOnly }: { facts: RefereeFact[]; league: string; venueOnly: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="referee-facts">
      <h3>{t("matches:referee.factsTitle")}</h3>
      {facts.length === 0 ? (
        <p className="muted">{t(venueOnly ? "matches:referee.factsNoneVenue" : "matches:referee.factsNone")}</p>
      ) : (
        <ul className="referee-fact-list">
          {facts.map((fact) => (
            <li key={`${fact.side}-${fact.family}-${fact.option.key}`} className="referee-fact">
              <TeamCrest team={fact.team} league={league} />
              <div>
                <p className="referee-fact-text">{refereeFactText(fact)}</p>
                <p className="small muted referee-fact-meta">
                  {fact.smallSample && <span className="fact-small">{t("matches:referee.smallSample")}</span>}
                  {fact.refereeAverage && (
                    <span>
                      {t("matches:referee.refereeAverage", {
                        count: fact.refereeAverage.matches,
                        value: formatFixed(fact.refereeAverage.value, 1),
                        label: fact.refereeAverage.label,
                      })}
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
  const { t } = useTranslation();
  const rate = hitRate(views, { hit });
  if (rate.pct === null) return <span className="muted">—</span>;

  const pct = Math.round(rate.pct * 100);
  const run = streak(views, hit);
  return (
    <div className={rate.total < LOW_SAMPLE ? "line-cell rate-low" : "line-cell"} title={t("matches:referee.lineTitle", { hits: rate.hits, count: rate.total })}>
      <div className="line-bar">
        <div className="line-bar-fill" style={{ width: `${pct}%` }} />
        <span className="line-bar-label">{withPercent(String(pct))}</span>
      </div>
      {run >= MIN_STREAK && <span className="line-streak">{t("matches:referee.streak", { n: run })}</span>}
    </div>
  );
}
