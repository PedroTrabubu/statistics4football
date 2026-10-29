/** Predictor de estadísticas: lo que se espera que saque cada equipo en un
 * partido por jugar (protocolo: docs/PREDICTOR_ESTADISTICAS_PROTOCOLO.md).
 *
 * Parte del método de los córners esperados del duelo (lib/cornerDuel.ts,
 * statForecast): solo con los partidos anteriores al partido, medias a favor y
 * en contra, con más peso a los recientes y encogidas hacia la liga. La web usa
 * la configuración de cada estadística elegida en la ampliación 2 (MODEL,
 * statForecastWith) y, en las amarillas, el árbitro. Funciones puras. */

import type { Match, MatchResult, TeamMatchStats } from "../api/types";
import { CORNER_CAP, DECAY_PER_DAY, SHRINK_MATCHES } from "./cornerDuel";

export type StatKey = "xg" | "shots" | "shots_on_target" | "corners" | "fouls" | "yellow_cards" | "red_cards";

/** En el orden de la tabla del partido. */
export const STAT_KEYS: StatKey[] = ["xg", "shots", "shots_on_target", "corners", "fouls", "yellow_cards", "red_cards"];

/** El modelo de cada estadística: el elegido con la validación (22/23-24/25)
 * de la ampliación 2 del protocolo y confirmado en su test. Las amarillas, con
 * el factor del árbitro: sin árbitro designado no se estiman. */
export const MODEL: Record<StatKey, CardSettings> = {
  xg: { base: { structure: "pooled", decay: 0.0036, shrink: 5 }, referee: null },
  shots: { base: { structure: "pooled", decay: 0.0036, shrink: 5 }, referee: null },
  shots_on_target: { base: { structure: "pooled", decay: 0.0036, shrink: 5 }, referee: null },
  corners: { base: { structure: "pooled", decay: 0.0036, shrink: 10 }, referee: null },
  fouls: { base: { structure: "pooled", decay: 0.0036, shrink: 5 }, referee: null },
  yellow_cards: { base: { structure: "pooled", decay: 0.0036, shrink: 20 }, referee: { method: "adjusted", shrink: 20 } },
  red_cards: { base: { structure: "venue", decay: 0.0036, shrink: 2 }, referee: { method: "adjusted", shrink: 5 } },
};

/** Resultado del test de MODEL (ampliación 2 del protocolo, 2026-10-27),
 * copiado de su tabla; no se calcula en la web. `shown`: pasa la regla de
 * decisión. `mae`: error absoluto medio por equipo. `vsLeague`: cuánto menos
 * error que la media de la liga (0.093, un 9,3 %). */
export const EVALUATION: Record<StatKey, { shown: boolean; mae: number; vsLeague: number }> = {
  xg: { shown: true, mae: 0.647, vsLeague: 0.087 },
  shots: { shown: true, mae: 3.636, vsLeague: 0.093 },
  shots_on_target: { shown: true, mae: 1.762, vsLeague: 0.069 },
  corners: { shown: true, mae: 2.079, vsLeague: 0.039 },
  fouls: { shown: true, mae: 2.862, vsLeague: 0.075 },
  yellow_cards: { shown: true, mae: 1.069, vsLeague: 0.015 },
  red_cards: { shown: false, mae: 0.182, vsLeague: 0.015 },
};
/** El test: 25/26 completa y 26/27 hasta el 2026-10-27, seis ligas. */
export const EVALUATION_SEASONS = ["2526", "2627"];
export const EVALUATION_MATCHES = 2729;

/** Recorte al estimar medias: solo los córners, como en el duelo. */
const CAP: Partial<Record<StatKey, number>> = { corners: CORNER_CAP };
const DAY_MS = 86_400_000;

/** Cifra de un equipo en un partido; null si falta. */
export function statValue(stats: TeamMatchStats | null | undefined, key: StatKey): number | null {
  const value = stats?.[key];
  return value === null || value === undefined ? null : value;
}

export interface StatForecast {
  /** Valor esperado de cada equipo. */
  home: number;
  away: number;
  /** Partidos con la estadística del local en casa y del visitante fuera (la muestra);
   * con `scope` "all", todos los de cada equipo. */
  homeMatches: number;
  awayMatches: number;
  scope?: "venue" | "all";
}

interface Sample {
  homeId: number;
  awayId: number;
  home: number;
  away: number;
  weight: number;
  referee: string | null;
}

