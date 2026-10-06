/** Promociones frente al resto: desglose, promociones de importe fijo y evidencia estadística. */

import { hasPromotion, stats, type GroupStats, type SettledBet } from "./analysis";

export interface PromoSplit {
  total: GroupStats;
  /** Apuestas con al menos una promoción; cada apuesta cuenta una sola vez. */
  withPromo: GroupStats;
  withoutPromo: GroupStats;
}

/** Con promoción + sin promoción = total (a diferencia de la tabla «Por promoción», donde una apuesta con dos promociones cuenta en las dos). */
export function promoSplit(settled: SettledBet[]): PromoSplit {
  return {
    total: stats("Total", settled),
    withPromo: stats("Con promoción", settled.filter((r) => hasPromotion(r.bet))),
    withoutPromo: stats("Sin promoción", settled.filter((r) => !hasPromotion(r.bet))),
  };
}

/**
 * Promociones de importe fijo: todas sus apuestas tienen el mismo importe
 * (p. ej. La Gran Supercuota, siempre 10 €). Alteran la media de importes.
 */
export function fixedStakePromotions(settled: SettledBet[], minBets = 3): string[] {
  const stakes = new Map<string, Set<number>>();
  const counts = new Map<string, number>();
  for (const r of settled) {
    for (const p of r.bet.promotions ?? []) {
      stakes.set(p, (stakes.get(p) ?? new Set()).add(r.bet.stake ?? -1));
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  return [...stakes].filter(([p, s]) => s.size === 1 && (counts.get(p) ?? 0) >= minBets).map(([p]) => p);
}

/** Apuestas que no tienen ninguna de esas promociones. */
export function excludingPromotions(settled: SettledBet[], promos: string[]): SettledBet[] {
  return settled.filter((r) => !(r.bet.promotions ?? []).some((p) => promos.includes(p)));
}

/** Intervalo de confianza de Wilson para una proporción (95 % con z = 1,96). */
export function wilson(wins: number, n: number, z = 1.96): [number, number] | null {
  if (n === 0) return null;
  const p = wins / n;
  const z2 = z * z;
  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export interface PromoEvidence {
  promo: string;
  bets: number;
  decided: number;
  wins: number;
  hitRate: number | null;
  profit: number;
  avgOdds: number | null;
  /** Acierto necesario para no ganar ni perder: 1 / cuota media. */
  breakEven: number | null;
  ci: [number, number] | null;
  /** El límite inferior del intervalo supera el acierto necesario. */
  supported: boolean;
}

export function promoEvidence(settled: SettledBet[], promo: string): PromoEvidence | null {
  const rows = settled.filter((r) => (r.bet.promotions ?? []).includes(promo));
  if (rows.length === 0) return null;
  const g = stats(promo, rows);
  const odds = rows.filter((r) => r.hit !== null && r.bet.odds && r.bet.odds > 1).map((r) => r.bet.odds as number);
  const avgOdds = odds.length ? odds.reduce((s, o) => s + o, 0) / odds.length : null;
  const breakEven = avgOdds ? 1 / avgOdds : null;
  const ci = wilson(g.wins, g.decided);
  return {
    promo,
    bets: g.bets,
    decided: g.decided,
    wins: g.wins,
    hitRate: g.hitRate,
    profit: g.profit,
    avgOdds,
    breakEven,
    ci,
    supported: ci !== null && breakEven !== null && ci[0] > breakEven,
  };
}
