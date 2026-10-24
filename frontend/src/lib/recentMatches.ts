/** Los partidos de la ficha uno a uno: los últimos de cada equipo y los
 * enfrentamientos directos, con el resumen de estos. */

import type { MatchResult } from "../api/types";
import { translatedRecord } from "../i18n";
import { average, cards, viewFrom, type TeamMatchView } from "./markets";

/** Partidos que se listan de cada equipo (todos o solo en su campo). */
export const RECENT_SHOWN = 10;

export type Venue = "home" | "away";
/** Victoria, empate o derrota del equipo desde el que se mira. */
export type Outcome = "W" | "D" | "L";

export const OUTCOME_LETTER: Record<Outcome, string> = translatedRecord({
  W: "matches:outcome.letter.win",
  D: "matches:outcome.letter.draw",
  L: "matches:outcome.letter.loss",
});
export const OUTCOME_LABEL: Record<Outcome, string> = translatedRecord({
  W: "matches:outcome.label.win",
  D: "matches:outcome.label.draw",
  L: "matches:outcome.label.loss",
});

export function outcomeOf(v: Pick<TeamMatchView, "goalsFor" | "goalsAgainst">): Outcome {
  if (v.goalsFor > v.goalsAgainst) return "W";
  return v.goalsFor === v.goalsAgainst ? "D" : "L";
}

/** Los partidos de un equipo vistos desde él, en el orden dado (la API: los
 * más recientes primero); con `venue`, solo los de ese campo. */
export function teamRecent(matches: MatchResult[], teamId: number, venue: Venue | null = null): TeamMatchView[] {
  return matches
    .filter((m) => m.home_team_id === teamId || m.away_team_id === teamId)
    .map((m) => viewFrom(m, m.home_team_id === teamId ? "home" : "away"))
    .filter((v): v is TeamMatchView => v !== null && (venue === null || v.venue === venue));
}

const add = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null ? null : a + b;

export const cornersTotal = (v: TeamMatchView) => add(v.statsFor?.corners, v.statsAgainst?.corners);
export const cardsTotal = (v: TeamMatchView) => add(cards(v.statsFor), cards(v.statsAgainst));

export interface HeadToHeadSummary {
  matches: number;
  /** Desde el equipo de las `views` (el local de la ficha). */
  wins: number;
  draws: number;
  losses: number;
  goalsPerMatch: number | null;
  /** Fracciones (0-1); null sin partidos. */
  over25: number | null;
  btts: number | null;
  /** Medias de los partidos con datos; null si ninguno los tiene. */
  cornersPerMatch: number | null;
  cardsPerMatch: number | null;
}

export function headToHeadSummary(views: TeamMatchView[]): HeadToHeadSummary {
  const n = views.length;
  const count = (test: (v: TeamMatchView) => boolean) => views.filter(test).length;
  const share = (test: (v: TeamMatchView) => boolean) => (n > 0 ? count(test) / n : null);
  return {
    matches: n,
    wins: count((v) => outcomeOf(v) === "W"),
    draws: count((v) => outcomeOf(v) === "D"),
    losses: count((v) => outcomeOf(v) === "L"),
    goalsPerMatch: average(views, (v) => v.goalsFor + v.goalsAgainst),
    over25: share((v) => v.goalsFor + v.goalsAgainst > 2.5),
    btts: share((v) => v.goalsFor > 0 && v.goalsAgainst > 0),
    cornersPerMatch: average(views, cornersTotal),
    cardsPerMatch: average(views, cardsTotal),
  };
}
