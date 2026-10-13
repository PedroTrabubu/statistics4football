/** Las apuestas importadas se guardan solo en este navegador (localStorage). */

import type { Bookmaker, ParsedBet } from "./types";

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
    localStorage.removeItem(LEGACY_REAL_MONEY_KEY);
  } catch {
    // Sin almacenamiento disponible: no hay nada que borrar.
  }
}

// --- Dinero real (lo que el usuario apunta a mano) ------------------------------

const REAL_MONEY_KEY = "s4b:mis-apuestas:dinero-real:v3";
/** La versión 1 guardaba un solo bloque, de toda la cuenta de Winamax y sin año. */
const LEGACY_REAL_MONEY_KEY = "s4b:mis-apuestas:dinero-real:v1";

/**
 * Movimientos reales de la cuenta en un año natural, apuntados a mano a partir
 * del extracto de la casa: no salen del historial de apuestas.
 */
export interface RealMoney {
  /** Saldo al 1 de enero. */
  opening: number | null;
  deposited: number | null;
  withdrawn: number | null;
  /** Saldo al 31 de diciembre o, si el año no ha acabado, el actual. */
  closing: number | null;
  updatedAt: string | null;
}

export const EMPTY_REAL_MONEY: RealMoney = { opening: null, deposited: null, withdrawn: null, closing: null, updatedAt: null };

/**
 * Clave de los datos de toda la cuenta, sin año: los que se apuntaban antes de
 * separar por años. Se comparan con todas las apuestas importadas de la casa.
 */
export const WHOLE_ACCOUNT = "cuenta";

/** Dinero real de cada casa por año ("2026") o de toda la cuenta (WHOLE_ACCOUNT). */
export type RealMoneyByBook = Partial<Record<Bookmaker, Record<string, RealMoney>>>;

export function hasRealMoney(m: RealMoney | null | undefined): boolean {
  return !!m && (m.opening !== null || m.deposited !== null || m.withdrawn !== null || m.closing !== null);
}

/** Resultado real = saldo final - saldo inicial - ingresado + retirado (solo con los cuatro datos). */
export function realResult(m: RealMoney): number | null {
  if (m.opening === null || m.deposited === null || m.withdrawn === null || m.closing === null) return null;
  return Math.round((m.closing - m.opening - m.deposited + m.withdrawn) * 100) / 100;
}

function cleanRealMoney(raw: unknown): RealMoney {
  const r = (raw ?? {}) as Partial<Record<keyof RealMoney | "balance", unknown>>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  // Bloque de toda la cuenta de antes: sin saldo inicial (la cuenta empezó en 0) y "balance" como saldo final.
  const legacy = !("closing" in r) && "balance" in r;
  return {
    opening: legacy ? 0 : num(r.opening),
    deposited: num(r.deposited),
    withdrawn: num(r.withdrawn),
    closing: legacy ? num(r.balance) : num(r.closing),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
  };
}

function isLegacyBlock(r: Record<string, unknown>): boolean {
  return "balance" in r && !("closing" in r);
}

/**
 * Solo las casas y años con algún dato. Los formatos anteriores (un bloque de
 * toda la cuenta, suelto o por casa) pasan a WHOLE_ACCOUNT; un bloque suelto es de Winamax.
 */
function cleanRealMoneyByBook(raw: unknown): RealMoneyByBook {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  if (isLegacyBlock(r)) {
    const single = cleanRealMoney(r);
    return hasRealMoney(single) ? { winamax: { [WHOLE_ACCOUNT]: single } } : {};
  }
  const out: RealMoneyByBook = {};
  for (const book of ["winamax", "bet365"] as const) {
    const entries = r[book];
    if (!entries || typeof entries !== "object") continue;
    const e = entries as Record<string, unknown>;
    const periods: [string, unknown][] = isLegacyBlock(e) ? [[WHOLE_ACCOUNT, e]] : Object.entries(e);
    const kept = periods
      .filter(([key]) => key === WHOLE_ACCOUNT || /^\d{4}$/.test(key))
      .map(([key, value]) => [key, cleanRealMoney(value)] as const)
      .filter(([, m]) => hasRealMoney(m));
    if (kept.length) out[book] = Object.fromEntries(kept);
  }
  return out;
}

export function loadRealMoney(): RealMoneyByBook {
  try {
    const raw = localStorage.getItem(REAL_MONEY_KEY) ?? localStorage.getItem(LEGACY_REAL_MONEY_KEY);
    return raw ? cleanRealMoneyByBook(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function saveRealMoney(m: RealMoneyByBook): boolean {
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
export function exportBackup(bets: ParsedBet[], realMoney: RealMoneyByBook | null = null, now: Date = new Date()): string {
  const money = cleanRealMoneyByBook(realMoney);
  return JSON.stringify(
    { kind: BACKUP_KIND, version: 4, exportedAt: now.toISOString(), bets, realMoney: Object.keys(money).length ? money : null },
    null,
    1,
  );
}

export interface Backup {
  bets: ParsedBet[];
  /** Por casa y año; null si la copia no trae dinero real (o es de la versión 1). */
  realMoney: RealMoneyByBook | null;
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
  const realMoney = cleanRealMoneyByBook(realMoneyRaw);
  return {
    // Copias de versiones anteriores: campos que se añadieron después.
    bets: valid.map((b) => ({
      ...b,
      bookmaker: b.bookmaker ?? "winamax",
      promotions: b.promotions ?? [],
      warnings: b.warnings ?? [],
      legs: b.legs ?? [],
    })),
    realMoney: Object.keys(realMoney).length ? realMoney : null,
  };
}
