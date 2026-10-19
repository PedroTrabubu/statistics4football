import { useMemo } from "react";
import type { Match, MatchResult, PredictabilityBandStats, PredictabilityData } from "../api/types";
import { formatSeason } from "../lib/format";
import { leagueName } from "../lib/leagues";
import type { ProbablePick } from "../lib/patterns";
import { priorMatches } from "../lib/patterns";
import {
  BAND_LABEL,
  PREDICTABILITY_NOTE,
  isCalibratedLeague,
  upcomingPredictability,
  type Band,
  type PredictabilityValue,
} from "../lib/predictability";
import { usePredictability } from "../lib/usePredictability";

const BANDS: Band[] = ["alta", "media", "baja"];
/** La temporada de prueba del protocolo: la que se cita junto al indice. */
const TEST_SEASON = "2627";

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
const pts = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}`;

function bandSentence(data: PredictabilityData, band: Band): string {
  const season = data.bands?.[TEST_SEASON] ? TEST_SEASON : Object.keys(data.bands ?? {}).sort().pop();
  const stats = season ? data.bands?.[season]?.all?.[band] : null;
  if (!season || !stats) return "";
  const sample = stats.insufficient ? " Muestra insuficiente." : "";
  return `Banda ${BAND_LABEL[band]} en ${formatSeason(season)}: sus picks acertaron el ${pct(stats.hit_rate)}, frente al ${pct(stats.base)} habitual en la liga (${pts(stats.edge)} pts, IC ${pts(stats.low)} a ${pts(stats.high)}; ${stats.matches} partidos).${sample}`;
}

function separationSentence(data: PredictabilityData): string {
  const s = data.summary?.[TEST_SEASON];
  if (!s) return "";
  const [point, low, high] = s.separation;
  const clear = low > 0 || high < 0;
  return `Alta − Baja en ${formatSeason(TEST_SEASON)}: ${pts(point)} pts (IC ${pts(low)} a ${pts(high)})${clear ? "." : ": las bandas no se separan de forma clara."}`;
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
      <span
        className="predictability-chip predictability-none"
        title="La Champions no está calibrada: con tan pocos partidos por equipo, los pronósticos favorecen al local casi siempre. Queda fuera del índice."
      >
        Predecibilidad: no calibrada
      </span>
    );
  }
  if (!data || value === null) return null;
  if (value === "sin-picks") {
    return <span className="predictability-chip predictability-none">Predecibilidad: sin picks</span>;
  }
  const title = [
    `Estima cuánto se cumplirán los picks de este partido por encima de lo habitual en la liga para esos mismos sucesos (percentil ${Math.round(value.index)} de 100${played ? ", calculado antes de jugarse" : ""}).`,
    bandSentence(data, value.band),
    separationSentence(data),
    PREDICTABILITY_NOTE,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span className="predictability">
      <span className={`predictability-chip predictability-${value.band}`} title={title}>
        Predecibilidad: {BAND_LABEL[value.band]} ({Math.round(value.index)}/100)
      </span>
      {showNote && <span className="small muted">{PREDICTABILITY_NOTE}</span>}
    </span>
  );
}

function StatsCells({ stats }: { stats: PredictabilityBandStats | null }) {
  return (
    <>
      {!stats ? (
        <td colSpan={5} className="muted">
          Sin partidos
        </td>
      ) : stats.insufficient ? (
        <>
          <td className="num">{stats.matches}</td>
          <td colSpan={4} className="muted">
            Muestra insuficiente
          </td>
        </>
      ) : (
        <>
          <td className="num">{stats.matches}</td>
          <td className="num">{pct(stats.hit_rate)}</td>
          <td className="num">{pct(stats.base)}</td>
          <td className={`num ${stats.edge >= 0 ? "edge-up" : "edge-down"}`}>{pts(stats.edge)}</td>
          <td className="num">
            {pts(stats.low)} a {pts(stats.high)}
          </td>
        </>
      )}
    </>
  );
}

/** Acierto por banda y temporada, en la liga elegida y en las seis juntas. */
export function PredictabilityTable({ league }: { league: string }) {
  const data = usePredictability();
  if (!isCalibratedLeague(league)) {
    return (
      <section className="detail-section predictability-section">
        <h2>Índice de predecibilidad</h2>
        <p className="small muted">
          La Champions no está calibrada (con tan pocos partidos por equipo, los pronósticos favorecen al local casi
          siempre): queda fuera del índice.
        </p>
      </section>
    );
  }
  if (!data?.bands) return null;
  const seasons = Object.keys(data.bands).sort();
  const scopes = [
    { key: league, label: leagueName(league) },
    { key: "all", label: "Seis ligas" },
  ];
  return (
    <section className="detail-section predictability-section">
      <h2>Índice de predecibilidad</h2>
      <p className="small muted">
        Cada partido jugado se puntuó antes de jugarse con un modelo entrenado solo con partidos anteriores. La tabla
        compara el acierto de los picks de cada banda con lo habitual en la liga para esos mismos sucesos.{" "}
        {separationSentence(data)}
      </p>
      <p className="small">
        <strong>{PREDICTABILITY_NOTE}</strong>
      </p>
      <div className="table-scroll">
        <table className="predictions-table predictability-table">
          <thead>
            <tr>
              <th>Temporada</th>
              <th>Ámbito</th>
              <th>Banda</th>
              <th className="num">Partidos</th>
              <th className="num">Acierto</th>
              <th className="num">Base de la liga</th>
              <th className="num">Ventaja (pts)</th>
              <th className="num">IC 95 %</th>
            </tr>
          </thead>
          <tbody>
            {seasons.flatMap((season) =>
              scopes.flatMap((scope) =>
                BANDS.map((band, i) => (
                  <tr key={`${season}-${scope.key}-${band}`}>
                    {i === 0 && scope.key === league && (
                      <td rowSpan={BANDS.length * scopes.length}>
                        {formatSeason(season)}
                        {season === TEST_SEASON ? " (prueba)" : " (desarrollo)"}
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
      <p className="small muted">
        Bandas: terciles del índice (0–100) entre los partidos con los que se entrenó el modelo. Con menos de{" "}
        {data.min_band ?? 30} partidos, "muestra insuficiente". La Champions queda fuera (no calibrada). Protocolo y
        resultados en docs/PREDECIBILIDAD_PROTOCOLO.md.
      </p>
    </section>
  );
}
