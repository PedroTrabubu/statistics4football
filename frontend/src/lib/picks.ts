import type { PickKind, PickLeg } from "../api/types";
import { t, translatedRecord } from "../i18n";
import { formatLine } from "./format";

export const PICK_KIND_LABELS: Record<PickKind, string> = translatedRecord({
  segura: "picks:kind.safe",
  fiable: "picks:kind.reliable",
  media: "picks:kind.medium",
  alta: "picks:kind.high",
  bomba: "picks:kind.bomb",
  mismo_partido: "picks:kind.sameMatch",
});

export const TIER_KINDS: PickKind[] = ["segura", "fiable", "media", "alta", "bomba"];

/** "Al menos N" para líneas x.5 de "más de". */
function atLeast(line: number): number {
  return Math.floor(line) + 1;
}

/** Texto de una selección, p. ej. "Más de 8.5 córners" o "Getafe ve al menos 2 amarillas". */
export function pickLegLabel(leg: PickLeg): string {
  const team = leg.selection === "home" ? leg.home_team : leg.away_team;
  const line = leg.line ?? 0;
  const teams = { team, home: leg.home_team, away: leg.away_team };
  const overUnder = (unit: string) =>
    t(`picks:leg.${unit}.${leg.selection === "over" ? "over" : "under"}`, { line: formatLine(line) });

  switch (leg.market) {
    case "1x2":
      return leg.selection === "draw" ? t("picks:leg.draw") : t("picks:leg.win", teams);
    case "double_chance":
      if (leg.selection === "1X") return t("picks:leg.homeOrDraw", teams);
      if (leg.selection === "X2") return t("picks:leg.drawOrAway", teams);
      return t("picks:leg.homeOrAway", teams);
    case "goals_over_under":
      return overUnder("goals");
    case "btts":
      return leg.selection === "yes" ? t("picks:leg.bttsYes") : t("picks:leg.bttsNo");
    case "team_goals_over":
      return line < 1 ? t("picks:leg.teamScores", teams) : t("picks:leg.teamGoalsAtLeast", { ...teams, count: atLeast(line) });
    case "corners_over_under":
      return overUnder("corners");
    case "team_corners_over":
      return t("picks:leg.teamCornersAtLeast", { ...teams, count: atLeast(line) });
    case "yellow_over_under":
      return overUnder("yellowCards");
    case "team_yellow_over":
      return t("picks:leg.teamYellowsAtLeast", { ...teams, count: atLeast(line) });
    default:
      return `${leg.market} ${leg.selection} ${leg.line ?? ""}`;
  }
}

/** Qué mide el dato real de la selección ("2-1 goles", "6-3 córners"...). */
export function pickLegUnit(leg: PickLeg): string {
  if (leg.market.includes("corners")) return t("picks:leg.unit.corners");
  if (leg.market.includes("yellow")) return t("picks:leg.unit.yellowCards");
  return "";
}

export const ODDS_KIND_TITLES: Record<string, string> = translatedRecord({
  real: "picks:oddsKind.real",
  derivada: "picks:oddsKind.derived",
  estimada: "picks:oddsKind.estimated",
});

/** "1 de cada N" redondeado, para explicar una probabilidad. */
export function oneInN(prob: number): string {
  if (prob >= 0.5) return t("picks:oneInN.outOfTen", { n: Math.round(prob * 10) });
  return t("picks:oneInN.oneIn", { n: Math.max(2, Math.round(1 / prob)) });
}
