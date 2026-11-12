/**
 * Apuestas inventadas para ver «Mis apuestas» sin importar nada: equipos,
 * tenistas y promociones genéricos, sin nombres reales. Se generan con una
 * semilla fija (siempre las mismas) y solo viven en memoria: nunca se guardan.
 */

import type { BetLeg, BetStatus, Bookmaker, ParsedBet } from "./types";

export const EXAMPLE_SIZE = 150;
/** Meses hacia atrás desde hoy en los que se reparten las apuestas. */
const EXAMPLE_MONTHS = 10;

const TEAMS = [
  "Equipo Azul",
  "Equipo Rojo",
  "Equipo Verde",
  "Equipo Blanco",
  "Equipo Negro",
  "Equipo Gris",
  "Equipo Oro",
  "Equipo Plata",
  "Equipo Granate",
  "Equipo Celeste",
];
const PLAYERS = ["Tenista Uno", "Tenista Dos", "Tenista Tres", "Tenista Cuatro", "Tenista Cinco", "Tenista Seis"];
const BASKET = ["Quinteto Norte", "Quinteto Sur", "Quinteto Este", "Quinteto Oeste"];

/** Promoción de importe fijo con buen acierto (para ver el recuadro de la Supercuota) y otra de cuota mejorada. */
const SUPERCUOTA = "Supercuota";
const BOOST = "Cuota mejorada";
const STAKES = [1, 2, 2, 5, 5, 5, 10, 10, 20];

/** Generador pseudoaleatorio con semilla (mulberry32): mismas apuestas en cada visita. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const round2 = (n: number) => Math.round(n * 100) / 100;

interface Pick {
  sport: string;
  participants: string[];
  market: string;
  pick: string;
  odds: number;
}

/** Una selección inventada de fútbol, tenis o baloncesto. */
function makePick(rnd: () => number): Pick {
  const from = <T,>(list: T[]) => list[Math.floor(rnd() * list.length)];
  const odds = (lo: number, hi: number) => round2(lo + rnd() * (hi - lo));
  const roll = rnd();
  if (roll < 0.2) {
    const [a, b] = pair(PLAYERS, rnd);
    const winner = rnd() < 0.5 ? a : b;
    const short = `${winner.split(" ")[0][0]}. ${winner.split(" ")[1]}`;
    return rnd() < 0.6
      ? { sport: "Tenis", participants: [a, b], market: "Ganador", pick: short, odds: odds(1.25, 3.2) }
      : { sport: "Tenis", participants: [a, b], market: "1er set - Ganador", pick: short, odds: odds(1.4, 3.4) };
  }
  if (roll < 0.25) {
    const [a, b] = pair(BASKET, rnd);
    return { sport: "Baloncesto", participants: [a, b], market: "Ganador", pick: from([a, b]), odds: odds(1.3, 2.8) };
  }
  const [home, away] = pair(TEAMS, rnd);
  const market = rnd();
  if (market < 0.35) return { sport: "Fútbol", participants: [home, away], market: "Resultado", pick: from([home, "Empate", away]), odds: odds(1.5, 4.5) };
  if (market < 0.55) {
    return {
      sport: "Fútbol",
      participants: [home, away],
      market: "Número total de goles",
      pick: rnd() < 0.6 ? "Más de 2,5" : "Menos de 2,5",
      odds: odds(1.6, 2.4),
    };
  }
  if (market < 0.7) return { sport: "Fútbol", participants: [home, away], market: "Ambos equipos marcan", pick: rnd() < 0.6 ? "Sí" : "No", odds: odds(1.6, 2.2) };
  if (market < 0.82) return { sport: "Fútbol", participants: [home, away], market: "Número total córneres", pick: "Más de 8,5", odds: odds(1.7, 2.3) };
  if (market < 0.92) return { sport: "Fútbol", participants: [home, away], market: "Número total de tarjetas", pick: "Más de 3,5", odds: odds(1.8, 2.6) };
  return { sport: "Fútbol", participants: [home, away], market: "Doble oportunidad", pick: `${home} o empate`, odds: odds(1.2, 1.7) };
}

function pair(list: string[], rnd: () => number): [string, string] {
  const i = Math.floor(rnd() * list.length);
  let j = Math.floor(rnd() * (list.length - 1));
  if (j >= i) j += 1;
  return [list[i], list[j]];
}

