/** Apuestas importadas del historial de una casa (de momento, Winamax). */

export type BetStatus = "won" | "lost" | "void" | "cashout" | "pending" | "unknown";
export type SelectionResult = "won" | "lost" | "void" | null;

/** Selección dentro de un "Crea tu apuesta" (MyMatch), con su resultado si la casa lo muestra. */
export interface BuilderSelection {
  market: string;
  pick: string;
  result: SelectionResult;
}

/** Un evento dentro del boleto: una selección normal o un "Crea tu apuesta" del mismo partido. */
export interface BetLeg {
  eventDate: string | null; // "05/10", tal como lo muestra la casa
  participants: string[];
  score: string | null;
  sport: string;
  builder: boolean;
  market: string;
  pick: string;
  odds: number | null;
  /** Cuota tachada (p. ej. la original de una selección anulada). */
  originalOdds: number | null;
  selections: BuilderSelection[];
  /** Seguro aplicado (p. ej. "garantía abandono" de Winamax). */
  insuranceApplied: boolean;
  /** Título de la promoción si la selección viene de una ("La Gran Supercuota: Real Madrid - Rayo Vallecano"). */
  promoTitle: string | null;
  /** Cuota mejorada (supercuota): Winamax la pinta en dorado. */
  boosted: boolean;
}

export interface ParsedBet {
  id: string;
  bookmaker: "winamax";
  ref: string | null;
  /** Fecha y hora en que se hizo la apuesta, hora local: "2026-10-06T14:09". */
  placedAt: string | null;
  type: "simple" | "combinada" | "otro";
  typeLabel: string;
  legsCount: number;
  sport: string;
  status: BetStatus;
  statusLabel: string;
  stake: number | null;
  /** Apostada con freebets: el importe no es dinero propio. */
  freebet: boolean;
  /**
   * Lo que figura como "Ganancias". Con dinero propio es el retorno total
   * (incluye el importe); con freebets, solo el beneficio.
   */
  returned: number | null;
  refund: number | null;
  odds: number | null;
  legs: BetLeg[];
  /** Promociones de la apuesta: "La Gran Supercuota", "Supercuota", "Bang to the Moon", "Misión Fútbol"... */
  promotions: string[];
  warnings: string[];
}

export interface ImportResult {
  bets: ParsedBet[];
  /** Bloques que parecían apuestas pero no se pudieron leer. */
  failed: number;
}
