import { useCallback, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getLeagueResultProbabilities, getLeagueResults, getMatchResultProbabilities } from "../api/client";
import type { CalibrationBin, Match, Rate, ResultProbabilities, ResultSummary } from "../api/types";
import { formatFixed, formatPct, formatPercent, formatSeason } from "../lib/format";
import { leagueName } from "../lib/leagues";
import { wilsonLower, wilsonUpper } from "../lib/patterns";
import {
  bestDoubleChance,
  DOUBLE_CHANCES,
  doubleChanceHit,
  doubleChances,
  HIGH_CONFIDENCE,
  type HitCount,
  OUTCOMES,
  type Outcome,
  outcomeOf,
  roundTo100,
  type SeasonHits,
  teamHitTable,
} from "../lib/resultProbabilities";
import { useApi } from "../lib/useApi";
import { InfoTip } from "./InfoTip";
import { ErrorView, LoadingView } from "./StatusView";
import { TeamName } from "./TeamCrest";

/** Equipos con menos partidos en la tabla de aciertos: en gris, orientativos. */
const MIN_TEAM_MATCHES = 5;

const seasonsRange = (seasons: string[]) =>
  seasons.length > 1 ? `${formatSeason(seasons[0])}–${formatSeason(seasons[seasons.length - 1])}` : formatSeason(seasons[0] ?? "");
const approxPct = (rate: number | null) => (rate === null ? "—" : formatPct(Math.round(rate * 100), 0));

/** Porcentajes de resultado en una caja propia, justo tras los accesos de la
 * ficha: 1X2 de la media de Elo y Dixon-Coles calibrados (sin mercado) con una barra de local a
 * visitante y, debajo, la doble oportunidad, que es su suma. Sin verde ni rojo
 * salvo para acierto/fallo de un partido jugado. Las cifras ya vienen
 * guardadas: la API no calcula nada al pedirlas. */
export function WinProbability({ match }: { match: Match }) {
  const { t } = useTranslation();
  const { data, error } = useApi(() => getMatchResultProbabilities(match.id), [match.id]);
  const played = match.status === "historical" && match.home_goals !== null && match.away_goals !== null;
  const actual = played ? outcomeOf(match.home_goals!, match.away_goals!) : null;

  return (
    <section className="detail-section win-prob" id="porcentajes" aria-labelledby="win-prob-title">
      <div className="win-prob-head">
        <h2 id="win-prob-title" className="win-prob-title">
          {t(played ? "matches:winProb.titlePlayed" : "matches:winProb.title")}
        </h2>
        <span className="win-prob-source">
          {/* La versión que se usó: Elo + Dixon-Coles, o solo Elo (la anterior, o sin Dixon-Coles en esa liga). */}
          {t(data?.prediction.version === "elo_calibrado_v1" ? "matches:winProb.sourceElo" : "matches:winProb.sourceEloDc")}
        </span>
      </div>

      {error ? (
        <p className="win-prob-empty">{t("matches:winProb.error")}</p>
      ) : !data ? (
        <p className="win-prob-empty">{t("matches:winProb.loading")}</p>
      ) : data.prediction.status !== "ok" ? (
        <p className="win-prob-empty">{t(`matches:winProb.status.${data.prediction.status}`)}</p>
      ) : (
        <Probabilities match={match} prediction={data.prediction} summary={data.summary} actual={actual} />
      )}

      {data?.summary?.league && <ResultPanels match={match} summary={data.summary} />}
      <p className="win-prob-note">{t("matches:winProb.note")}</p>
    </section>
  );
}

