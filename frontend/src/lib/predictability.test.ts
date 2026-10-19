import { describe, expect, it } from "vitest";
import type { Match, MatchResult, PredictabilityModel } from "../api/types";
import { priorMatches, probablePicks } from "./patterns";
import { bandOf, matchFeatures, percentileOf, predictExcess } from "./predictability";

// --- Liga de prueba: 8 equipos, partidos cada 3 dias ----------------------------

const TEAMS = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `Equipo ${i + 1}` }));
let nextId = 1;
function mk(home: number, away: number, day: number, hg: number, ag: number): MatchResult {
  return {
    id: nextId++,
    date: new Date(Date.UTC(2026, 7, 15, 18) + day * 86_400_000).toISOString().slice(0, 19),
    status: "historical",
    league_id: 2,
    league_code: "ESP-La Liga",
    season: "2627",
    home_team_id: TEAMS[home].id,
    away_team_id: TEAMS[away].id,
    home_team: TEAMS[home].name,
    away_team: TEAMS[away].name,
    home_goals: hg,
    away_goals: ag,
    home_ht_goals: Math.min(hg, 1),
    away_ht_goals: 0,
    referee: day % 2 ? "R Uno" : "R Dos",
    matchday: Math.floor(day / 3) + 1,
    matchday_estimated: false,
    home_stats: { corners: 4 + (day % 5), yellow_cards: 2, red_cards: 0, fouls: 11, shots: 12, shots_on_target: 4 },
    away_stats: { corners: 3 + (day % 4), yellow_cards: 2, red_cards: 0, fouls: 12, shots: 9, shots_on_target: 3 },
  };
}

const history: MatchResult[] = [];
for (let day = 0; day < 60; day += 3) {
  for (let k = 0; k < 4; k++) history.push(mk((k + day) % 8, (k + day + 4) % 8, day, (day + k) % 3, (day + 2 * k) % 2));
}
const target: Match = { ...history[40], status: "scheduled", home_goals: null, away_goals: null };

describe("variables del índice", () => {
  it("solo usan partidos anteriores: añadir partidos posteriores no las cambia", () => {
    const features = (pool: MatchResult[]) =>
      matchFeatures(target, probablePicks(target, pool), priorMatches(target, pool));
    const later = [mk(0, 1, 90, 7, 0), mk(target.home_team_id - 1, target.away_team_id - 1, 95, 0, 6)];
    expect(features([...history, ...later])).toEqual(features(history));
  });

  it("cuenta el historial y la muestra del árbitro antes del partido", () => {
    const prior = priorMatches(target, history);
    const f = matchFeatures(target, probablePicks(target, history), prior);
    expect(f.referee_sample).toBe(prior.filter((m) => m.referee === target.referee).length);
    expect(f.history_min).toBeGreaterThan(0);
    expect(f.league_premier).toBe(0);
  });
});

describe("modelo y bandas", () => {
  const model: PredictabilityModel = {
    features: ["n_alta", "sample_min"],
    mean: [1, 10],
    scale: [1, 5],
    coef: [0.02, 0.01],
    intercept: 0.05,
    reference: [0.01, 0.03, 0.03, 0.08],
  };

  it("un dato que falta cuenta como la media del entrenamiento", () => {
    expect(predictExcess({ n_alta: 1, sample_min: null }, model)).toBeCloseTo(0.05);
    expect(predictExcess({ n_alta: 2, sample_min: 15 }, model)).toBeCloseTo(0.08);
  });

  it("percentil con empates a la mitad y terciles fijos", () => {
    expect(percentileOf(0.03, model.reference)).toBe(50);
    expect(bandOf(33.2)).toBe("baja");
    expect(bandOf(33.4)).toBe("media");
    expect(bandOf(66.7)).toBe("alta");
  });
});
