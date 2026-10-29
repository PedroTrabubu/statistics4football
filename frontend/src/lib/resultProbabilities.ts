/** Porcentajes de resultado: lo que se pinta a partir de las tres
 * probabilidades guardadas (local, empate, visitante). La doble oportunidad
 * es su suma, así que siempre cuadra con el 1X2. */

export const OUTCOMES = ["home", "draw", "away"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const DOUBLE_CHANCES = ["1X", "X2", "12"] as const;
export type DoubleChance = (typeof DOUBLE_CHANCES)[number];

/** Nivel "Alta confianza": solo en doble oportunidad (en 1X2 su cobertura no llega al 3 %). */
export const HIGH_CONFIDENCE = 0.8;

/** Porcentajes enteros que suman 100 (resto mayor). */
export function roundTo100(values: number[]): number[] {
  const raw = values.map((v) => v * 100);
  const floor = raw.map(Math.floor);
  let left = 100 - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - floor[i], i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    floor[i] += 1;
    left -= 1;
  }
  return floor;
}

/** 1X, X2 y 12 sumando las 1X2 (vale con probabilidades o con porcentajes). */
export function doubleChances([home, draw, away]: number[]): number[] {
  return [home + draw, draw + away, home + away];
}

/** La mejor doble oportunidad: la que deja fuera el resultado menos probable. */
export function bestDoubleChance(probs: number[]): number {
  const least = probs.indexOf(Math.min(...probs));
  return least === 2 ? 0 : least === 0 ? 1 : 2;
}

export function outcomeOf(homeGoals: number, awayGoals: number): Outcome {
  return homeGoals > awayGoals ? "home" : homeGoals < awayGoals ? "away" : "draw";
}

/** Si una doble oportunidad se cumplió con ese resultado. */
export function doubleChanceHit(dc: DoubleChance, outcome: Outcome): boolean {
  return dc === "1X" ? outcome !== "away" : dc === "X2" ? outcome !== "home" : outcome !== "draw";
}

/** Aciertos de un equipo (o de la liga): el resultado más probable y la mejor doble oportunidad. */
export interface HitCount {
  hits: number;
  n: number;
}

export interface TeamHits {
  team: string;
  top: HitCount;
  double: HitCount;
}

type Probabilities = { match_id: number; status: string; p_home: number | null; p_draw: number | null; p_away: number | null };
type PlayedMatch = { id: number; home_team: string; away_team: string; home_goals: number | null; away_goals: number | null };

/** Aciertos de una temporada: por equipo y de la liga entera, más la
 * referencia de elegir siempre 1X en los mismos partidos. */
export interface SeasonHits {
  teams: TeamHits[];
  league: TeamHits;
  always1x: HitCount;
}

/** Tabla de aciertos por equipo: en cada partido jugado con porcentajes, si
 * se cumplió el resultado más probable y la mejor doble oportunidad. Cada
 * partido cuenta para los dos equipos y una vez para la liga. Orden: mejor
 * doble oportunidad, luego resultado más probable y más partidos. */
export function teamHitTable(predictions: Probabilities[], matches: PlayedMatch[]): SeasonHits {
  const byMatch = new Map(predictions.map((p) => [p.match_id, p]));
  const teams = new Map<string, TeamHits>();
  const league: TeamHits = { team: "", top: { hits: 0, n: 0 }, double: { hits: 0, n: 0 } };
  const always1x: HitCount = { hits: 0, n: 0 };
  const add = (row: TeamHits, topHit: boolean, doubleHit: boolean) => {
    row.top.n += 1;
    row.top.hits += topHit ? 1 : 0;
    row.double.n += 1;
    row.double.hits += doubleHit ? 1 : 0;
  };
  for (const m of matches) {
    const p = byMatch.get(m.id);
    if (m.home_goals === null || m.away_goals === null || !p || p.status !== "ok") continue;
    if (p.p_home === null || p.p_draw === null || p.p_away === null) continue;
    const probs = [p.p_home, p.p_draw, p.p_away];
    const actual = outcomeOf(m.home_goals, m.away_goals);
    const topHit = OUTCOMES[probs.indexOf(Math.max(...probs))] === actual;
    const doubleHit = doubleChanceHit(DOUBLE_CHANCES[bestDoubleChance(probs)], actual);
    add(league, topHit, doubleHit);
    always1x.n += 1;
    always1x.hits += actual !== "away" ? 1 : 0;
    for (const team of [m.home_team, m.away_team]) {
      let row = teams.get(team);
      if (!row) teams.set(team, (row = { team, top: { hits: 0, n: 0 }, double: { hits: 0, n: 0 } }));
      add(row, topHit, doubleHit);
    }
  }
  const rate = (c: HitCount) => (c.n ? c.hits / c.n : 0);
  const sorted = [...teams.values()].sort(
    (a, b) =>
      rate(b.double) - rate(a.double) || rate(b.top) - rate(a.top) || b.double.n - a.double.n || a.team.localeCompare(b.team),
  );
  return { teams: sorted, league, always1x };
}
