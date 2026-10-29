/** Lo común de las evaluaciones del predictor de estadísticas
 * (docs/PREDICTOR_ESTADISTICAS_PROTOCOLO.md): datos de la API, bases (a) y (b),
 * errores por partido y remuestreo con semilla. */

import type { MatchResult } from "../src/api/types";
import { statValue, type StatKey } from "../src/lib/statsPredictor";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";
/** Las seis ligas de la web sin la Champions. */
export const LEAGUES = ["ENG-Premier League", "ESP-La Liga", "ESP-La Liga 2", "FRA-Ligue 1", "GER-Bundesliga", "ITA-Serie A"];
export const BOOTSTRAP_SAMPLES = 2000;
export const BOOTSTRAP_SEED = 20261027;

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export async function get<T>(path: string): Promise<T> {
  const response = await fetch(new URL(path, API_URL));
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} — ${path}`);
  return (await response.json()) as T;
}

/** "2526" -> "2425". */
export function previousSeason(season: string): string {
  const start = Number(season.slice(0, 2)) - 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(start)}${pad(start + 1)}`;
}

/** Generador pseudoaleatorio con semilla (mulberry32), como el de lib/streaks.ts. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Errores absolutos de un partido en una estadística, por método: uno por
 * equipo con dato (todos los métodos, las mismas observaciones). */
export interface MatchErrors {
  league: string;
  season: string;
  errors: Record<string, number[]>;
}

/** Bases (a) y (b) con los partidos anteriores: mismo filtro que el modelo
 * (fecha anterior y las dos cifras del partido). */
export function baselines(prior: MatchResult[], key: StatKey, at: number, homeId: number, awayId: number) {
  const homeVals: number[] = [];
  const awayVals: number[] = [];
  const homeTeam: number[] = [];
  const awayTeam: number[] = [];
  for (const m of prior) {
    const h = statValue(m.home_stats, key);
    const a = statValue(m.away_stats, key);
    if (h === null || a === null || !(Date.parse(m.date) < at)) continue;
    homeVals.push(h);
    awayVals.push(a);
    if (m.home_team_id === homeId) homeTeam.push(h);
    if (m.away_team_id === awayId) awayTeam.push(a);
  }
  const leagueHome = mean(homeVals);
  const leagueAway = mean(awayVals);
  return {
    leagueHome,
    leagueAway,
    teamHome: mean(homeTeam) ?? leagueHome,
    teamAway: mean(awayTeam) ?? leagueAway,
  };
}

/** MAE y RMSE de un método. */
export function score(rows: MatchErrors[], method: string) {
  const errors = rows.flatMap((r) => r.errors[method]);
  return { mae: mean(errors)!, rmse: Math.sqrt(errors.reduce((s, x) => s + x * x, 0) / errors.length), n: errors.length };
}

/** Intervalo al 95 % de MAE(`method`) − MAE(`base`), remuestreando partidos. */
export function bootstrap(rows: MatchErrors[], method: string, base: string, random: () => number): [number, number] {
  const diffs: number[] = [];
  for (let r = 0; r < BOOTSTRAP_SAMPLES; r++) {
    let model = 0;
    let other = 0;
    let n = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[Math.floor(random() * rows.length)];
      for (const e of row.errors[method]) model += e;
      for (const e of row.errors[base]) other += e;
      n += row.errors[method].length;
    }
    diffs.push((model - other) / n);
  }
  diffs.sort((a, b) => a - b);
  return [diffs[Math.floor(0.025 * BOOTSTRAP_SAMPLES)], diffs[Math.ceil(0.975 * BOOTSTRAP_SAMPLES) - 1]];
}

export const fmt = (x: number, d: number) => x.toFixed(d);
export const ci = ([lo, hi]: [number, number], d: number) => `[${fmt(lo, d)}, ${fmt(hi, d)}]`;
