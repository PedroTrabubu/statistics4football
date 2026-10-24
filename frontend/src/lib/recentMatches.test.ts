import { describe, expect, it } from "vitest";
import type { MatchResult } from "../api/types";
import { headToHeadSummary, outcomeOf, teamRecent } from "./recentMatches";

let nextId = 1;
function mk(home: number, away: number, hg: number, ag: number, corners: [number, number] | null = [5, 4]): MatchResult {
  const stats = (c: number) => ({ corners: c, yellow_cards: 2, red_cards: 0, fouls: 11, shots: 10, shots_on_target: 4 });
  return {
    id: nextId++,
    date: "2026-09-01T18:00:00",
    status: "historical",
    league_id: 2,
    league_code: "ESP-La Liga",
    season: "2627",
    home_team_id: home,
    away_team_id: away,
    home_team: `Equipo ${home}`,
    away_team: `Equipo ${away}`,
    home_goals: hg,
    away_goals: ag,
    home_ht_goals: null,
    away_ht_goals: null,
    referee: null,
    matchday: 1,
    matchday_estimated: false,
    home_stats: corners ? stats(corners[0]) : null,
    away_stats: corners ? stats(corners[1]) : null,
  };
}

describe("teamRecent", () => {
  const matches = [mk(1, 2, 2, 0), mk(3, 1, 1, 1), mk(4, 5, 0, 3), mk(1, 3, 0, 2)];

  it("solo los partidos del equipo, vistos desde él", () => {
    const views = teamRecent(matches, 1);
    expect(views.map((v) => v.venue)).toEqual(["home", "away", "home"]);
    expect(views.map(outcomeOf)).toEqual(["W", "D", "L"]);
    expect(views[1].goalsFor).toBe(1);
  });

  it("con campo, solo los de ese campo", () => {
    expect(teamRecent(matches, 1, "away").map((v) => v.match.home_team_id)).toEqual([3]);
  });

  it("se salta los partidos sin resultado", () => {
    expect(teamRecent([{ ...mk(1, 2, 0, 0), home_goals: null, away_goals: null }], 1)).toEqual([]);
  });
});

describe("headToHeadSummary", () => {
  it("cuenta desde el equipo de las vistas, en los dos campos", () => {
    // Equipo 1: gana 2-0 en casa, empata 1-1 fuera, pierde 0-3 en casa (sin corners).
    const h2h = [mk(1, 2, 2, 0, [6, 2]), mk(2, 1, 1, 1, [4, 4]), mk(1, 2, 0, 3, null)];
    const s = headToHeadSummary(teamRecent(h2h, 1));
    expect([s.matches, s.wins, s.draws, s.losses]).toEqual([3, 1, 1, 1]);
    expect(s.goalsPerMatch).toBeCloseTo(7 / 3);
    expect(s.over25).toBeCloseTo(1 / 3);
    expect(s.btts).toBeCloseTo(1 / 3);
    // El partido sin corners no cuenta en la media (ni como 0).
    expect(s.cornersPerMatch).toBe(8);
    expect(s.cardsPerMatch).toBe(4);
  });

  it("sin partidos, sin porcentajes", () => {
    const s = headToHeadSummary([]);
    expect([s.matches, s.over25, s.btts, s.goalsPerMatch, s.cornersPerMatch]).toEqual([0, null, null, null, null]);
  });
});
