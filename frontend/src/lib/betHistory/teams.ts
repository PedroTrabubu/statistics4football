/** Acierto por equipo (fútbol) y por tenista: las apuestas de un solo partido, repartidas entre sus participantes. */

import { sportOf, stats, type GroupStats, type SettledBet } from "./analysis";

export type TeamSport = "Fútbol" | "Tenis";

export interface TeamGroup extends GroupStats {
  /** Nombre tal como lo escribe la casa (el más repetido si hay varios). */
  name: string;
  sport: TeamSport;
}

/** Palabras que no distinguen a un equipo: "FC Barcelona" = "Barcelona", "Atlético de Madrid" = "Atlético Madrid". */
const FILLER = new Set(["fc", "cf", "cd", "ud", "sd", "rcd", "sc", "afc", "club", "de", "del"]);

/** Mismos equipos con otro nombre en otra casa. */
const SAME_TEAM: Record<string, string> = {
  psg: "paris saint germain",
};

/** Clave para juntar el mismo equipo o tenista escrito de formas distintas. */
export function teamKey(name: string): string {
  const key = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter((w) => w && !FILLER.has(w))
    .join(" ");
  return SAME_TEAM[key] ?? key;
}

/**
 * Equipos o tenistas de una apuesta. Solo cuentan las apuestas de un solo
 * partido (simples y «crea tu apuesta»): en una combinada de varios partidos no
 * se sabe cuál la hizo fallar. Sin participantes (las sencillas de bet365 solo
 * traen la selección), la selección cuenta como equipo si `isKnownTeam` la
 * reconoce ("Real Madrid", y no "Empate" o un jugador).
 */
function subjects(r: SettledBet, isKnownTeam: (name: string) => boolean): string[] {
  if (r.bet.legs.length !== 1) return [];
  const leg = r.bet.legs[0];
  if (leg.participants.length >= 2) return leg.participants.slice(0, 2);
  if (leg.participants.length === 0 && leg.pick && isKnownTeam(leg.pick)) return [leg.pick];
  return [];
}

function mostCommon<T>(items: T[]): T | null {
  const counts = new Map<T, number>();
  for (const x of items) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: T | null = null;
  let max = 0;
  for (const [x, n] of counts) {
    if (n > max) [best, max] = [x, n];
  }
  return best;
}

/**
 * Por equipo y por tenista, las apuestas resueltas de sus partidos (al menos
 * `minBets`), de más a menos acierto. El deporte de cada uno es el de la
 * mayoría de sus apuestas: así cuentan también las que se guardaron como
 * «Desconocido» ("España", "Real Madrid" en una supercuota...).
 */
export function teamGroups(
  settled: SettledBet[],
  isKnownTeam: (name: string) => boolean = () => false,
  minBets = 3,
): TeamGroup[] {
  const groups = new Map<string, { names: string[]; sports: string[]; rows: SettledBet[] }>();
  for (const r of settled) {
    const sport = sportOf(r.bet);
    for (const name of new Set(subjects(r, isKnownTeam))) {
      const key = teamKey(name);
      if (!key) continue;
      const g = groups.get(key) ?? { names: [], sports: [], rows: [] };
      g.names.push(name);
      if (sport !== "Desconocido" && sport !== "Varios") g.sports.push(sport);
      g.rows.push(r);
      groups.set(key, g);
    }
  }
  const out: TeamGroup[] = [];
  for (const g of groups.values()) {
    const sport = mostCommon(g.sports);
    if ((sport !== "Fútbol" && sport !== "Tenis") || g.rows.length < minBets) continue;
    const name = mostCommon(g.names) as string;
    out.push({ ...stats(name, g.rows), name, sport });
  }
  return out.sort(
    (a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1) || b.decided - a.decided || b.profit - a.profit,
  );
}