/** Fecha de cada partido, leída una sola vez (el mismo partido se consulta
 * para cada estadística y cada partido posterior). */
const times = new WeakMap<MatchResult, number>();
function timeOf(m: MatchResult): number {
  let t = times.get(m);
  if (t === undefined) {
    t = Date.parse(m.date);
    times.set(m, t);
  }
  return t;
}

function samples(prior: MatchResult[], key: StatKey, at: number, decay = DECAY_PER_DAY): Sample[] {
  const cap = CAP[key] ?? Infinity;
  const out: Sample[] = [];
  for (const m of prior) {
    const home = statValue(m.home_stats, key);
    const away = statValue(m.away_stats, key);
    const t = timeOf(m);
    if (home === null || away === null || !(t < at)) continue;
    out.push({
      homeId: m.home_team_id,
      awayId: m.away_team_id,
      home: Math.min(home, cap),
      away: Math.min(away, cap),
      weight: Math.exp((-decay * (at - t)) / DAY_MS),
      referee: m.referee,
    });
  }
  return out;
}

/** Valor esperado de una estadística para cada equipo, con los partidos
 * anteriores (de cualquier orden: se filtran por fecha). null sin datos de la
 * liga (por ejemplo, xG en una liga sin xG). */
export function statForecast(
  match: Pick<Match, "date" | "home_team_id" | "away_team_id">,
  prior: MatchResult[],
  key: StatKey,
): StatForecast | null {
  const data = samples(prior, key, Date.parse(match.date));
  const totalWeight = data.reduce((s, d) => s + d.weight, 0);
  if (totalWeight === 0) return null;
  const leagueHome = data.reduce((s, d) => s + d.weight * d.home, 0) / totalWeight;
  const leagueAway = data.reduce((s, d) => s + d.weight * d.away, 0) / totalWeight;
  if (leagueHome <= 0 || leagueAway <= 0) return null;

  const shrunk = (rows: Sample[], value: (d: Sample) => number, prior: number) =>
    (rows.reduce((s, d) => s + d.weight * value(d), 0) + SHRINK_MATCHES * prior) /
    (rows.reduce((s, d) => s + d.weight, 0) + SHRINK_MATCHES);
  const homeAtHome = data.filter((d) => d.homeId === match.home_team_id);
  const awayAway = data.filter((d) => d.awayId === match.away_team_id);
  const homeFor = shrunk(homeAtHome, (d) => d.home, leagueHome);
  const homeAgainst = shrunk(homeAtHome, (d) => d.away, leagueAway);
  const awayFor = shrunk(awayAway, (d) => d.away, leagueAway);
  const awayAgainst = shrunk(awayAway, (d) => d.home, leagueHome);

  return {
    home: (homeFor * awayAgainst) / leagueHome,
    away: (awayFor * homeAgainst) / leagueAway,
    homeMatches: homeAtHome.length,
    awayMatches: awayAway.length,
  };
}

/** Estimación de una estadística: la de StatForecast y, si su modelo lleva
 * árbitro, su factor. */
export type Forecast = StatForecast & { referee?: RefereeFactor | null };

/** Todas las estadísticas de un partido, cada una con su modelo (MODEL). Las
 * que llevan árbitro, null sin árbitro designado. */
export function predictStats(
  match: Pick<Match, "date" | "home_team_id" | "away_team_id" | "referee">,
  prior: MatchResult[],
): Record<StatKey, Forecast | null> {
  const forecast = (key: StatKey): Forecast | null => {
    const settings = MODEL[key];
    if (settings.referee || settings.base === "league") return cardsForecastWith(match, prior, key as CardKey, settings);
    return statForecastWith(match, prior, key, settings.base);
  };
  return Object.fromEntries(STAT_KEYS.map((key) => [key, forecast(key)])) as Record<StatKey, Forecast | null>;
}

// --- Tarjetas con el árbitro (ampliación del protocolo) -----------------------

export type CardKey = "yellow_cards" | "red_cards";
export const CARD_KEYS: CardKey[] = ["yellow_cards", "red_cards"];

/** R1 ("raw"): sus tarjetas por partido frente a la liga. R2 ("adjusted"): lo
 * que hubo en sus partidos frente a lo que el modelo de equipos esperaba en
 * ellos. `shrink`: partidos de encogimiento hacia 1. */
export interface RefereeSettings {
  method: "raw" | "adjusted";
  shrink: number;
}

