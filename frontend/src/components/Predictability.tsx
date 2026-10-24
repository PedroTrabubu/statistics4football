import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Match, MatchResult, PredictabilityBandStats, PredictabilityData } from "../api/types";
import { t } from "../i18n";
import { formatFixed, formatSeason, formatSignedPoints as pts, withPercent } from "../lib/format";
import { leagueName } from "../lib/leagues";
import type { ProbablePick } from "../lib/patterns";
import { priorMatches } from "../lib/patterns";
import {
  BAND_LABEL,
  isCalibratedLeague,
  predictabilityNote,
  upcomingPredictability,
  type Band,
  type PredictabilityValue,
} from "../lib/predictability";
import { usePredictability } from "../lib/usePredictability";

const BANDS: Band[] = ["alta", "media", "baja"];
/** La temporada de prueba del protocolo: la que se cita junto al indice. */
const TEST_SEASON = "2627";

const pct = (x: number) => withPercent(formatFixed(x * 100, 1));

function bandSentence(data: PredictabilityData, band: Band): string {
  const season = data.bands?.[TEST_SEASON] ? TEST_SEASON : Object.keys(data.bands ?? {}).sort().pop();
  const stats = season ? data.bands?.[season]?.all?.[band] : null;
  if (!season || !stats) return "";
  const sentence = t("picks:predictability.bandSentence", {
    band: BAND_LABEL[band],
    season: formatSeason(season),
    hitRate: pct(stats.hit_rate),
    base: pct(stats.base),
    edge: pts(stats.edge),
    low: pts(stats.low),
    high: pts(stats.high),
    count: stats.matches,
  });
  return stats.insufficient ? `${sentence} ${t("picks:predictability.insufficientSentence")}` : sentence;
}

function separationSentence(data: PredictabilityData): string {
  const s = data.summary?.[TEST_SEASON];
  if (!s) return "";
  const [point, low, high] = s.separation;
  const clear = low > 0 || high < 0;
  return t(clear ? "picks:predictability.separationClear" : "picks:predictability.separationUnclear", {
    season: formatSeason(TEST_SEASON),
    point: pts(point),
    low: pts(low),
    high: pts(high),
  });
}

/** "Predecibilidad: Alta (72/100)". En un partido jugado, el valor con el que se
 * puntuó antes de jugarse; en uno por jugar, el modelo con todo lo anterior. */
export function PredictabilityChip({
  match,
  picks,
  history,
  showNote = false,
}: {
  match: Match;
  /** Picks del partido (los de su ficha); solo hacen falta si aún no se ha jugado. */
  picks: ProbablePick[] | null;
  /** Partidos de su liga (se filtran los anteriores); solo si aún no se ha jugado. */
  history: MatchResult[] | null;
  showNote?: boolean;
}) {
  const { t } = useTranslation();
  const data = usePredictability();
  const played = match.status === "historical";
  const value: PredictabilityValue | "sin-picks" | null = useMemo(() => {
    if (!data || !isCalibratedLeague(match.league_code)) return null;
    if (played) return data.matches?.[String(match.id)] ?? null;
    if (!picks || !history || !data.model) return null;
    if (picks.length === 0) return "sin-picks";
    return upcomingPredictability(match, picks, priorMatches(match, history), data.model);
  }, [data, match, played, picks, history]);

  if (!isCalibratedLeague(match.league_code)) {
    return (
      <span className="predictability-chip predictability-none" title={t("picks:predictability.uncalibratedTitle")}>
        {t("picks:predictability.chipUncalibrated")}
      </span>
    );
  }
  if (!data || value === null) return null;
  if (value === "sin-picks") {
    return <span className="predictability-chip predictability-none">{t("picks:predictability.chipNoPicks")}</span>;
  }
  const index = Math.round(value.index);
  const title = [
    t(played ? "picks:predictability.estimatePlayed" : "picks:predictability.estimate", { index }),
    bandSentence(data, value.band),
    separationSentence(data),
    predictabilityNote(),
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span className="predictability">
      <span className={`predictability-chip predictability-${value.band}`} title={title}>
        {t("picks:predictability.chip", { band: BAND_LABEL[value.band], index })}
      </span>
      {showNote && <span className="small muted">{predictabilityNote()}</span>}
    </span>
  );
}

