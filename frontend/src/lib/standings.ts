import type { SplitStats } from "../api/types";

type StandingTotals = Pick<SplitStats, "points" | "goals_for" | "goals_against">;

/** Orden de clasificacion: puntos, diferencia de goles y goles a favor. */
export function compareStandings(a: StandingTotals, b: StandingTotals): number {
  return (
    b.points - a.points ||
    b.goals_for - b.goals_against - (a.goals_for - a.goals_against) ||
    b.goals_for - a.goals_for
  );
}
