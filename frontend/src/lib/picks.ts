import type { PickKind, PickLeg } from "../api/types";

export const PICK_KIND_LABELS: Record<PickKind, string> = {
  segura: "Segura",
  fiable: "Fiable",
  media: "Media",
  alta: "Alta",
  bomba: "Bomba",
  mismo_partido: "Mismo partido",
};

export const TIER_KINDS: PickKind[] = ["segura", "fiable", "media", "alta", "bomba"];

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** "Al menos N" para líneas x.5 de "más de". */
function atLeast(line: number): number {
  return Math.floor(line) + 1;
}

/** Texto de una selección, p. ej. "Más de 8.5 córners" o "Getafe ve al menos 2 amarillas". */
export function pickLegLabel(leg: PickLeg): string {
  const team = leg.selection === "home" ? leg.home_team : leg.away_team;
  const line = leg.line ?? 0;
  const overUnder = (unit: string) => `${leg.selection === "over" ? "Más" : "Menos"} de ${line} ${unit}`;

  switch (leg.market) {
    case "1x2":
      return leg.selection === "draw" ? "Empate" : `Gana ${team}`;
    case "double_chance":
      if (leg.selection === "1X") return `${leg.home_team} o empate`;
      if (leg.selection === "X2") return `Empate o ${leg.away_team}`;
      return `${leg.home_team} o ${leg.away_team} (sin empate)`;
    case "goals_over_under":
      return overUnder("goles");
    case "btts":
      return leg.selection === "yes" ? "Marcan los dos equipos" : "No marcan los dos";
    case "team_goals_over":
      return line < 1 ? `${team} marca` : `${team} marca al menos ${atLeast(line)} goles`;
    case "corners_over_under":
      return overUnder("córners");
    case "team_corners_over":
      return `${team} saca al menos ${atLeast(line)} córners`;
    case "yellow_over_under":
      return overUnder("amarillas");
    case "team_yellow_over": {
      const n = atLeast(line);
      return `${team} ve al menos ${n} ${plural(n, "amarilla", "amarillas")}`;
    }
    default:
      return `${leg.market} ${leg.selection} ${leg.line ?? ""}`;
  }
}

/** Qué mide el dato real de la selección ("2-1 goles", "6-3 córners"...). */
export function pickLegUnit(leg: PickLeg): string {
  if (leg.market.includes("corners")) return "córners";
  if (leg.market.includes("yellow")) return "amarillas";
  return "";
}

export const ODDS_KIND_TITLES: Record<string, string> = {
  real: "Cuota media real de las casas, antes del partido",
  derivada: "Calculada a partir de las cuotas reales del 1X2",
  estimada: "Estimada: probabilidad del modelo con un margen típico de casa. Compárala con la de tu casa de apuestas",
};

/** "1 de cada N" redondeado, para explicar una probabilidad. */
export function oneInN(prob: number): string {
  if (prob >= 0.5) return `${Math.round(prob * 10)} de cada 10`;
  return `1 de cada ${Math.max(2, Math.round(1 / prob))}`;
}
