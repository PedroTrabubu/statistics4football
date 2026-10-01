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

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** 21/09/26: para listas densas de partidos. */
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/** "2526" -> "25/26" (formato de temporada de soccerdata). */
export function formatSeason(season: string): string {
  return `${season.slice(0, 2)}/${season.slice(2)}`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
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
