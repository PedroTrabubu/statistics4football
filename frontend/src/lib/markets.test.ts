import { describe, expect, it } from "vitest";
import type { MatchResult, TeamMatchStats } from "../api/types";
import { findMarket, groupByReferee, hitRate, matchRedCards } from "./markets";

const STATS: TeamMatchStats = { corners: 5, yellow_cards: 2, red_cards: 0, fouls: 10, shots: 10, shots_on_target: 4 };

function match(id: number, reds: [number, number] | null): MatchResult {
  return {
    id,
    date: `2026-10-0${id}T19:00:00`,
    status: "historical",
    league_id: 2,
    league_code: "ESP-La Liga",
    season: "2627",
    home_team_id: 1,
    away_team_id: 2,
    home_team: "Sevilla",
    away_team: "Betis",
    home_goals: 1,
    away_goals: 0,
    home_ht_goals: 0,
    away_ht_goals: 0,
    referee: "J Martinez",
    matchday: id,
    matchday_estimated: false,
    home_stats: reds ? { ...STATS, red_cards: reds[0] } : null,
    away_stats: reds ? { ...STATS, red_cards: reds[1] } : null,
  };
}

// El último, sin estadísticas: no cuenta.
const views = groupByReferee([match(1, [1, 0]), match(2, [0, 0]), match(3, [1, 1]), match(4, null)])[0].all;

describe("expulsiones", () => {
  it("cuenta las rojas de los dos equipos", () => {
    expect(views.map(matchRedCards)).toEqual([1, 0, 2, null]);
  });

  it("un partido sin el dato no cuenta como cero", () => {
    const reds = findMarket("expulsiones")!;
    const any = reds.options.find((o) => o.key === "si")!;
    expect(hitRate(views, any)).toEqual({ hits: 2, total: 3, missing: 1, pct: 2 / 3 });
    const none = reds.options.find((o) => o.key === "no")!;
    expect(hitRate(views, none).hits).toBe(1);
    const twoOrMore = reds.options.find((o) => o.key === "dos")!;
    expect(hitRate(views, twoOrMore).hits).toBe(1);
  });

  it("es un mercado de partido: sale en Árbitros", () => {
    expect(findMarket("expulsiones")!.matchLevel).toBe(true);
  });
});
