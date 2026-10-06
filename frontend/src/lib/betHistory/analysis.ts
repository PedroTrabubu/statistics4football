/** Análisis de un historial de apuestas: dinero, acierto frente a la cuota, y en qué se gana y se pierde. */

import type { BetLeg, ParsedBet } from "./types";
import { inferSport } from "./winamax";

/** Una apuesta resuelta, con el dinero ya interpretado. */
export interface SettledBet {
  bet: ParsedBet;
  /** true/false si se ganó o perdió; null en un cash out (ni una cosa ni otra). */
  hit: boolean | null;
  /** Dinero propio arriesgado (0 en freebets). */
  ownStake: number;
  freebetStake: number;
  /** Beneficio neto: con dinero propio, retorno - importe; con freebets, lo ganado. */
  profit: number;
  /** Probabilidad que implica la cuota (1/cuota), si se conoce. */
  implied: number | null;
  placedAt: Date | null;
}

export function settle(bet: ParsedBet): SettledBet | null {
  if (!["won", "lost", "cashout"].includes(bet.status) || bet.stake === null) return null;
  const odds = bet.odds && bet.odds > 1 ? bet.odds : null;
  let profit: number;
  if (bet.freebet) {
    profit = bet.returned ?? (bet.status === "won" && odds ? bet.stake * (odds - 1) : 0);
  } else {
    const returned = bet.returned ?? (bet.status === "won" && odds ? bet.stake * odds : 0);
    profit = returned - bet.stake;
  }
  return {
    bet,
    hit: bet.status === "cashout" ? null : bet.status === "won",
    ownStake: bet.freebet ? 0 : bet.stake,
    freebetStake: bet.freebet ? bet.stake : 0,
    profit: Math.round(profit * 100) / 100,
    implied: odds ? 1 / odds : null,
    placedAt: bet.placedAt ? new Date(bet.placedAt) : null,
  };
}

export interface GroupStats {
  key: string;
  bets: number;
  /** Apuestas con acierto conocido (sin cash out). */
  decided: number;
  wins: number;
  hitRate: number | null;
  /** Acierto medio que implicaban las cuotas de esas apuestas. */
  impliedRate: number | null;
  ownStaked: number;
  profit: number;
  /** Beneficio sobre el dinero propio apostado. */
  roi: number | null;
  freebetBets: number;
}

