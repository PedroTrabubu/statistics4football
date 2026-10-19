/** Indice de predecibilidad de un partido (protocolo pre-registrado:
 * docs/PREDECIBILIDAD_PROTOCOLO.md). Las variables salen solo de los picks del
 * partido y de los partidos anteriores; las mismas funciones sirven para
 * exportar el entrenamiento (scripts/export-predictability.ts) y para la web.
 * El modelo lo entrena backend/scripts/report_predictability.py. */

import type { Match, MatchResult, PredictabilityBand, PredictabilityModel } from "../api/types";
import { CHAMPIONS_LEAGUE_CODE } from "./leagues";
import type { TeamMatchView } from "./markets";
import { teamViews, type PickResult, type ProbablePick } from "./patterns";

/** Jornadas de cada liga, para `season_progress`. */
const LEAGUE_ROUNDS: Record<string, number> = {
  "ESP-La Liga": 38,
  "ESP-La Liga 2": 42,
  "ENG-Premier League": 38,
  "FRA-Ligue 1": 34,
  "GER-Bundesliga": 34,
  "ITA-Serie A": 38,
};

/** Una columna por liga, menos LaLiga (la de referencia). */
const LEAGUE_COLUMNS: Record<string, string> = {
  "ESP-La Liga 2": "league_hypermotion",
  "ENG-Premier League": "league_premier",
  "FRA-Ligue 1": "league_ligue1",
  "GER-Bundesliga": "league_bundesliga",
  "ITA-Serie A": "league_seriea",
};

export const FEATURES = [
  "n_alta",
  "n_media",
  "n_baja",
  "sample_min",
  "sample_mean",
  "rival_backed",
  "rival_against",
  "history_min",
  "volatility_goals",
  "volatility_corners",
  "home_share",
  "referee_sample",
  "season_progress",
  ...Object.values(LEAGUE_COLUMNS),
] as const;

export type Features = Record<string, number | null>;

/** Partidos recientes con los que se mide la variabilidad, y minimo con dato. */
const VOLATILITY_WINDOW = 10;
const MIN_VOLATILITY = 3;

/** La Champions no esta calibrada (comprobacion previa del protocolo): sin indice. */
export function isCalibratedLeague(leagueCode: string): boolean {
  return leagueCode !== CHAMPIONS_LEAGUE_CODE && leagueCode in LEAGUE_ROUNDS;
}

function std(xs: number[]): number | null {
  if (xs.length < MIN_VOLATILITY) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
}

const meanOf = (xs: (number | null)[]): number | null => {
  const ok = xs.filter((x): x is number => x !== null);
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
};

/** Variables de un partido. `prior`: partidos de su liga anteriores a el
 * (priorMatches), los mas recientes primero; `picks`: los de su ficha. */
export function matchFeatures(match: Match, picks: ProbablePick[], prior: MatchResult[]): Features {
  const count = (strength: ProbablePick["strength"]) => picks.filter((p) => p.strength === strength).length;
  const share = (test: (p: ProbablePick) => boolean) => (picks.length ? picks.filter(test).length / picks.length : null);
  const samples = picks.map((p) => p.rate.total);

  const teams = [match.home_team_id, match.away_team_id].map((id) => teamViews(prior, id));
  const recent = teams.map((views) => views.slice(0, VOLATILITY_WINDOW));
  const goals = recent.map((views) => std(views.map((v) => v.goalsFor + v.goalsAgainst)));
  const totalCorners = (v: TeamMatchView) => {
    const own = v.statsFor?.corners ?? null;
    const rival = v.statsAgainst?.corners ?? null;
    return own === null || rival === null ? null : own + rival;
  };
  const corners = recent.map((views) => std(views.map(totalCorners).filter((x): x is number => x !== null)));
  const rounds = LEAGUE_ROUNDS[match.league_code];

  const features: Features = {
    n_alta: count("alta"),
    n_media: count("media"),
    n_baja: count("baja"),
    sample_min: samples.length ? Math.min(...samples) : null,
    sample_mean: meanOf(samples),
    rival_backed: share((p) => p.rival.state === "backed"),
    rival_against: share((p) => p.rival.state === "against"),
    history_min: Math.min(...teams.map((views) => views.length)),
    volatility_goals: meanOf(goals),
    volatility_corners: meanOf(corners),
    home_share: share((p) => p.side === "home"),
    referee_sample: match.referee ? prior.filter((m) => m.referee === match.referee).length : 0,
    season_progress: match.matchday !== null && rounds ? Math.min(1, match.matchday / rounds) : null,
  };
  for (const [code, column] of Object.entries(LEAGUE_COLUMNS)) features[column] = match.league_code === code ? 1 : 0;
  return features;
}

export interface MatchExcess {
  /** Picks con dato y con frecuencia de la liga. */
  picks: number;
  hits: number;
  /** Suma de la frecuencia de la liga de esos picks. */
  expected: number;
  /** Media de (se cumplio - frecuencia de la liga); null sin picks. */
  excess: number | null;
}

/** Variable objetivo: exceso de acierto de los picks del partido sobre la liga. */
export function matchExcess(results: PickResult[]): MatchExcess {
  const decided = results.filter((r) => r.hit !== null && r.pick.leagueRate !== null);
  const hits = decided.filter((r) => r.hit).length;
  const expected = decided.reduce((sum, r) => sum + r.pick.leagueRate!, 0);
  return {
    picks: decided.length,
    hits,
    expected,
    excess: decided.length ? (hits - expected) / decided.length : null,
  };
}

// --- Modelo -------------------------------------------------------------------

export type Band = PredictabilityBand;
/** Percentiles que separan Baja | Media | Alta: terciles, sin ajuste a mano. */
export const BAND_EDGES = [100 / 3, 200 / 3] as const;
/** Una banda con menos partidos: "muestra insuficiente". */
export const MIN_BAND_MATCHES = 30;

/** Exceso esperado del partido segun el modelo. */
export function predictExcess(features: Features, model: PredictabilityModel): number {
  return model.features.reduce((sum, name, i) => {
    const raw = features[name];
    const z = raw === null || raw === undefined ? 0 : (raw - model.mean[i]) / model.scale[i];
    return sum + model.coef[i] * z;
  }, model.intercept);
}

/** Percentil (0-100) de una prediccion entre las del entrenamiento; los empates cuentan la mitad. */
export function percentileOf(value: number, reference: number[]): number {
  if (!reference.length) return 50;
  let below = 0;
  let equal = 0;
  for (const r of reference) {
    if (r < value) below += 1;
    else if (r === value) equal += 1;
  }
  return (100 * (below + equal / 2)) / reference.length;
}

export function bandOf(index: number): Band {
  return index >= BAND_EDGES[1] ? "alta" : index >= BAND_EDGES[0] ? "media" : "baja";
}

export const BAND_LABEL: Record<Band, string> = { alta: "Alta", media: "Media", baja: "Baja" };

/** Texto fijo del protocolo, junto al indice. */
export const PREDICTABILITY_NOTE =
  "Mide la fiabilidad de los patrones históricos, no la probabilidad de ganar una apuesta. El mercado ya descuenta lo predecible.";

export interface PredictabilityValue {
  index: number;
  band: Band;
}

/** Indice de un partido por jugar con el modelo final (el de un jugado sale
 * del valor fuera de muestra guardado, nunca se recalcula). */
export function upcomingPredictability(
  match: Match,
  picks: ProbablePick[],
  prior: MatchResult[],
  model: PredictabilityModel,
): PredictabilityValue {
  const index = percentileOf(predictExcess(matchFeatures(match, picks, prior), model), model.reference);
  return { index, band: bandOf(index) };
}