function Probabilities({
  match,
  prediction,
  summary,
  actual,
}: {
  match: Match;
  prediction: ResultProbabilities;
  summary: ResultSummary | null;
  actual: Outcome | null;
}) {
  const { t } = useTranslation();
  const probs = [prediction.p_home!, prediction.p_draw!, prediction.p_away!];
  const pct = roundTo100(probs);
  const top = probs.indexOf(Math.max(...probs));
  // Doble oportunidad: con los porcentajes ya redondeados, para que cuadre a la vista con el 1X2.
  const dcPct = doubleChances(pct);
  const dcProb = doubleChances(probs);
  const best = bestDoubleChance(probs);
  const label = (o: Outcome) =>
    o === "draw" ? t("matches:winProb.draw") : t("matches:winProb.win", { team: o === "home" ? match.home_team : match.away_team });

  return (
    <>
      <div className="win-prob-nums" style={{ gridTemplateColumns: pct.map((v) => `${Math.max(v, 12)}fr`).join(" ") }}>
        {OUTCOMES.map((o, i) => (
          <div key={o} className={`win-prob-num is-${o}${i === top ? " is-top" : ""}`}>
            <span className="win-prob-pct">
              {pct[i]}
              <small>%</small>
            </span>
            <span className="win-prob-label">
              {label(o)}
              {i === top && actual && <Mark hit={actual === o} />}
              {actual === o && <span className="win-prob-actual">{t("matches:winProb.actual")}</span>}
            </span>
          </div>
        ))}
      </div>
      <div
        className="win-prob-bar"
        style={{ gridTemplateColumns: pct.map((v) => `${Math.max(v, 1)}fr`).join(" ") }}
        role="img"
        aria-label={OUTCOMES.map((o, i) => `${label(o)}: ${formatPct(pct[i], 0)}`).join(", ")}
      >
        {OUTCOMES.map((o) => (
          <span key={o} className={`win-prob-seg is-${o}`} />
        ))}
      </div>

      <h3 className="win-prob-subtitle">{t("matches:winProb.doubleTitle")}</h3>
      <ul className="win-prob-dc">
        {DOUBLE_CHANCES.map((dc, i) => (
          <li key={dc} className={i === best ? "win-prob-dc-row is-best" : "win-prob-dc-row"}>
            <span className="win-prob-dc-label">
              <b>{dc}</b> {t(`matches:winProb.dc${dc}`, { home: match.home_team, away: match.away_team })}
              {i === best && dcProb[i] >= HIGH_CONFIDENCE && <HighConfidenceChip summary={summary} />}
              {i === best && actual && <Mark hit={doubleChanceHit(dc, actual)} />}
            </span>
            <span className="win-prob-dc-track" aria-hidden="true">
              <span className="win-prob-dc-fill" style={{ width: `${dcPct[i]}%` }} />
            </span>
            <span className="win-prob-dc-pct">{formatPct(dcPct[i], 0)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Aciertos de una temporada de la liga (por equipo, de la liga y la
 * referencia de siempre 1X). */
type LoadSeason = (season: string) => Promise<SeasonHits>;

type Panel = "history" | "table";

/** Dos botones bajo los porcentajes: el acierto histórico de la liga y la
 * tabla de aciertos por equipo. Cada uno abre su panel (y lo cierra al
 * pulsarlo otra vez). La tabla solo se pide la primera vez que se abre. */
function ResultPanels({ match, summary }: { match: Match; summary: ResultSummary }) {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [historySeen, setHistorySeen] = useState(false);
  const [tableSeen, setTableSeen] = useState(false);
  const baseId = useId();
  // Cada temporada se pide una vez: la comparten el acierto de la liga y la tabla.
  const cache = useRef(new Map<string, Promise<SeasonHits>>());
  const loadSeason = useCallback<LoadSeason>(
    (season) => {
      let promise = cache.current.get(season);
      if (!promise) {
        promise = Promise.all([
          getLeagueResultProbabilities(match.league_id, season),
          getLeagueResults(match.league_id, season),
        ]).then(([probabilities, results]) => teamHitTable(probabilities.predictions, results));
        promise.catch(() => cache.current.delete(season));
        cache.current.set(season, promise);
      }
      return promise;
    },
    [match.league_id],
  );
  const toggle = (next: Panel) => {
    if (next === "history") setHistorySeen(true);
    if (next === "table") setTableSeen(true);
    setPanel((current) => (current === next ? null : next));
  };
  const button = (key: Panel, text: string) => (
    <button
      type="button"
      className={panel === key ? "tab-button tab-button-active" : "tab-button"}
      aria-expanded={panel === key}
      aria-controls={`${baseId}-${key}`}
      onClick={() => toggle(key)}
    >
      {text}
    </button>
  );

  return (
    <div className="win-prob-panels">
      <div className="tab-group win-prob-panels-nav">
        {button("history", t("matches:winProb.historyButton"))}
        {button("table", t("matches:winProb.tableButton"))}
      </div>
      <div id={`${baseId}-history`} hidden={panel !== "history"}>
        {historySeen && <History match={match} summary={summary} loadSeason={loadSeason} />}
      </div>
      <div id={`${baseId}-table`} hidden={panel !== "table"}>
        {tableSeen && <TeamHitsTable match={match} loadSeason={loadSeason} />}
      </div>
    </div>
  );
}

type SortKey = "double" | "top";

/** Aciertos por equipo en la temporada del partido: en cada partido jugado,
 * si se cumplió el resultado más probable y la mejor doble oportunidad. Con
 * la forma de la tabla de aciertos de Picks probables. */
function TeamHitsTable({ match, loadSeason }: { match: Match; loadSeason: LoadSeason }) {
  const { t } = useTranslation();
  const [sortKey, setSortKey] = useState<SortKey>("double");
  const data = useApi(() => loadSeason(match.season), [loadSeason, match.season]);

  const ranked = useMemo(() => {
    if (!data.data) return [];
    const rate = (c: HitCount) => (c.n ? c.hits / c.n : 0);
    const other: SortKey = sortKey === "double" ? "top" : "double";
    return [...data.data.teams].sort(
      (a, b) => rate(b[sortKey]) - rate(a[sortKey]) || rate(b[other]) - rate(a[other]) || b[sortKey].n - a[sortKey].n,
    );
  }, [data.data, sortKey]);

  if (data.loading) return <LoadingView label={t("matches:winProb.table.loading")} />;
  if (data.error) return <ErrorView message={t("matches:winProb.table.error")} />;
  if (!data.data || ranked.length === 0) return <p className="win-prob-empty">{t("matches:winProb.table.empty")}</p>;

  const columns: { key: SortKey; text: string }[] = [
    { key: "top", text: "top" },
    { key: "double", text: "double" },
  ];

  return (
    <div className="win-prob-table">
      <h3 className="win-prob-subtitle">
        {t("matches:winProb.table.title", { league: leagueName(match.league_code), season: formatSeason(match.season) })}
      </h3>
      <p className="small muted">{t("matches:winProb.table.note", { n: MIN_TEAM_MATCHES })}</p>
      <div className="table-scroll">
        <table className="predictions-table team-ranking-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>{t("matches:winProb.table.team")}</th>
              {columns.map(({ key, text }) => (
                <th
                  key={key}
                  className={sortKey === key ? "num sortable sorted" : "num sortable"}
                  aria-sort={sortKey === key ? "descending" : "none"}
                >
                  <button type="button" onClick={() => setSortKey(key)}>
                    <span className="label-long">{t(`matches:winProb.table.${text}`)}</span>
                    <span className="label-short">{t(`matches:winProb.table.${text}Short`)}</span>
                    <span className="sort-arrow">{sortKey === key ? "▼" : ""}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.map((team, i) => {
              const classes = [];
              if (team.double.n < MIN_TEAM_MATCHES) classes.push("team-ranking-small");
              if (team.team === match.home_team || team.team === match.away_team) classes.push("is-current");
              return (
                <tr key={team.team} className={classes.join(" ") || undefined}>
                  <td className="num muted">{i + 1}</td>
                  <td>
                    <TeamName team={team.team} league={match.league_code} />
                  </td>
                  {columns.map(({ key }) => (
                    <td key={key} className={sortKey === key ? "num sorted" : "num"}>
                      <HitsCell count={team[key]} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="win-prob-table-league">
              <td />
              <td>{t("matches:winProb.table.league")}</td>
              {columns.map(({ key }) => (
                <td key={key} className="num">
                  <HitsCell count={data.data!.league[key]} />
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** "79 %" y debajo "11 de 14"; el intervalo de confianza, al pasar por encima. */
function HitsCell({ count }: { count: HitCount }) {
  const { t } = useTranslation();
  if (count.n === 0) return <span className="muted">—</span>;
  const pct = (x: number) => formatPct(Math.round(x * 100), 0);
  return (
    <span
      className="rate-cell"
      title={t("matches:winProb.table.interval", {
        low: pct(wilsonLower(count.hits, count.n)),
        high: pct(wilsonUpper(count.hits, count.n)),
      })}
    >
      <strong>{pct(count.hits / count.n)}</strong>
      <span className="small muted rate-n-long">{t("matches:winProb.table.hitsOf", { hits: count.hits, n: count.n })}</span>
      <span className="small muted rate-n-short">
        {count.hits}/{count.n}
      </span>
    </span>
  );
}

/** ✓/✗ de un partido jugado: verde o rojo, con el símbolo y su texto para el lector de pantalla. */
function Mark({ hit }: { hit: boolean }) {
  const { t } = useTranslation();
  return (
    <span className={`win-prob-mark ${hit ? "is-hit" : "is-miss"}`}>
      <span aria-hidden="true">{hit ? "✓" : "✗"}</span>
      <span className="visually-hidden">{t(hit ? "matches:winProb.hit" : "matches:winProb.miss")}</span>
    </span>
  );
}

/** "Alta confianza" (solo doble oportunidad, ≥ 0,80), con lo que acertó ese nivel en el histórico. */
function HighConfidenceChip({ summary }: { summary: ResultSummary | null }) {
  const { t } = useTranslation();
  const dev = summary?.high_confidence_dev;
  const current = summary?.high_confidence_current;
  const coverages = [dev?.coverage, current?.coverage].filter((c): c is number => c != null);
  return (
    <span className="win-prob-chip">
      {t("matches:winProb.highConfidence")}
      {summary && dev && (
        <InfoTip label={t("matches:winProb.highConfidenceLabel")}>
          <span>
            {t("matches:winProb.highConfidenceTip", {
              seasons: seasonsRange(summary.dev_seasons),
              low: approxPct(dev.bin_80_85.rate),
              high: approxPct(dev.bin_85.rate),
            })}
          </span>
          {current && summary.current_season && current.bin_85.n > 0 && (
            <span>
              {t("matches:winProb.highConfidenceCurrent", {
                season: formatSeason(summary.current_season),
                pct: approxPct(current.bin_85.rate),
              })}
            </span>
          )}
          {coverages.length > 0 && (
            <span>
              {t("matches:winProb.highConfidenceCoverage", {
                min: approxPct(Math.min(...coverages)),
                max: approxPct(Math.max(...coverages)),
              })}
            </span>
          )}
        </InfoTip>
      )}
    </span>
  );
}

function RateLine({ rate }: { rate: Rate }) {
  const { t } = useTranslation();
  return (
    <>
      <b>{formatPercent(rate.rate, 1)}</b>
      {t("matches:winProb.historyRate", {
        count: rate.n,
        hits: formatFixed(rate.hits, 0),
        n: formatFixed(rate.n, 0),
        low: formatPercent(rate.low, 1),
        high: formatPercent(rate.high, 1),
      })}
    </>
  );
}

/** Aciertos contados en la web -> la misma forma que los del resumen de la API. */
function toRate({ hits, n }: HitCount): Rate {
  return n === 0
    ? { n, hits, rate: null, low: null, high: null }
    : { n, hits, rate: hits / n, low: wilsonLower(hits, n), high: wilsonUpper(hits, n) };
}

/** "Histórico" en el selector de temporada del acierto de la liga. */
const ALL_SEASONS = "all";

/** Acierto de la liga por temporada (de primeras, la del partido) o en todo
 * el histórico, y la calibración por tramos (las 6 ligas). Una temporada se
 * cuenta en la web con los partidos jugados y sus porcentajes; el histórico
 * es el del resumen de la API. */
function History({ match, summary, loadSeason }: { match: Match; summary: ResultSummary; loadSeason: LoadSeason }) {
  const { t } = useTranslation();
  const league = summary.league!;
  const seasons = [...new Set([match.season, ...league.seasons])].sort().reverse();
  const [season, setSeason] = useState(match.season);
  const all = season === ALL_SEASONS;
  const data = useApi(() => (all ? Promise.resolve(null) : loadSeason(season)), [loadSeason, season]);
  const rates = all
    ? { top: league.top, double: league.double, always1x: league.always_1x }
    : data.data && {
        top: toRate(data.data.league.top),
        double: toRate(data.data.league.double),
        always1x: toRate(data.data.always1x),
      };
  const seasonLabel = (s: string) =>
    s === summary.current_season
      ? t("matches:winProb.historySeasonCurrent", { season: formatSeason(s) })
      : t("matches:winProb.historySeason", { season: formatSeason(s) });

  return (
    <div className="win-prob-history">
      <div className="win-prob-history-head">
        <h3 className="win-prob-subtitle">
          {all
            ? t("matches:winProb.historyTitle", { league: leagueName(league.league), seasons: seasonsRange(league.seasons) })
            : t("matches:winProb.historySeasonTitle", { league: leagueName(league.league), season: formatSeason(season) })}
        </h3>
        <select
          className="win-prob-season"
          aria-label={t("matches:winProb.historySelect")}
          value={season}
          onChange={(event) => setSeason(event.target.value)}
        >
          {seasons.map((s) => (
            <option key={s} value={s}>
              {seasonLabel(s)}
            </option>
          ))}
          <option value={ALL_SEASONS}>{t("matches:winProb.historyAll", { seasons: seasonsRange(league.seasons) })}</option>
        </select>
      </div>

      {!all && data.error ? (
        <ErrorView message={t("matches:winProb.historyError")} />
      ) : !rates || (!all && data.loading) ? (
        <LoadingView label={t("matches:winProb.historyLoading")} />
      ) : rates.top.n === 0 ? (
        <p className="win-prob-empty">{t("matches:winProb.historyEmpty")}</p>
      ) : (
        <>
          <dl className="win-prob-rates">
            <div>
              <dt>{t("matches:winProb.historyTop")}</dt>
              <dd>
                <RateLine rate={rates.top} />
              </dd>
            </div>
            <div>
              <dt>{t("matches:winProb.historyDouble")}</dt>
              <dd>
                <RateLine rate={rates.double} />
              </dd>
            </div>
          </dl>
          <p className="win-prob-ref">{t("matches:winProb.historyRef", { pct: formatPercent(rates.always1x.rate, 1) })}</p>
        </>
      )}

      <details className="win-prob-cal">
        <summary>{t("matches:winProb.calibrationTitle")}</summary>
        <p>{t("matches:winProb.calibrationIntro")}</p>
        <div className="win-prob-cal-tables">
          <CalibrationTable
            caption={t("matches:winProb.calibrationDev", { seasons: seasonsRange(summary.dev_seasons) })}
            bins={summary.calibration_dev}
            lowSample={summary.low_sample_bin}
          />
          {summary.current_season && summary.calibration_current.length > 0 && (
            <CalibrationTable
              caption={t("matches:winProb.calibrationCurrent", { season: formatSeason(summary.current_season) })}
              bins={summary.calibration_current}
              lowSample={summary.low_sample_bin}
            />
          )}
        </div>
      </details>
    </div>
  );
}

function CalibrationTable({ caption, bins, lowSample }: { caption: string; bins: CalibrationBin[]; lowSample: number }) {
  const { t } = useTranslation();
  return (
    <table className="win-prob-cal-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{t("matches:winProb.calibrationBin")}</th>
          <th scope="col">{t("matches:winProb.calibrationAnnounced")}</th>
          <th scope="col">{t("matches:winProb.calibrationObserved")}</th>
          <th scope="col">{t("matches:winProb.calibrationN")}</th>
        </tr>
      </thead>
      <tbody>
        {bins.map((b) => (
          <tr key={b.low}>
            <th scope="row">
              {formatPct(Math.round(b.low * 100), 0)}–{formatPct(Math.round(b.high * 100), 0)}
            </th>
            <td>{formatPercent(b.mean_p, 1)}</td>
            <td>
              {formatPercent(b.observed, 1)}{" "}
              <span className="win-prob-ci">
                [{formatPercent(b.ci_low, 1)}; {formatPercent(b.ci_high, 1)}]
              </span>
            </td>
            <td>
              {formatFixed(b.n, 0)}
              {b.n < lowSample && <span className="win-prob-low">{t("matches:winProb.lowSample")}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
