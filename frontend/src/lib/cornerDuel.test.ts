import { describe, expect, it } from "vitest";
import type { MatchResult } from "../api/types";
import { CORNER_CAP, cornerDuelForecast, countPmf, duelProbabilities } from "./cornerDuel";

const DAY = 86_400_000;
const AT = Date.UTC(2026, 9, 10, 12);
let nextId = 1;

function m(home: number, away: number, hc: number | null, ac: number | null, daysBefore: number): MatchResult {
  return {
    id: nextId++,
    date: new Date(AT - daysBefore * DAY).toISOString().slice(0, 19),
    status: "historical",
    league_id: 1,
    league_code: "ESP-La Liga",
    season: "2627",
    home_team_id: home,
    away_team_id: away,
    home_team: `T${home}`,
    away_team: `T${away}`,
    home_goals: 1,
    away_goals: 1,
    home_ht_goals: 0,
    away_ht_goals: 0,
    referee: null,
    matchday: null,
    matchday_estimated: false,
    home_stats: { corners: hc, yellow_cards: 1, red_cards: 0, fouls: 10, shots: 10, shots_on_target: 3 },
    away_stats: { corners: ac, yellow_cards: 1, red_cards: 0, fouls: 10, shots: 10, shots_on_target: 3 },
  };
}

/** Liga de 60 partidos entre equipos 10..19, 5.5 - 4.5 córners de media. */
const LEAGUE = Array.from({ length: 60 }, (_, i) => m(10 + (i % 10), 10 + ((i + 3) % 10), 4 + (i % 4), 3 + ((i + 1) % 4), 1 + i));
const TARGET = { date: new Date(AT).toISOString().slice(0, 19), home_team_id: 1, away_team_id: 2 };

describe("distribuciones", () => {
  it("suman 1 y tienen la media pedida", () => {
    for (const alpha of [0, 0.1]) {
      const pmf = countPmf(5, alpha);
      expect(pmf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      expect(pmf.reduce((s, p, k) => s + p * k, 0)).toBeCloseTo(5, 3);
    }
  });

  it("dos equipos iguales: el mismo resultado a cada lado", () => {
    const p = duelProbabilities(countPmf(5, 0.05), countPmf(5, 0.05));
    expect(p.home).toBeCloseTo(p.away, 9);
    expect(p.home + p.draw + p.away).toBeCloseTo(1, 9);
  });
});

describe("cornerDuelForecast", () => {
  it("sin partidos anteriores con córners no hay pronóstico", () => {
    expect(cornerDuelForecast(TARGET, [])).toBeNull();
    expect(cornerDuelForecast(TARGET, [m(1, 2, null, null, 3)])).toBeNull();
  });

  it("el que más saca en casa contra el que más concede fuera es favorito", () => {
    const strong = [8, 9, 7, 8, 9].map((c, i) => m(1, 10 + i, c, 2, 2 + i * 7));
    const leaky = [2, 3, 2, 3, 2].map((c, i) => m(11 + i, 2, 8, c, 3 + i * 7));
    const f = cornerDuelForecast(TARGET, [...LEAGUE, ...strong, ...leaky])!;
    expect(f.home).toBeGreaterThan(0.6);
    expect(f.home + f.draw + f.away).toBeCloseTo(1, 9);
    expect(f.homeNotLose).toBeCloseTo(f.home + f.draw, 9);
    expect(f.homeExpected).toBeGreaterThan(f.awayExpected);
    expect([f.homeMatches, f.awayMatches]).toEqual([5, 5]);
  });

  it("sin partidos del equipo, la media de la liga", () => {
    const f = cornerDuelForecast(TARGET, LEAGUE)!;
    const leagueHome = LEAGUE.reduce((s, x) => s + x.home_stats!.corners!, 0) / LEAGUE.length;
    expect(f.homeExpected).toBeCloseTo(leagueHome, 0);
  });

  it("solo cuentan los partidos anteriores", () => {
    const before = cornerDuelForecast(TARGET, LEAGUE);
    const future = m(1, 2, 15, 0, -2);
    expect(cornerDuelForecast(TARGET, [...LEAGUE, future])).toEqual(before);
  });

  it(`un partido extremo cuenta como ${CORNER_CAP}`, () => {
    const extreme = cornerDuelForecast(TARGET, [...LEAGUE, m(1, 12, 18, 0, 5)]);
    const capped = cornerDuelForecast(TARGET, [...LEAGUE, m(1, 12, CORNER_CAP, 0, 5)]);
    expect(extreme).toEqual(capped);
  });

  it("lo reciente pesa más", () => {
    const recentHigh = [m(1, 12, 9, 4, 3), m(1, 13, 3, 4, 300)];
    const recentLow = [m(1, 12, 3, 4, 3), m(1, 13, 9, 4, 300)];
    expect(cornerDuelForecast(TARGET, [...LEAGUE, ...recentHigh])!.homeExpected).toBeGreaterThan(
      cornerDuelForecast(TARGET, [...LEAGUE, ...recentLow])!.homeExpected,
    );
  });
});
