/** Las apuestas importadas se guardan solo en este navegador (localStorage). */

import type { ParsedBet } from "./types";

const KEY = "s4b:mis-apuestas:v1";

export function loadBets(): ParsedBet[] {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? (JSON.parse(raw) as { bets?: ParsedBet[] }) : null;
    return Array.isArray(data?.bets) ? data.bets : [];
  } catch {
    return [];
  }
}

export function saveBets(bets: ParsedBet[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify({ bets }));
    return true;
  } catch {
    return false;
  }
}

export function clearBets(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(REAL_MONEY_KEY);
  } catch {
    // Sin almacenamiento disponible: no hay nada que borrar.
  }
}

// --- Dinero real (lo que el usuario apunta a mano) ------------------------------

const REAL_MONEY_KEY = "s4b:mis-apuestas:dinero-real:v1";

/** Movimientos reales de la cuenta, apuntados a mano: no salen del historial de apuestas. */
export interface RealMoney {
  deposited: number | null;
  withdrawn: number | null;
  balance: number | null;
  updatedAt: string | null;
}

export const EMPTY_REAL_MONEY: RealMoney = { deposited: null, withdrawn: null, balance: null, updatedAt: null };

export function hasRealMoney(m: RealMoney | null | undefined): boolean {
  return !!m && (m.deposited !== null || m.withdrawn !== null || m.balance !== null);
}

/** Resultado real = retirado + saldo - ingresado (solo si están los tres datos). */
export function realResult(m: RealMoney): number | null {
  if (m.deposited === null || m.withdrawn === null || m.balance === null) return null;
  return Math.round((m.withdrawn + m.balance - m.deposited) * 100) / 100;
}

function cleanRealMoney(raw: unknown): RealMoney {
  const r = (raw ?? {}) as Partial<Record<keyof RealMoney, unknown>>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    deposited: num(r.deposited),
    withdrawn: num(r.withdrawn),
    balance: num(r.balance),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
  };
}

export function loadRealMoney(): RealMoney {
  try {
    const raw = localStorage.getItem(REAL_MONEY_KEY);
    return raw ? cleanRealMoney(JSON.parse(raw)) : EMPTY_REAL_MONEY;
  } catch {
    return EMPTY_REAL_MONEY;
  }
}

export function saveRealMoney(m: RealMoney): boolean {
  try {
    localStorage.setItem(REAL_MONEY_KEY, JSON.stringify(m));
    return true;
  } catch {
    return false;
  }
}

export interface BetUpdate {
  before: ParsedBet;
  after: ParsedBet;
}

export interface MergeResult {
  bets: ParsedBet[];
  /** Apuestas que no estaban guardadas. */
  added: ParsedBet[];
  /** Ya estaban, pero algo ha cambiado (p. ej. "En curso" -> "Ganada", o se leyó mejor). */
  updated: BetUpdate[];
  /** Ya estaban exactamente igual. */
  unchanged: ParsedBet[];
}

/** Une lo importado con lo guardado sin duplicar: la misma apuesta (mismo id) se sustituye por la versión nueva. */
export function mergeBets(current: ParsedBet[], incoming: ParsedBet[]): MergeResult {
  const byId = new Map(current.map((b) => [b.id, b]));
  const added: ParsedBet[] = [];
  const updated: BetUpdate[] = [];
  const unchanged: ParsedBet[] = [];
  const seen = new Set<string>();
  for (const b of incoming) {
    if (seen.has(b.id)) continue; // la misma apuesta pegada dos veces en el mismo HTML
    seen.add(b.id);
    const before = byId.get(b.id);
    if (!before) added.push(b);
    else if (JSON.stringify(before) === JSON.stringify(b)) unchanged.push(b);
    else updated.push({ before, after: b });
    byId.set(b.id, b);
  }
  const bets = [...byId.values()].sort((a, b) => (b.placedAt ?? "").localeCompare(a.placedAt ?? ""));
  return { bets, added, updated, unchanged };
}

const STATUS_TEXT: Record<ParsedBet["status"], string> = {
  won: "Ganada",
  lost: "Perdida",
  void: "Anulada",
  cashout: "Cash out",
  pending: "En curso",
  unknown: "Sin estado",
};

/** Qué ha cambiado en una apuesta actualizada, en una frase corta. */
export function describeUpdate({ before, after }: BetUpdate): string {
  if (before.status !== after.status) return `${STATUS_TEXT[before.status]} → ${STATUS_TEXT[after.status]}`;
  if (before.warnings.length > after.warnings.length) return "Ahora se lee completa";
  if (before.stake !== after.stake || before.returned !== after.returned) return "Importe o ganancias corregidos";
  if (before.odds !== after.odds) return "Cuota corregida";
  return "Datos corregidos";
}

// --- Copia de seguridad -------------------------------------------------------

const BACKUP_KIND = "statistics4bets/mis-apuestas";

/** Contenido del archivo .json de copia de seguridad. */
export function exportBackup(bets: ParsedBet[], realMoney: RealMoney | null = null, now: Date = new Date()): string {
  return JSON.stringify(
    { kind: BACKUP_KIND, version: 2, exportedAt: now.toISOString(), bets, realMoney: hasRealMoney(realMoney) ? realMoney : null },
    null,
    1,
  );
}

export interface Backup {
  bets: ParsedBet[];
  /** null si la copia no trae dinero real (o es de la versión 1). */
  realMoney: RealMoney | null;
}

export function backupFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `mis-apuestas-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/** Lee un archivo de copia. Lanza un Error con un mensaje para el usuario si no es válido. */
export function parseBackup(raw: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("El archivo no es una copia válida: no es JSON.");
  }
  const bets = Array.isArray(data) ? data : (data as { kind?: string; bets?: unknown })?.bets;
  if (!Array.isArray(data) && (data as { kind?: string })?.kind !== BACKUP_KIND) {
    throw new Error("El archivo no es una copia de «Mis apuestas».");
  }
  if (!Array.isArray(bets)) throw new Error("La copia no contiene apuestas.");
  const valid = bets.filter(
    (b): b is ParsedBet =>
      typeof b === "object" && b !== null && typeof (b as ParsedBet).id === "string" && typeof (b as ParsedBet).status === "string",
  );
  if (valid.length === 0) throw new Error("La copia no contiene apuestas.");
  const realMoneyRaw = Array.isArray(data) ? null : (data as { realMoney?: unknown }).realMoney;
  const realMoney = realMoneyRaw ? cleanRealMoney(realMoneyRaw) : null;
  return {
    // Copias de versiones anteriores: campos que se añadieron después.
    bets: valid.map((b) => ({ ...b, promotions: b.promotions ?? [], warnings: b.warnings ?? [], legs: b.legs ?? [] })),
    realMoney: hasRealMoney(realMoney) ? realMoney : null,
  };
}
