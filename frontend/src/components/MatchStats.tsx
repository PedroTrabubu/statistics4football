import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Match, MatchHistory, MatchResult } from "../api/types";
import { currentLocale } from "../i18n";
import { formatFixed, formatSeason, withPercent } from "../lib/format";
import { sampleTier } from "../lib/sampleLevel";
import {
  CARD_KEYS,
  EVALUATION,
  EVALUATION_MATCHES,
  EVALUATION_SEASONS,
  MODEL,
  predictStats,
  STAT_KEYS,
  statValue,
  type CardKey,
  type Forecast,
  type StatKey,
} from "../lib/statsPredictor";
import { CompareRow, CompareTable } from "./CompareRows";
import { ErrorView, LoadingView } from "./StatusView";

/** Decimales de cada cifra: el xG, con dos; el resto de estimaciones, con una. */
const DIGITS: Record<StatKey, number> = {
  xg: 2,
  shots: 1,
  shots_on_target: 1,
  corners: 1,
  fouls: 1,
  yellow_cards: 1,
  red_cards: 2,
};

type Forecasts = Record<StatKey, Forecast | null>;

/** Totales del partido (los dos equipos sumados): lo que se mira para más/menos. Sin el xG ni las rojas. */
const isTotal = (key: StatKey) => key !== "xg" && key !== "red_cards";

/** Las estadísticas que da el predictor: las que pasaron su evaluación y tienen estimación. */
const predicted = (forecasts: Forecasts | null) => STAT_KEYS.filter((key) => EVALUATION[key].shown && forecasts?.[key]);

/** Botón que abre o cierra lo del predictor (`controls`: lo que muestra). */
function PredictorToggle({ open, controls, label, onToggle }: { open: boolean; controls: string; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="next-compare-toggle"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      onClick={onToggle}
    >
      <span>{label}</span>
      <span className="next-compare-chevron" aria-hidden="true" />
    </button>
  );
}

/** Nombre de la estadística con el error medio del predictor en ella. */
function PredictedLabel({ statKey }: { statKey: StatKey }) {
  const { t } = useTranslation();
  return (
    <>
      {t(`matches:matchStats.stat.${statKey}`)}
      <span className="predictor-error" title={t("matches:predictor.errorTitle")}>
        {t("matches:predictor.errorValue", { value: formatFixed(EVALUATION[statKey].mae, DIGITS[statKey]) })}
      </span>
    </>
  );
}

/** Lo que acompaña a las cifras del predictor: con cuántos partidos estima,
 * cuánto se equivoca en el histórico y qué no estima. */
function PredictorNotes({ match, forecasts }: { match: Match; forecasts: Forecasts }) {
  const { t } = useTranslation();
  const shown = predicted(forecasts);
  const excluded = STAT_KEYS.filter((key) => !EVALUATION[key].shown);
  // Las que se estiman con el árbitro: sin árbitro designado, sin cifra.
  const withReferee = STAT_KEYS.filter((key) => EVALUATION[key].shown && MODEL[key].referee);
  const refereeFactor = withReferee.map((key) => forecasts[key]?.referee).find(Boolean);
  // La muestra: los partidos de cada equipo (la de tiros, que casi siempre está).
  const sample = forecasts.shots ?? (shown.length > 0 ? forecasts[shown[0]] : null);
  const gains = shown.map((key) => EVALUATION[key].vsLeague);
  const pct = (x: number) => withPercent(formatFixed(x * 100, 0));
  const list = (keys: StatKey[]) =>
    new Intl.ListFormat(currentLocale(), { type: "conjunction" }).format(keys.map((k) => t(`matches:matchStats.statInline.${k}`)));

  return (
    <>
      {sample && (
        <p className="small muted">
          {t(sample.scope === "all" ? "matches:predictor.sampleAll" : "matches:predictor.sample", {
            homeTeam: match.home_team,
            home: sample.homeMatches,
            awayTeam: match.away_team,
            away: sample.awayMatches,
          })}
          {sampleTier(Math.min(sample.homeMatches, sample.awayMatches)) === "low" && ` ${t("matches:predictor.lowSample")}`}
        </p>
      )}
      {withReferee.length > 0 && (
        <p className="small muted">
          {refereeFactor && match.referee
            ? t("matches:predictor.refereeBase", { name: match.referee, matches: refereeFactor.matches })
            : t("matches:predictor.needsReferee")}
        </p>
      )}
      {gains.length > 0 && (
        <p className="small muted">
          {t("matches:predictor.errorNote", {
            from: formatSeason(EVALUATION_SEASONS[0]),
            to: formatSeason(EVALUATION_SEASONS[EVALUATION_SEASONS.length - 1]),
            matches: EVALUATION_MATCHES,
            min: pct(Math.min(...gains)),
            max: pct(Math.max(...gains)),
          })}
        </p>
      )}
      {excluded.length > 0 && (
        <p className="small muted">
          {t("matches:predictor.excluded", { stats: list(excluded) })}
          {excluded.some((key) => CARD_KEYS.includes(key as CardKey)) && ` ${t("matches:predictor.excludedReferee")}`}
        </p>
      )}
    </>
  );
}

