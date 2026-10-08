export function formatPercent(value: number | null, digits = 1): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatEv(value: number | null): string {
  if (value === null) return "—";
  const pct = value * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/** Para valores que ya vienen en escala 0-100 (stats de temporada), a
 * diferencia de formatPercent que espera una fraccion 0-1 (probabilidades). */
export function formatPct(value: number | null, digits = 0): string {
  if (value === null) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatNumber(value: number | null, digits = 2): string {
  if (value === null) return "—";
  return value.toFixed(digits);
}

/** value ya viene en unidades de porcentaje (p.ej. -4.4 = -4.4%), a
 * diferencia de formatEv que espera una fraccion 0-1. */
export function formatRoiPct(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function formatPnl(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}u`;
}

export function formatOdds(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

/** Las fechas de la API son UTC sin zona ("2026-10-09T19:00:00"): se marcan
 * como UTC para que el navegador las muestre en su hora local. Una fecha sin
 * hora ("2026-10-09") ya se interpreta como UTC. */
export function parseApiDate(iso: string): Date {
  const hasTime = iso.includes("T");
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(iso);
  return new Date(hasTime && !hasZone ? `${iso}Z` : iso);
}

/** football-data.org pone 00:00 UTC a los partidos sin hora fijada todavía. */
function isTimeUnknown(date: Date): boolean {
  return date.getUTCHours() === 0 && date.getUTCMinutes() === 0;
}

export function formatDate(iso: string): string {
  return parseApiDate(iso).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** 21/09/26: para listas densas de partidos. */
export function formatShortDate(iso: string): string {
  return parseApiDate(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/** "2526" -> "25/26" (formato de temporada de soccerdata). */
export function formatSeason(season: string): string {
  return `${season.slice(0, 2)}/${season.slice(2)}`;
}

/** "Jornada 8"; null si no se conoce. */
export function formatMatchday(matchday: number | null | undefined): string | null {
  return matchday == null ? null : `Jornada ${matchday}`;
}

/** Las partes que haya, unidas con " · " (liga · jornada · fecha). */
export function joinParts(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" · ");
}

/** "9–12 oct" o "28 sept – 1 oct": fechas de una jornada. */
export function formatDateRange(startIso: string, endIso: string): string {
  const start = parseApiDate(startIso);
  const end = parseApiDate(endIso);
  const day = (d: Date) => d.toLocaleDateString("es-ES", { day: "numeric" });
  const dayMonth = (d: Date) => d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  if (start.toDateString() === end.toDateString()) return dayMonth(start);
  if (start.getMonth() === end.getMonth()) return `${day(start)}–${dayMonth(end)}`;
  return `${dayMonth(start)} – ${dayMonth(end)}`;
}

export function formatDateTime(iso: string): string {
  const date = parseApiDate(iso);
  if (isTimeUnknown(date)) {
    return `${date.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })} · hora por confirmar`;
  }
  return date.toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const MARKET_LABELS: Record<string, string> = {
  "1x2": "1X2",
  "over_under_2.5": "Over/Under 2.5",
  asian_handicap: "Hándicap asiático",
  btts: "Ambos anotan",
  double_chance: "Doble oportunidad",
  "over_under_1.5": "Over/Under 1.5",
  "over_under_3.5": "Over/Under 3.5",
  team_scores: "Marca equipo",
};

export function marketLabel(market: string): string {
  return MARKET_LABELS[market] ?? market;
}

export function selectionLabel(market: string, selection: string, homeTeam: string, awayTeam: string): string {
  if (market === "1x2") {
    if (selection === "home") return homeTeam;
    if (selection === "away") return awayTeam;
    if (selection === "draw") return "Empate";
  }
  if (market.startsWith("over_under_")) {
    const line = market.slice("over_under_".length);
    if (selection === "over") return `Más de ${line} goles`;
    if (selection === "under") return `Menos de ${line} goles`;
  }
  if (market === "double_chance") {
    if (selection === "1X") return `${homeTeam} o empate`;
    if (selection === "X2") return `Empate o ${awayTeam}`;
    if (selection === "12") return `${homeTeam} o ${awayTeam}`;
  }
  if (market === "team_scores") {
    if (selection === "home") return `Marca ${homeTeam}`;
    if (selection === "away") return `Marca ${awayTeam}`;
  }
  if (market === "asian_handicap") {
    if (selection === "home") return `${homeTeam} (hándicap)`;
    if (selection === "away") return `${awayTeam} (hándicap)`;
  }
  if (market === "btts") {
    if (selection === "yes") return "Sí";
    if (selection === "no") return "No";
  }
  return selection;
}