export interface RefereeFactor {
  factor: number;
  /** Partidos anteriores del árbitro con esa estadística (la muestra). */
  matches: number;
}

/** Factor del árbitro del partido para una estadística de tarjetas, con sus
 * partidos anteriores en la liga (mismo filtro y pesos que el modelo). null
 * sin árbitro designado o sin datos de la liga; factor 1 si no tiene partidos. */
export function refereeFactor(
  match: Pick<Match, "date" | "referee">,
  prior: MatchResult[],
  key: CardKey,
  settings: RefereeSettings,
): RefereeFactor | null {
  if (!match.referee) return null;
  const data = samples(prior, key, Date.parse(match.date));
  const totalWeight = data.reduce((s, d) => s + d.weight, 0);
  if (totalWeight === 0) return null;
  const leagueHome = data.reduce((s, d) => s + d.weight * d.home, 0) / totalWeight;
  const leagueAway = data.reduce((s, d) => s + d.weight * d.away, 0) / totalWeight;
  const perMatch = leagueHome + leagueAway;
  if (leagueHome <= 0 || leagueAway <= 0) return null;

  const own = data.filter((d) => d.referee === match.referee);
  const observed = own.reduce((s, d) => s + d.weight * (d.home + d.away), 0);
  const k = settings.shrink;
  if (settings.method === "raw") {
    const weight = own.reduce((s, d) => s + d.weight, 0);
    return { factor: (observed + k * perMatch) / (weight + k) / perMatch, matches: own.length };
  }

  // R2: lo que esperaba el modelo de equipos en cada partido del árbitro, con
  // las fuerzas de los equipos de los mismos partidos anteriores.
  const sums = new Map<string, { weight: number; for: number; against: number }>();
  const add = (team: string, d: Sample, value: number, conceded: number) => {
    const s = sums.get(team) ?? { weight: 0, for: 0, against: 0 };
    s.weight += d.weight;
    s.for += d.weight * value;
    s.against += d.weight * conceded;
    sums.set(team, s);
  };
  for (const d of data) {
    add(`h${d.homeId}`, d, d.home, d.away);
    add(`a${d.awayId}`, d, d.away, d.home);
  }
  const shrunk = (team: string, side: "for" | "against", prior: number) => {
    const s = sums.get(team);
    return ((s?.[side] ?? 0) + SHRINK_MATCHES * prior) / ((s?.weight ?? 0) + SHRINK_MATCHES);
  };
  const expected = own.reduce((s, d) => {
    const home = (shrunk(`h${d.homeId}`, "for", leagueHome) * shrunk(`a${d.awayId}`, "against", leagueHome)) / leagueHome;
    const away = (shrunk(`a${d.awayId}`, "for", leagueAway) * shrunk(`h${d.homeId}`, "against", leagueAway)) / leagueAway;
    return s + d.weight * (home + away);
  }, 0);
  return { factor: (observed + k * perMatch) / (expected + k * perMatch), matches: own.length };
}

/** Tarjetas esperadas de cada equipo con el árbitro designado: el modelo de
 * equipos por el factor del árbitro. null sin árbitro designado. */
export function cardsForecast(
  match: Pick<Match, "date" | "home_team_id" | "away_team_id" | "referee">,
  prior: MatchResult[],
  key: CardKey,
  settings: RefereeSettings,
): (StatForecast & { referee: RefereeFactor }) | null {
  const base = statForecast(match, prior, key);
  const referee = refereeFactor(match, prior, key, settings);
  if (!base || !referee) return null;
  return { ...base, home: base.home * referee.factor, away: base.away * referee.factor, referee };
}

// --- Configuraciones del modelo (ampliación 2 del protocolo) ------------------

/** `venue`: cada equipo solo en su campo (el modelo publicado). `pooled`: todos
 * sus partidos, cada cifra relativa a la media de la liga en su campo. `blend`:
 * la media de las dos. `decay`: peso exp(-decay × días). `shrink`: partidos de
 * encogimiento hacia la liga. */
export interface ModelSettings {
  structure: "venue" | "pooled" | "blend";
  decay: number;
  shrink: number;
}

/** El modelo publicado: el de statForecast. */
export const PUBLISHED: ModelSettings = { structure: "venue", decay: DECAY_PER_DAY, shrink: SHRINK_MATCHES };