function StatsCells({ stats }: { stats: PredictabilityBandStats | null }) {
  const { t } = useTranslation();
  return (
    <>
      {!stats ? (
        <td colSpan={5} className="muted">
          {t("picks:predictability.noMatches")}
        </td>
      ) : stats.insufficient ? (
        <>
          <td className="num">{stats.matches}</td>
          <td colSpan={4} className="muted">
            {t("picks:predictability.insufficient")}
          </td>
        </>
      ) : (
        <>
          <td className="num">{stats.matches}</td>
          <td className="num">{pct(stats.hit_rate)}</td>
          <td className="num">{pct(stats.base)}</td>
          <td className={`num ${stats.edge >= 0 ? "edge-up" : "edge-down"}`}>{pts(stats.edge)}</td>
          <td className="num">{t("common:range", { from: pts(stats.low), to: pts(stats.high) })}</td>
        </>
      )}
    </>
  );
}

/** Acierto por banda y temporada, en la liga elegida y en las seis juntas. */
export function PredictabilityTable({ league }: { league: string }) {
  const { t } = useTranslation();
  const data = usePredictability();
  if (!isCalibratedLeague(league)) {
    return (
      <section className="detail-section predictability-section">
        <h2>{t("picks:predictability.title")}</h2>
        <p className="small muted">{t("picks:predictability.tableUncalibrated")}</p>
      </section>
    );
  }
  if (!data?.bands) return null;
  const seasons = Object.keys(data.bands).sort();
  const scopes = [
    { key: league, label: leagueName(league) },
    { key: "all", label: t("picks:predictability.sixLeagues") },
  ];
  return (
    <section className="detail-section predictability-section">
      <h2>{t("picks:predictability.title")}</h2>
      <p className="small muted">
        {t("picks:predictability.intro")} {separationSentence(data)}
      </p>
      <p className="small">
        <strong>{predictabilityNote()}</strong>
      </p>
      <div className="table-scroll">
        <table className="predictions-table predictability-table">
          <thead>
            <tr>
              <th>{t("picks:predictability.column.season")}</th>
              <th>{t("picks:predictability.column.scope")}</th>
              <th>{t("picks:predictability.column.band")}</th>
              <th className="num">{t("picks:predictability.column.matches")}</th>
              <th className="num">{t("picks:predictability.column.hitRate")}</th>
              <th className="num">{t("picks:predictability.column.leagueBase")}</th>
              <th className="num">{t("picks:predictability.column.edge")}</th>
              <th className="num">{t("picks:predictability.column.ci")}</th>
            </tr>
          </thead>
          <tbody>
            {seasons.flatMap((season) =>
              scopes.flatMap((scope) =>
                BANDS.map((band, i) => (
                  <tr key={`${season}-${scope.key}-${band}`}>
                    {i === 0 && scope.key === league && (
                      <td rowSpan={BANDS.length * scopes.length}>
                        {t(season === TEST_SEASON ? "picks:predictability.seasonTest" : "picks:predictability.seasonDev", {
                          season: formatSeason(season),
                        })}
                      </td>
                    )}
                    {i === 0 && <td rowSpan={BANDS.length}>{scope.label}</td>}
                    <td>{BAND_LABEL[band]}</td>
                    <StatsCells stats={data.bands?.[season]?.[scope.key]?.[band] ?? null} />
                  </tr>
                )),
              ),
            )}
          </tbody>
        </table>
      </div>
      <p className="small muted">{t("picks:predictability.footnote", { n: data.min_band ?? 30 })}</p>
    </section>
  );
}