function leg(p: Pick, eventDate: string, extra: Partial<BetLeg> = {}): BetLeg {
  return {
    eventDate,
    participants: p.participants,
    score: null,
    sport: p.sport,
    builder: false,
    market: p.market,
    pick: p.pick,
    odds: p.odds,
    originalOdds: null,
    selections: [],
    insuranceApplied: false,
    promoTitle: null,
    boosted: false,
    ...extra,
  };
}

const STATUS_LABEL: Record<BetStatus, string> = {
  won: "Ganada",
  lost: "Perdida",
  void: "Anulada",
  cashout: "Cash out",
  pending: "En curso",
  unknown: "",
};

/** Las apuestas de ejemplo, de la más reciente a la más antigua, terminando hoy (`now`). */
export function exampleBets(now = new Date(), size = EXAMPLE_SIZE): ParsedBet[] {
  const rnd = random(20261109);
  const start = new Date(now.getFullYear(), now.getMonth() - EXAMPLE_MONTHS + 1, 1).getTime();
  const span = now.getTime() - start;
  const out: ParsedBet[] = [];

  for (let i = 0; i < size; i++) {
    const placed = new Date(start + (span * (i + rnd())) / size);
    const placedAt = `${placed.getFullYear()}-${pad(placed.getMonth() + 1)}-${pad(placed.getDate())}T${pad(placed.getHours())}:${pad(placed.getMinutes())}`;
    const eventDate = `${pad(placed.getDate())}/${pad(placed.getMonth() + 1)}`;
    const bookmaker: Bookmaker = rnd() < 0.8 ? "winamax" : "bet365";
    const kind = rnd();

    let legs: BetLeg[];
    let promotions: string[] = [];
    let stake = STAKES[Math.floor(rnd() * STAKES.length)];
    let edge = 0.93; // sin promoción, algo por debajo de lo que pagan las cuotas
    if (kind < 0.13 && bookmaker === "winamax") {
      // Supercuota: siempre 10 €, cuota mejorada y buen acierto.
      const p = makePick(rnd);
      const odds = round2(2 + rnd() * 0.6);
      legs = [leg({ ...p, odds }, eventDate, { promoTitle: `${SUPERCUOTA}: ${p.participants.join(" - ")}`, boosted: true })];
      promotions = [SUPERCUOTA];
      stake = 10;
      edge = 1.55;
    } else if (kind < 0.2) {
      const p = makePick(rnd);
      const odds = round2(p.odds * 1.25);
      legs = [leg({ ...p, odds }, eventDate, { originalOdds: p.odds, boosted: true })];
      promotions = [BOOST];
      edge = 1.05;
    } else if (kind < 0.42) {
      const n = rnd() < 0.7 ? 2 : 3;
      legs = Array.from({ length: n }, () => leg(makePick(rnd), eventDate));
      edge = 0.85;
    } else {
      legs = [leg(makePick(rnd), eventDate)];
    }

    const odds = round2(legs.reduce((acc, l) => acc * (l.odds ?? 1), 1));
    const freebet = promotions.length === 0 && rnd() < 0.05;
    const r = rnd();
    let status: BetStatus;
    if (r < 0.025) status = "void";
    else if (r < 0.06) status = "cashout";
    else status = rnd() < Math.min(0.92, edge / odds) ? "won" : "lost";

    let returned: number;
    if (status === "void") returned = stake;
    else if (status === "cashout") returned = round2(stake * (0.4 + rnd() * 0.9));
    else if (status === "won") returned = round2(freebet ? stake * (odds - 1) : stake * odds);
    else returned = 0;

    const sports = [...new Set(legs.map((l) => l.sport))];
    const combo = legs.length > 1;
    out.push({
      id: `ejemplo-${i + 1}`,
      bookmaker,
      ref: null,
      placedAt,
      type: combo ? "combinada" : "simple",
      typeLabel: combo ? `Combinada (${legs.length})` : "Simple",
      legsCount: legs.length,
      sport: sports.length === 1 ? sports[0] : "Varios",
      status,
      statusLabel: STATUS_LABEL[status],
      stake,
      freebet,
      returned,
      refund: status === "void" ? stake : null,
      odds,
      legs,
      promotions,
      warnings: [],
    });
  }
  return out.reverse();
}