/** Como statForecast, con otra configuración. Con PUBLISHED da exactamente lo mismo. */
export function statForecastWith(
  match: Pick<Match, "date" | "home_team_id" | "away_team_id">,
  prior: MatchResult[],
  key: StatKey,
  settings: ModelSettings,
): StatForecast | null {
  const data = samples(prior, key, Date.parse(match.date), settings.decay);
  const totalWeight = data.reduce((s, d) => s + d.weight, 0);
  if (totalWeight === 0) return null;
  const leagueHome = data.reduce((s, d) => s + d.weight * d.home, 0) / totalWeight;
  const leagueAway = data.reduce((s, d) => s + d.weight * d.away, 0) / totalWeight;
  if (leagueHome <= 0 || leagueAway <= 0) return null;
  const k = settings.shrink;

  // Por campo: las mismas cuentas que statForecast.
  const shrunk = (rows: Sample[], value: (d: Sample) => number, prior: number) =>
    (rows.reduce((s, d) => s + d.weight * value(d), 0) + k * prior) / (rows.reduce((s, d) => s + d.weight, 0) + k);
  const homeAtHome = data.filter((d) => d.homeId === match.home_team_id);
  const awayAway = data.filter((d) => d.awayId === match.away_team_id);
  const venue = {
    home: (shrunk(homeAtHome, (d) => d.home, leagueHome) * shrunk(awayAway, (d) => d.home, leagueHome)) / leagueHome,
    away: (shrunk(awayAway, (d) => d.away, leagueAway) * shrunk(homeAtHome, (d) => d.away, leagueAway)) / leagueAway,
  };
  if (settings.structure === "venue") {
    return { ...venue, homeMatches: homeAtHome.length, awayMatches: awayAway.length, scope: "venue" };
  }

  // Todos sus partidos: ataque y defensa como proporción de la media de la liga en cada campo.
  const ratios = (teamId: number) => {
    let weight = 0;
    let attack = 0;
    let defence = 0;
    let matches = 0;
    for (const d of data) {
      if (d.homeId === teamId) {
        attack += (d.weight * d.home) / leagueHome;
        defence += (d.weight * d.away) / leagueAway;
      } else if (d.awayId === teamId) {
        attack += (d.weight * d.away) / leagueAway;
        defence += (d.weight * d.home) / leagueHome;
      } else continue;
      weight += d.weight;
      matches += 1;
    }
    return { attack: (attack + k) / (weight + k), defence: (defence + k) / (weight + k), matches };
  };
  const h = ratios(match.home_team_id);
  const a = ratios(match.away_team_id);
  const pooled = { home: leagueHome * h.attack * a.defence, away: leagueAway * a.attack * h.defence };
  const mix = settings.structure === "pooled" ? pooled : { home: (venue.home + pooled.home) / 2, away: (venue.away + pooled.away) / 2 };
  return { ...mix, homeMatches: h.matches, awayMatches: a.matches, scope: "all" };
}

/** Tarjetas: `base` es una configuración del modelo de equipos (con el factor
 * R2 del árbitro o sin él) o "league", la media de la liga en cada campo por el
 * factor R1 ("liga × árbitro"). */
export interface CardSettings {
  base: ModelSettings | "league";
  referee: RefereeSettings | null;
}

/** Tarjetas esperadas de cada equipo con una configuración de CardSettings.
 * null si pide árbitro y no hay designado, o sin datos de la liga. */
export function cardsForecastWith(
  match: Pick<Match, "date" | "home_team_id" | "away_team_id" | "referee">,
  prior: MatchResult[],
  key: CardKey,
  settings: CardSettings,
): (StatForecast & { referee: RefereeFactor | null }) | null {
  const referee = settings.referee ? refereeFactor(match, prior, key, settings.referee) : null;
  if (settings.referee && !referee) return null;
  const factor = referee?.factor ?? 1;
  if (settings.base === "league") {
    const data = samples(prior, key, Date.parse(match.date));
    const totalWeight = data.reduce((s, d) => s + d.weight, 0);
    if (totalWeight === 0) return null;
    const leagueHome = data.reduce((s, d) => s + d.weight * d.home, 0) / totalWeight;
    const leagueAway = data.reduce((s, d) => s + d.weight * d.away, 0) / totalWeight;
    return { home: leagueHome * factor, away: leagueAway * factor, homeMatches: 0, awayMatches: 0, referee };
  }
  const base = statForecastWith(match, prior, key, settings.base);
  if (!base) return null;
  return { ...base, home: base.home * factor, away: base.away * factor, referee };
}
