/** Apuestas agrupadas por partido, con posibles duplicadas. */

import type { SettledBet } from "./analysis";
import type { ParsedBet } from "./types";

/** "Sevilla FC" y "sevilla fc" son el mismo; se quitan tildes, signos y siglas de club. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter((w) => w && !["fc", "cf", "cd", "ud", "sd", "rcd", "sc"].includes(w))
    .join(" ");
}

/** Partidos de una apuesta: los dos participantes y el año (las supercuotas no traen fecha del partido). */
export function matchKeys(bet: ParsedBet): { key: string; label: string; eventDate: string | null }[] {
  const year = bet.placedAt?.slice(0, 4) ?? "";
  const seen = new Map<string, { key: string; label: string; eventDate: string | null }>();
  for (const leg of bet.legs) {
    if (leg.participants.length < 2) continue;
    const [a, b] = leg.participants;
    const key = `${year}|${normalizeName(a)}|${normalizeName(b)}`;
    const prev = seen.get(key);
    seen.set(key, { key, label: `${a} – ${b}`, eventDate: prev?.eventDate ?? leg.eventDate });
  }
  return [...seen.values()];
}

export interface MatchGroup {
  key: string;
  label: string;
  eventDate: string | null;
  bets: SettledBet[];
  /** Importe total puesto en ese partido (incluye freebets). */
  exposed: number;
  freebetExposed: number;
  profit: number;
  /** Apuestas que también incluyen otros partidos (combinadas). */
  multiMatch: number;
  /** ids de las apuestas casi idénticas hechas con pocos minutos de diferencia. */
  possibleDuplicates: Set<string>;
}

function signature(bet: ParsedBet): string {
  return bet.legs.map((l) => `${l.market}|${l.pick}`).join("·");
}

const DUPLICATE_MINUTES = 10;

function findDuplicates(rows: SettledBet[]): Set<string> {
  const out = new Set<string>();
  const sorted = [...rows].filter((r) => r.placedAt).sort((a, b) => (a.placedAt as Date).getTime() - (b.placedAt as Date).getTime());
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const minutes = ((b.placedAt as Date).getTime() - (a.placedAt as Date).getTime()) / 60_000;
      if (minutes > DUPLICATE_MINUTES) break;
      const sameOdds = a.bet.odds !== null && b.bet.odds !== null && Math.abs(a.bet.odds - b.bet.odds) <= 0.01;
      if (a.bet.stake === b.bet.stake && a.bet.freebet === b.bet.freebet && sameOdds && signature(a.bet) === signature(b.bet)) {
        out.add(a.bet.id);
        out.add(b.bet.id);
      }
    }
  }
  return out;
}

/** Partidos con al menos `minBets` apuestas resueltas, de más a menos importe expuesto. */
export function matchGroups(settled: SettledBet[], minBets = 3): MatchGroup[] {
  const groups = new Map<string, { label: string; eventDate: string | null; rows: SettledBet[]; multi: number }>();
  for (const r of settled) {
    const keys = matchKeys(r.bet);
    for (const k of keys) {
      const g = groups.get(k.key) ?? { label: k.label, eventDate: k.eventDate, rows: [], multi: 0 };
      g.rows.push(r);
      g.eventDate = g.eventDate ?? k.eventDate;
      if (keys.length > 1) g.multi += 1;
      groups.set(k.key, g);
    }
  }
  return [...groups]
    .filter(([, g]) => g.rows.length >= minBets)
    .map(([key, g]) => ({
      key,
      label: g.label,
      eventDate: g.eventDate,
      bets: g.rows,
      exposed: Math.round(g.rows.reduce((s, r) => s + (r.bet.stake ?? 0), 0) * 100) / 100,
      freebetExposed: Math.round(g.rows.reduce((s, r) => s + r.freebetStake, 0) * 100) / 100,
      profit: Math.round(g.rows.reduce((s, r) => s + r.profit, 0) * 100) / 100,
      multiMatch: g.multi,
      possibleDuplicates: findDuplicates(g.rows),
    }))
    .sort((a, b) => b.exposed - a.exposed);
}
