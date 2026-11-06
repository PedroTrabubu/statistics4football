/** El duelo de córners y el predictor de estadísticas guardados por el backend
 * (app/probability/match_forecasts.py), con las formas que pintan la ficha y
 * Picks probables. La web ya no los calcula: lib/cornerDuel.ts y
 * lib/statsPredictor.ts quedan para los scripts de sus protocolos. */

import type { DuelForecastOut, MatchForecastsOut, StatForecastOut } from "../api/types";
import type { DuelForecast } from "./cornerDuel";
import { STAT_KEYS, type Forecast, type StatKey } from "./statsPredictor";

export interface MatchForecasts {
  status: MatchForecastsOut["status"];
  /** "reconstructed": reconstruida con datos anteriores; "frozen": guardada antes del partido. */
  kind: MatchForecastsOut["kind"];
  duel: DuelForecast | null;
  /** null: sin predictor (la Champions) o aún sin calcular. */
  stats: Record<StatKey, Forecast | null> | null;
}

export function toDuel(d: DuelForecastOut): DuelForecast {
  return {
    homeExpected: d.home_expected,
    awayExpected: d.away_expected,
    home: d.home,
    draw: d.draw,
    away: d.away,
    homeNotLose: d.home + d.draw,
    awayNotLose: d.away + d.draw,
    homeMatches: d.home_matches,
    awayMatches: d.away_matches,
  };
}

function toForecast(f: StatForecastOut): Forecast {
  return {
    home: f.home,
    away: f.away,
    homeMatches: f.home_matches,
    awayMatches: f.away_matches,
    scope: f.scope,
    referee: f.referee,
  };
}

export function toMatchForecasts(raw: MatchForecastsOut): MatchForecasts {
  const stats = raw.stats;
  return {
    status: raw.status,
    kind: raw.kind,
    duel: raw.duel ? toDuel(raw.duel) : null,
    stats: stats
      ? (Object.fromEntries(STAT_KEYS.map((key) => [key, stats[key] ? toForecast(stats[key]) : null])) as Record<
          StatKey,
          Forecast | null
        >)
      : null,
  };
}
