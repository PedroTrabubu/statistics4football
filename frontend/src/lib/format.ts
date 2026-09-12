export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatEv(value: number): string {
  const pct = value * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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
  if (market === "over_under_2.5") {
    if (selection === "over") return "Más de 2.5 goles";
    if (selection === "under") return "Menos de 2.5 goles";
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
