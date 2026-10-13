/** Duelo de córners: probabilidad de que cada equipo saque más córners que el
 * otro (protocolo: docs/DUELO_CORNERES_MODELO_PROTOCOLO.md). Bloque nuevo:
 * no entra en los picks ni en sus cifras de acierto.
 *
 * Solo con los partidos anteriores al partido (los que se le pasan): medias
 * de córners a favor y en contra por campo, con más peso a los recientes y
 * encogidas hacia la liga; córners de cada equipo binomiales negativos e
 * independientes. Funciones puras. */

import type { Match, MatchResult } from "../api/types";

/** Un partido extremo (18-0) cuenta como 14-0 al estimar medias. */
export const CORNER_CAP = 14;
/** Peso exp(-0.0018 × días): el decaimiento de Dixon-Coles en la web. */
export const DECAY_PER_DAY = 0.0018;
/** Encogimiento hacia la liga, en partidos: el del modelo de conteos de las combinadas. */
export const SHRINK_MATCHES = 5;
const MAX_CORNERS = 40;
const DAY_MS = 86_400_000;

export interface DuelForecast {
  /** Córners esperados de cada equipo. */
  homeExpected: number;
  awayExpected: number;
  /** El local saca más / los mismos / el visitante saca más. Suman 1. */
  home: number;
  draw: number;
  away: number;
  homeNotLose: number;
  awayNotLose: number;
  /** Partidos con córners del local en casa y del visitante fuera (la muestra). */
  homeMatches: number;
  awayMatches: number;
}

interface Sample {
  homeId: number;
  awayId: number;
  home: number;
  away: number;
  weight: number;
}

function samples(prior: MatchResult[], at: number): Sample[] {
  const out: Sample[] = [];
  for (const m of prior) {
    const home = m.home_stats?.corners;
    const away = m.away_stats?.corners;
    const t = Date.parse(m.date);
    if (home === null || home === undefined || away === null || away === undefined || !(t < at)) continue;
    out.push({
      homeId: m.home_team_id,
      awayId: m.away_team_id,
      home: Math.min(home, CORNER_CAP),
      away: Math.min(away, CORNER_CAP),
      weight: Math.exp((-DECAY_PER_DAY * (at - t)) / DAY_MS),
    });
  }
  return out;
}

/** Probabilidades de 0..MAX córners: binomial negativa (var = μ + α μ²) o Poisson si α ≈ 0. */
export function countPmf(mean: number, alpha: number): number[] {
  const pmf = new Array<number>(MAX_CORNERS + 1);
  if (alpha < 1e-6) {
    pmf[0] = Math.exp(-mean);
    for (let k = 1; k <= MAX_CORNERS; k++) pmf[k] = (pmf[k - 1] * mean) / k;
  } else {
    const r = 1 / alpha;
    const q = mean / (r + mean);
    pmf[0] = Math.pow(r / (r + mean), r);
    for (let k = 1; k <= MAX_CORNERS; k++) pmf[k] = (pmf[k - 1] * (k - 1 + r) * q) / k;
  }
  const total = pmf.reduce((a, b) => a + b, 0);
  return pmf.map((p) => p / total);
}

/** P(local saca más), P(mismos), P(visitante saca más) con dos distribuciones independientes. */
export function duelProbabilities(homePmf: number[], awayPmf: number[]): { home: number; draw: number; away: number } {
  let home = 0;
  let draw = 0;
  let awayCdf = 0;
  for (let k = 0; k < homePmf.length; k++) {
    draw += homePmf[k] * (awayPmf[k] ?? 0);
    home += homePmf[k] * awayCdf;
    awayCdf += awayPmf[k] ?? 0;
  }
  return { home, draw, away: Math.max(0, 1 - home - draw) };
}

/** Pronóstico del duelo de córners de un partido con sus partidos anteriores
 * (de cualquier orden: se filtran por fecha). null sin datos de la liga. */
export function cornerDuelForecast(
  match: Pick<Match, "date" | "home_team_id" | "away_team_id">,
  prior: MatchResult[],
): DuelForecast | null {
  const data = samples(prior, Date.parse(match.date));
  const totalWeight = data.reduce((s, d) => s + d.weight, 0);
  if (totalWeight === 0) return null;
  const leagueHome = data.reduce((s, d) => s + d.weight * d.home, 0) / totalWeight;
  const leagueAway = data.reduce((s, d) => s + d.weight * d.away, 0) / totalWeight;
  if (leagueHome <= 0 || leagueAway <= 0) return null;

  // Dispersión común por momentos: var = μ + α μ² (cada lado con su media).
  const variance =
    data.reduce((s, d) => s + d.weight * ((d.home - leagueHome) ** 2 + (d.away - leagueAway) ** 2), 0) / (2 * totalWeight);
  const meanBoth = (leagueHome + leagueAway) / 2;
  const alpha = Math.max(0, (variance - meanBoth) / meanBoth ** 2);

  const shrunk = (rows: Sample[], value: (d: Sample) => number, prior: number) =>
    (rows.reduce((s, d) => s + d.weight * value(d), 0) + SHRINK_MATCHES * prior) /
    (rows.reduce((s, d) => s + d.weight, 0) + SHRINK_MATCHES);
  const homeAtHome = data.filter((d) => d.homeId === match.home_team_id);
  const awayAway = data.filter((d) => d.awayId === match.away_team_id);
  const homeFor = shrunk(homeAtHome, (d) => d.home, leagueHome);
  const homeAgainst = shrunk(homeAtHome, (d) => d.away, leagueAway);
  const awayFor = shrunk(awayAway, (d) => d.away, leagueAway);
  const awayAgainst = shrunk(awayAway, (d) => d.home, leagueHome);

  const homeExpected = (homeFor * awayAgainst) / leagueHome;
  const awayExpected = (awayFor * homeAgainst) / leagueAway;
  const p = duelProbabilities(countPmf(homeExpected, alpha), countPmf(awayExpected, alpha));
  return {
    homeExpected,
    awayExpected,
    ...p,
    homeNotLose: p.home + p.draw,
    awayNotLose: p.away + p.draw,
    homeMatches: homeAtHome.length,
    awayMatches: awayAway.length,
  };
}