export function stats(key: string, rows: SettledBet[]): GroupStats {
  const decided = rows.filter((r) => r.hit !== null);
  const wins = decided.filter((r) => r.hit).length;
  const withOdds = decided.filter((r) => r.implied !== null);
  const ownStaked = rows.reduce((s, r) => s + r.ownStake, 0);
  const profit = rows.reduce((s, r) => s + r.profit, 0);
  return {
    key,
    bets: rows.length,
    decided: decided.length,
    wins,
    hitRate: decided.length ? wins / decided.length : null,
    impliedRate: withOdds.length ? withOdds.reduce((s, r) => s + (r.implied ?? 0), 0) / withOdds.length : null,
    ownStaked: round2(ownStaked),
    profit: round2(profit),
    roi: ownStaked > 0 ? profit / ownStaked : null,
    freebetBets: rows.filter((r) => r.bet.freebet).length,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function groupBy(rows: SettledBet[], keyOf: (r: SettledBet) => string | null, order?: string[]): GroupStats[] {
  const groups = new Map<string, SettledBet[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (k === null) continue;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out = [...groups].map(([k, rs]) => stats(k, rs));
  if (order) return out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return out.sort((a, b) => b.bets - a.bets || a.key.localeCompare(b.key, "es"));
}

// --- Dimensiones ----------------------------------------------------------------

export const ODDS_BUCKETS: [number, number, string][] = [
  [1, 1.3, "1,01 – 1,29"],
  [1.3, 1.6, "1,30 – 1,59"],
  [1.6, 2, "1,60 – 1,99"],
  [2, 3, "2,00 – 2,99"],
  [3, 5, "3,00 – 4,99"],
  [5, 8, "5,00 – 7,99"],
  [8, Infinity, "8,00 o más"],
];

export function oddsBucket(odds: number | null): string | null {
  if (!odds || odds <= 1) return null;
  return ODDS_BUCKETS.find(([lo, hi]) => odds >= lo && odds < hi)?.[2] ?? null;
}

export const TYPE_ORDER = ["Simple", "Combinada de 2", "Combinada de 3", "Combinada de 4", "Combinada de 5 o más", "Otro"];

export function betType(bet: ParsedBet): string {
  if (bet.type === "simple") return "Simple";
  if (bet.type === "combinada") return bet.legsCount >= 5 ? "Combinada de 5 o más" : `Combinada de ${Math.max(bet.legsCount, 2)}`;
  return "Otro";
}

export const STAKE_BUCKETS: [number, number, string][] = [
  [0, 2, "Hasta 2 €"],
  [2, 5, "2 – 5 €"],
  [5, 10, "5 – 10 €"],
  [10, 25, "10 – 25 €"],
  [25, 50, "25 – 50 €"],
  [50, Infinity, "Más de 50 €"],
];

export function stakeBucket(r: SettledBet): string | null {
  if (r.bet.freebet || r.bet.stake === null) return null;
  const s = r.bet.stake;
  return STAKE_BUCKETS.find(([lo, hi]) => s > lo && s <= hi)?.[2] ?? (s === 0 ? null : STAKE_BUCKETS[0][2]);
}

export const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

export function weekday(r: SettledBet): string | null {
  return r.placedAt ? WEEKDAYS[(r.placedAt.getDay() + 6) % 7] : null;
}

export const DAY_PARTS = ["Madrugada (0–6 h)", "Mañana (6–14 h)", "Tarde (14–20 h)", "Noche (20–24 h)"];

export function dayPart(r: SettledBet): string | null {
  if (!r.placedAt) return null;
  const h = r.placedAt.getHours();
  return DAY_PARTS[h < 6 ? 0 : h < 14 ? 1 : h < 20 ? 2 : 3];
}

/** Familia de mercado a partir del texto de Winamax. */
export function marketFamily(market: string, pick = ""): string {
  const m = `${market} ${pick}`.toLowerCase();
  if (m.includes("crea tu apuesta")) return "Crea tu apuesta";
  if (/c[oó]rner/.test(m)) return "Córners";
  if (/tarjeta|expulsi/.test(m)) return "Tarjetas";
  if (m.includes("ambos equipos marcan")) return "Ambos marcan";
  if (m.includes("doble oportunidad")) return "Doble oportunidad";
  if (/h[aá]ndicap/.test(m)) return "Hándicap";
  if (/goleador|marcar[aá]|anota|jugador decisivo/.test(m)) return "Goleadores / jugador";
  if (/primera mitad|segunda mitad|descanso|1[ªa] parte|2[ªa] parte/.test(m)) return "Por mitades";
  if (/juego/.test(m)) return "Juegos (tenis)";
  if (/\bset\b/.test(m)) return "Sets (tenis)";
  if (/\bgoles?\b|m[aá]s de|menos de/.test(m)) return "Goles";
  if (/resultado|1x2|ganador/.test(m)) return "Resultado / ganador";
  return "Otros";
}

/** Mercado de una apuesta simple; las combinadas no tienen un solo mercado. */
export function singleMarket(r: SettledBet): string | null {
  if (r.bet.type !== "simple" || r.bet.legs.length !== 1) return null;
  const leg = r.bet.legs[0];
  return marketFamily(leg.market, leg.pick);
}

// --- Resumen, evolución y hábitos ---------------------------------------------

export interface Summary extends GroupStats {
  /** Perdidas (decided - wins). */
  losses: number;
  /** Cash outs: cuentan para el dinero pero no para el acierto (bets - decided). */
  cashouts: number;
  totalImported: number;
  voids: number;
  pending: number;
  freebetStake: number;
  freebetProfit: number;
  ownProfit: number;
}

export function summarize(bets: ParsedBet[], settled: SettledBet[]): Summary {
  const base = stats("total", settled);
  const fb = settled.filter((r) => r.bet.freebet);
  const own = settled.filter((r) => !r.bet.freebet);
  return {
    ...base,
    losses: base.decided - base.wins,
    cashouts: base.bets - base.decided,
    totalImported: bets.length,
    voids: bets.filter((b) => b.status === "void").length,
    pending: bets.filter((b) => b.status === "pending" || b.status === "unknown").length,
    freebetStake: round2(fb.reduce((s, r) => s + r.freebetStake, 0)),
    freebetProfit: round2(fb.reduce((s, r) => s + r.profit, 0)),
    ownProfit: round2(own.reduce((s, r) => s + r.profit, 0)),
  };
}

/** Beneficio acumulado apuesta a apuesta, en orden cronológico. */
export function cumulativeProfit(settled: SettledBet[]): { date: Date; profit: number }[] {
  let acc = 0;
  return chronological(settled).map((r) => {
    acc += r.profit;
    return { date: r.placedAt as Date, profit: round2(acc) };
  });
}

function chronological(settled: SettledBet[]): SettledBet[] {
  return settled.filter((r) => r.placedAt).sort((a, b) => (a.placedAt as Date).getTime() - (b.placedAt as Date).getTime());
}

export interface Habits {
  longestLosingStreak: number;
  longestWinningStreak: number;
  /** Importe medio (dinero propio) de la apuesta siguiente a una perdida / a una ganada. */
  stakeAfterLoss: number | null;
  stakeAfterWin: number | null;
  afterLossSamples: number;
  afterWinSamples: number;
}

export function habits(settled: SettledBet[]): Habits {
  const ordered = chronological(settled).filter((r) => r.hit !== null);
  let lose = 0;
  let win = 0;
  let maxLose = 0;
  let maxWin = 0;
  const afterLoss: number[] = [];
  const afterWin: number[] = [];
  ordered.forEach((r, i) => {
    if (r.hit) {
      win += 1;
      lose = 0;
    } else {
      lose += 1;
      win = 0;
    }
    maxLose = Math.max(maxLose, lose);
    maxWin = Math.max(maxWin, win);
    const next = ordered[i + 1];
    if (next && !next.bet.freebet && next.ownStake > 0) (r.hit ? afterWin : afterLoss).push(next.ownStake);
  });
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  return {
    longestLosingStreak: maxLose,
    longestWinningStreak: maxWin,
    stakeAfterLoss: avg(afterLoss),
    stakeAfterWin: avg(afterWin),
    afterLossSamples: afterLoss.length,
    afterWinSamples: afterWin.length,
  };
}

export interface BuilderSelectionStats {
  family: string;
  selections: number;
  won: number;
  hitRate: number;
}

/** Acierto de cada selección dentro de los "Crea tu apuesta" (la casa da el resultado de cada una). */
export function builderSelections(settled: SettledBet[]): BuilderSelectionStats[] {
  const groups = new Map<string, { n: number; won: number }>();
  for (const r of settled) {
    for (const leg of r.bet.legs) {
      for (const s of leg.selections) {
        if (s.result === null || s.result === "void") continue;
        const family = marketFamily(s.market, s.pick);
        const g = groups.get(family) ?? { n: 0, won: 0 };
        g.n += 1;
        if (s.result === "won") g.won += 1;
        groups.set(family, g);
      }
    }
  }
  return [...groups]
    .map(([family, g]) => ({ family, selections: g.n, won: g.won, hitRate: g.won / g.n }))
    .sort((a, b) => b.selections - a.selections);
}

export interface Leak {
  dimension: string;
  group: GroupStats;
}

/** Las categorías donde más dinero se pierde (con al menos `minBets` apuestas). */
export function biggestLeaks(dimensions: Record<string, GroupStats[]>, minBets = 5, limit = 3): Leak[] {
  return Object.entries(dimensions)
    .flatMap(([dimension, groups]) => groups.map((group) => ({ dimension, group })))
    .filter((l) => l.group.bets >= minBets && l.group.profit < 0)
    .sort((a, b) => a.group.profit - b.group.profit)
    .slice(0, limit);
}

export const NO_PROMOTION = "Sin promoción";

/** Por promoción: una apuesta con varias promociones cuenta en cada una. */
export function promotionGroups(settled: SettledBet[]): GroupStats[] {
  const groups = new Map<string, SettledBet[]>();
  for (const r of settled) {
    const promos = r.bet.promotions?.length ? r.bet.promotions : [NO_PROMOTION];
    for (const p of promos) groups.set(p, [...(groups.get(p) ?? []), r]);
  }
  return [...groups]
    .map(([k, rs]) => stats(k, rs))
    .sort((a, b) => Number(a.key === NO_PROMOTION) - Number(b.key === NO_PROMOTION) || b.bets - a.bets);
}

// --- Vista mensual, "sin promociones" y frases de resumen ----------------------

/**
 * Mes ("2026-10") en que se hizo la apuesta. placedAt guarda la hora tal como
 * la muestra Winamax a una cuenta española (Europe/Madrid), así que el mes sale
 * del propio texto sin convertir zonas horarias: una apuesta a las 00:30 del
 * 1 de noviembre es de noviembre sea cual sea la zona del navegador.
 */
export function monthKey(bet: ParsedBet): string | null {
  const m = bet.placedAt?.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** Estadísticas por mes, en orden cronológico. */
export function monthlyStats(settled: SettledBet[]): GroupStats[] {
  return groupBy(settled, (r) => monthKey(r.bet)).sort((a, b) => a.key.localeCompare(b.key));
}

/** Año ("2026") en que se hizo la apuesta; igual que monthKey, sale del propio texto de la fecha. */
export function yearKey(bet: ParsedBet): string | null {
  const m = bet.placedAt?.match(/^(\d{4})/);
  return m ? m[1] : null;
}

/** ¿La apuesta es del periodo elegido? `key` es un mes ("2026-10") o un año ("2026"). */
export function inPeriod(bet: ParsedBet, key: string): boolean {
  return /^\d{4}$/.test(key) ? yearKey(bet) === key : monthKey(bet) === key;
}

/** "octubre de 2026" (largo) u "oct 26" (corto); un año ("2026") se deja tal cual. */
export function monthLabel(key: string, style: "long" | "short" = "long"): string {
  if (/^\d{4}$/.test(key)) return key;
  const [y, m] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, 15));
  return style === "long"
    ? date.toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" })
    : date.toLocaleDateString("es-ES", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export function hasPromotion(bet: ParsedBet): boolean {
  return (bet.promotions?.length ?? 0) > 0;
}

/** Quita las apuestas con alguna promoción. Cada apuesta sale una sola vez aunque tenga dos promociones. */
export function withoutPromotions(bets: ParsedBet[]): ParsedBet[] {
  return bets.filter((b) => !hasPromotion(b));
}

/** Mínimo de apuestas para sacar conclusiones en las frases de resumen. */
export const INSIGHT_MIN_BETS = 20;
export const PROMO_INSIGHT_MIN_BETS = 5;

function eur(n: number): string {
  const s = n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
  return n > 0 ? `+${s}` : s;
}

function roiText(g: GroupStats): string {
  return g.roi === null ? "sin ROI" : `ROI ${g.roi > 0 ? "+" : ""}${(g.roi * 100).toFixed(0)}%`;
}

function bestAndWorst(groups: GroupStats[], label: string): string | null {
  const eligible = groups.filter((g) => g.bets >= INSIGHT_MIN_BETS && !["Desconocido", "Otros"].includes(g.key));
  if (eligible.length < 2) return null;
  const sorted = [...eligible].sort((a, b) => b.profit - a.profit);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  if (best.profit === worst.profit) return null;
  return (
    `Por ${label}, te va mejor en ${best.key} (${eur(best.profit)}, ${roiText(best)}, ${best.bets} apuestas) ` +
    `y peor en ${worst.key} (${eur(worst.profit)}, ${roiText(worst)}, ${worst.bets} apuestas).`
  );
}

/** Diferencia de ROI entre "con" y "sin" promoción a partir de la cual se menciona en el resumen. */
export const PROMO_GAP_ROI = 0.15;

/**
 * Una o dos frases con lo más llamativo de los datos, con umbrales para no
 * sacar conclusiones de muestras pequeñas:
 * 1. si el resultado con promoción y sin promoción es muy distinto;
 * 2. si una promoción aporta más de la mitad del beneficio (o hay pérdidas y ella gana);
 * 3. el deporte con mejor y peor resultado;
 * 4. el mercado (apuestas simples) con mejor y peor resultado.
 */
export function insights(settled: SettledBet[], max = 2): string[] {
  const out: string[] = [];
  const total = stats("total", settled);

  const withPromo = stats("con", settled.filter((r) => hasPromotion(r.bet)));
  const withoutPromo = stats("sin", settled.filter((r) => !hasPromotion(r.bet)));
  if (
    withPromo.bets >= PROMO_INSIGHT_MIN_BETS &&
    withoutPromo.bets >= 10 &&
    withPromo.roi !== null &&
    withoutPromo.roi !== null &&
    Math.abs(withPromo.roi - withoutPromo.roi) >= PROMO_GAP_ROI
  ) {
    out.push(
      `Con promoción llevas ${eur(withPromo.profit)} (${roiText(withPromo)}) en ${withPromo.bets} apuestas; ` +
        `sin promoción, ${eur(withoutPromo.profit)} (${roiText(withoutPromo)}) en ${withoutPromo.bets}.`,
    );
  }

  const promo = promotionGroups(settled)
    .filter((g) => g.key !== NO_PROMOTION && g.bets >= PROMO_INSIGHT_MIN_BETS && g.profit > 0)
    .sort((a, b) => b.profit - a.profit)[0];
  if (promo && (total.profit <= 0 || promo.profit > 0.5 * total.profit)) {
    const rest = stats("rest", settled.filter((r) => !(r.bet.promotions ?? []).includes(promo.key)));
    const share =
      total.profit <= 0
        ? `${promo.key} te deja ${eur(promo.profit)} en ${promo.bets} apuestas, aunque en total vas ${eur(total.profit)}.`
        : promo.profit > total.profit
          ? `${promo.key} aporta ${eur(promo.profit)} en ${promo.bets} apuestas, más que todo tu beneficio (${eur(total.profit)}).`
          : `Más de la mitad de tu beneficio viene de ${promo.key}: ${eur(promo.profit)} de ${eur(total.profit)}, en ${promo.bets} apuestas.`;
    out.push(`${share} Sin ${promo.key}, tu resultado sería ${eur(rest.profit)} (${roiText(rest)}) en ${rest.bets} apuestas.`);
  }

  const sport = bestAndWorst(groupBy(settled, (r) => sportOf(r.bet)), "deporte");
  if (sport) out.push(sport);
  const market = bestAndWorst(groupBy(settled, singleMarket), "mercado (apuestas simples)");
  if (market) out.push(market);
  return out.slice(0, max);
}

// --- Deporte re-deducido, vista mensual en dos series y rachas -----------------

function legSport(leg: BetLeg): string {
  if (leg.sport && leg.sport !== "Desconocido") return leg.sport;
  const texts = leg.builder ? leg.selections.map((s) => s.market) : [leg.market, leg.pick];
  const pairs = leg.score ? leg.score.split(" ").length : 0;
  return inferSport(texts, false, pairs * 2, leg.participants);
}

/**
 * Deporte de la apuesta. Si se guardó como «Desconocido» (p. ej. importada con
 * una versión anterior del lector), se vuelve a deducir a partir de las
 * selecciones y los nombres de los participantes.
 */
export function sportOf(bet: ParsedBet): string {
  if (bet.sport && bet.sport !== "Desconocido") return bet.sport;
  const sports = [...new Set(bet.legs.map(legSport).filter((s) => s !== "Desconocido"))];
  if (sports.length === 1) return sports[0];
  return sports.length > 1 ? "Varios" : "Desconocido";
}

export interface MonthSplit {
  key: string;
  total: GroupStats;
  withPromo: GroupStats;
  withoutPromo: GroupStats;
}

/** Por periodo (mes o año), el total y su desglose con / sin promoción (cada apuesta cuenta una vez). */
function periodSplit(settled: SettledBet[], keyOf: (bet: ParsedBet) => string | null): MonthSplit[] {
  return groupBy(settled, (r) => keyOf(r.bet))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((total) => {
      const rows = settled.filter((r) => keyOf(r.bet) === total.key);
      return {
        key: total.key,
        total,
        withPromo: stats(total.key, rows.filter((r) => hasPromotion(r.bet))),
        withoutPromo: stats(total.key, rows.filter((r) => !hasPromotion(r.bet))),
      };
    });
}

export function monthlySplit(settled: SettledBet[]): MonthSplit[] {
  return periodSplit(settled, monthKey);
}

export function yearlySplit(settled: SettledBet[]): MonthSplit[] {
  return periodSplit(settled, yearKey);
}

/**
 * Racha más larga de apuestas perdidas que cabe esperar por puro azar con un
 * acierto `hitRate` en `n` apuestas: aproximadamente log(n·p) / log(1/(1-p)).
 */
export function expectedLongestLosingStreak(n: number, hitRate: number | null): number | null {
  if (!hitRate || hitRate <= 0 || hitRate >= 1 || n < 10) return null;
  return Math.max(1, Math.round(Math.log(n * hitRate) / Math.log(1 / (1 - hitRate))));
}