/** Lo que hizo cada equipo en el partido ya jugado, en espejo: solo las
 * estadísticas que hay de los dos (el xG, solo en las cinco grandes ligas).
 * Arriba, los totales del partido con el total que preveía el predictor y la
 * diferencia. `prior`: los partidos de la liga anteriores a este; con ellos,
 * además, el botón pone debajo de cada cifra lo que estimaba el predictor
 * antes del partido. null: sin predictor (la Champions). */
export function MatchStatsTable({ match, played, prior }: { match: Match; played: MatchResult; prior: MatchResult[] | null }) {
  const { t } = useTranslation();
  const [compare, setCompare] = useState(false);
  const tableId = useId();
  // Lo estimado antes del partido: los totales lo comparan siempre; por equipo, al abrir el botón.
  const estimates = useMemo(() => (prior ? predictStats(match, prior) : null), [prior, match]);
  const forecasts = compare ? estimates : null;
  const rows = STAT_KEYS.map((key) => ({
    key,
    home: statValue(played.home_stats, key),
    away: statValue(played.away_stats, key),
    forecast: forecasts && EVALUATION[key].shown ? forecasts[key] : null,
  })).filter((r) => r.home !== null && r.away !== null);
  const show = (key: StatKey, value: number) => (key === "xg" ? formatFixed(value, 2) : String(value));
  const cell = (key: StatKey, value: number, estimate: number | undefined) =>
    estimate === undefined ? (
      show(key, value)
    ) : (
      <>
        {show(key, value)}
        <span className="match-stat-predicted">
          <span className="visually-hidden">{t("matches:matchStats.predictedLabel")} </span>
          {formatFixed(estimate, DIGITS[key])}
        </span>
      </>
    );

  const totals = rows.filter((r) => isTotal(r.key));
  const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${formatFixed(Math.abs(x), 1)}`;

  if (rows.length === 0) return <p className="muted">{t("matches:matchStats.none")}</p>;
  return (
    <>
      {totals.length > 0 && (
        <div className="stat-tiles predictor-totals">
          {totals.map((r) => {
            const real = r.home! + r.away!;
            const f = estimates && EVALUATION[r.key].shown ? estimates[r.key] : null;
            return (
              <div key={r.key} className="stat-tile">
                <span className="stat-tile-value">{real}</span>
                <span className="stat-tile-label">{t("matches:matchStats.total", { stat: t(`matches:matchStats.stat.${r.key}`) })}</span>
                {f && (
                  <span className="stat-tile-predicted">
                    {t("matches:matchStats.totalPredicted", {
                      value: formatFixed(f.home + f.away, DIGITS[r.key]),
                      diff: signed(real - (f.home + f.away)),
                    })}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <CompareTable
        id={tableId}
        homeTeam={match.home_team}
        awayTeam={match.away_team}
        league={match.league_code}
        caption={t("matches:matchStats.caption", { home: match.home_team, away: match.away_team })}
      >
        {rows.map((r) => (
          <CompareRow
            key={r.key}
            label={r.forecast ? <PredictedLabel statKey={r.key} /> : t(`matches:matchStats.stat.${r.key}`)}
            home={cell(r.key, r.home!, r.forecast?.home)}
            away={cell(r.key, r.away!, r.forecast?.away)}
            values={[r.home, r.away]}
          />
        ))}
      </CompareTable>
      {prior && (
        <div className="stats-predictor">
          <PredictorToggle
            open={compare}
            controls={tableId}
            label={t("matches:matchStats.compareButton")}
            onToggle={() => setCompare((v) => !v)}
          />
          {forecasts &&
            (predicted(forecasts).length === 0 ? (
              <p className="small muted">{t("matches:matchStats.noPrediction")}</p>
            ) : (
              <>
                <p className="small muted">{t("matches:matchStats.compareIntro")}</p>
                <PredictorNotes match={match} forecasts={forecasts} />
              </>
            ))}
        </div>
      )}
      <p className="small muted">{t("matches:matchStats.source")}</p>
    </>
  );
}

/** Partido por jugar: nada de entrada; el botón abre lo que estima el
 * predictor (lib/statsPredictor.ts), solo con las estadísticas que pasaron su
 * evaluación y cada una con su error medio. `history`: los partidos de la liga
 * anteriores a este. */
export function StatsPredictor({
  match,
  history,
  loading,
  error,
}: {
  match: Match;
  history: MatchHistory | null;
  loading: boolean;
  error: string | null;
}) {
  const { t } = useTranslation();
  // Abierto siempre, como el resto de bloques de la ficha.
  const forecasts = useMemo(() => (history ? predictStats(match, history.matches) : null), [history, match]);
  const shown = predicted(forecasts);
  const totals = shown.filter(isTotal);

  return (
    <div className="stats-predictor">
      {/* Que no se confunda con datos reales: una línea como las de los demás bloques, con su etiqueta. */}
      <p className="muted predictor-lead">
        <span className="match-meta-chip predictor-chip">{t("matches:predictor.badge")}</span>
        {t("matches:predictor.notReal")}
      </p>
      {loading && !history && <LoadingView label={t("matches:predictor.loading")} />}
      {error && <ErrorView message={t("matches:predictor.loadError", { error })} />}
      {history && shown.length === 0 && <p className="muted">{t("matches:predictor.noData")}</p>}
      {forecasts && shown.length > 0 && (
        <>
          {totals.length > 0 && (
            <div className="stat-tiles predictor-totals">
              {totals.map((key) => {
                const f = forecasts[key]!;
                return (
                  <div key={key} className="stat-tile">
                    <span className="stat-tile-value">{formatFixed(f.home + f.away, DIGITS[key])}</span>
                    <span className="stat-tile-label">
                      {t("matches:predictor.total", { stat: t(`matches:matchStats.stat.${key}`) })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <CompareTable
            homeTeam={match.home_team}
            awayTeam={match.away_team}
            league={match.league_code}
            caption={t("matches:predictor.caption", { home: match.home_team, away: match.away_team })}
          >
            {shown.map((key) => {
              const f = forecasts[key]!;
              return (
                <CompareRow
                  key={key}
                  label={<PredictedLabel statKey={key} />}
                  home={formatFixed(f.home, DIGITS[key])}
                  away={formatFixed(f.away, DIGITS[key])}
                  values={[f.home, f.away]}
                />
              );
            })}
          </CompareTable>
          <details className="predictor-how">
            <summary>{t("matches:predictor.how")}</summary>
            <p className="small muted">{t("matches:predictor.intro")}</p>
            <PredictorNotes match={match} forecasts={forecasts} />
          </details>
        </>
      )}
    </div>
  );
}
