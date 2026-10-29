import { describe, expect, it } from "vitest";
import type { MatchResult, TeamMatchStats } from "../api/types";
import { cornerDuelForecast } from "./cornerDuel";
import {
  cardsForecast,
  cardsForecastWith,
  MODEL,
  predictStats,
  PUBLISHED,
  refereeFactor,
  statForecast,
  statForecastWith,
  statValue,
  STAT_KEYS,
} from "./statsPredictor";

const DAY = 86_400_000;
const AT = Date.UTC(2026, 9, 27, 12);
let nextId = 1;

function stats(shots: number, extra: Partial<TeamMatchStats> = {}): TeamMatchStats {
  return { corners: 5, yellow_cards: 2, red_cards: 0, fouls: 11, shots, shots_on_target: 4, xg: 1.2, ...extra };
}

function m(home: number, away: number, hs: TeamMatchStats | null, as: TeamMatchStats | null, daysBefore: number): MatchResult {
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
    home_stats: hs,
    away_stats: as,
  };
}

/** Liga de 60 partidos entre equipos 10..19, con tiros y córners variados. */
const LEAGUE = Array.from({ length: 60 }, (_, i) =>
  m(
    10 + (i % 10),
    10 + ((i + 3) % 10),
    stats(10 + (i % 6), { corners: 4 + (i % 4) }),
    stats(8 + (i % 5), { corners: 3 + ((i + 1) % 4) }),
    1 + i,
  ),
);
const TARGET = { date: new Date(AT).toISOString().slice(0, 19), home_team_id: 1, away_team_id: 2, referee: null };

describe("statForecast", () => {
  it("sin partidos anteriores con esa estadística no hay estimación", () => {
    expect(statForecast(TARGET, [], "shots")).toBeNull();
    const noXg = LEAGUE.map((x) => ({ ...x, home_stats: { ...x.home_stats!, xg: null }, away_stats: { ...x.away_stats!, xg: undefined } }));
    expect(statForecast(TARGET, noXg, "xg")).toBeNull();
    expect(statForecast(TARGET, noXg, "shots")).not.toBeNull();
  });

  it("en córners, lo mismo que el duelo de córners", () => {
    const strong = [8, 9, 7, 8, 9].map((c, i) => m(1, 10 + i, stats(12, { corners: c }), stats(9, { corners: 2 }), 2 + i * 7));
    const prior = [...LEAGUE, ...strong, m(1, 12, stats(12, { corners: 18 }), stats(9), 4)];
    const duel = cornerDuelForecast(TARGET, prior)!;
    const f = statForecast(TARGET, prior, "corners")!;
    expect(f.home).toBeCloseTo(duel.homeExpected, 12);
    expect(f.away).toBeCloseTo(duel.awayExpected, 12);
    expect([f.homeMatches, f.awayMatches]).toEqual([duel.homeMatches, duel.awayMatches]);
  });

  it("el que más tira en casa contra el que más concede fuera tira más que la liga", () => {
    const shooter = [20, 22, 19, 21, 20].map((s, i) => m(1, 10 + i, stats(s), stats(8), 2 + i * 7));
    const leaky = [6, 7, 6, 7, 6].map((s, i) => m(11 + i, 2, stats(22), stats(s), 3 + i * 7));
    const f = statForecast(TARGET, [...LEAGUE, ...shooter, ...leaky], "shots")!;
    const plain = statForecast(TARGET, LEAGUE, "shots")!;
    expect(f.home).toBeGreaterThan(plain.home + 3);
    expect(f.away).toBeLessThan(plain.away);
    expect([f.homeMatches, f.awayMatches]).toEqual([5, 5]);
  });

  it("solo cuentan los partidos anteriores (ni el mismo día y hora ni después)", () => {
    const before = predictStats(TARGET, LEAGUE);
    const same = m(1, 2, stats(40), stats(0), 0);
    const future = m(1, 2, stats(40), stats(0), -3);
    expect(predictStats(TARGET, [...LEAGUE, same, future])).toEqual(before);
  });

  it("un partido sin esa estadística no cuenta para ella", () => {
    const missing = m(1, 12, stats(30, { fouls: null }), stats(8, { fouls: null }), 2);
    const f = statForecast(TARGET, [...LEAGUE, missing], "fouls")!;
    expect(f.homeMatches).toBe(0);
    expect(statForecast(TARGET, [...LEAGUE, missing], "shots")!.homeMatches).toBe(1);
  });
});

describe("statValue", () => {
  it("null si falta la estadística o el partido no tiene stats", () => {
    expect(statValue(null, "shots")).toBeNull();
    expect(statValue(stats(10, { xg: undefined }), "xg")).toBeNull();
    expect(statValue(stats(10), "shots")).toBe(10);
  });

  it("las siete estadísticas de la tabla", () => {
    expect(STAT_KEYS).toHaveLength(7);
  });
});

describe("refereeFactor", () => {
  const ref = (x: MatchResult, referee: string) => ({ ...x, referee });
  const cards = (yellow: number) => stats(10, { yellow_cards: yellow });
  /** Liga con árbitros "R0".."R4" (2 + 2 amarillas por partido de media). */
  const league = LEAGUE.map((x, i) => ref(x, `R${i % 5}`));
  const target = { ...TARGET, referee: "Duro" };
  const raw = { method: "raw", shrink: 5 } as const;
  const adjusted = { method: "adjusted", shrink: 5 } as const;

  it("sin árbitro designado no hay factor; sin partidos suyos, 1", () => {
    expect(refereeFactor({ ...TARGET, referee: null }, league, "yellow_cards", raw)).toBeNull();
    expect(refereeFactor(target, league, "yellow_cards", raw)).toEqual({ factor: 1, matches: 0 });
    expect(refereeFactor(target, league, "yellow_cards", adjusted)!.factor).toBeCloseTo(1, 12);
  });

  it("un árbitro que saca más tarjetas que la liga sube la estimación de los dos equipos", () => {
    const strict = [1, 2, 3, 4, 5, 6].map((i) => ref(m(10 + i, 11 + ((i + 2) % 8), cards(5), cards(5), 2 + i * 6), "Duro"));
    const prior = [...league, ...strict];
    for (const settings of [raw, adjusted]) {
      const f = refereeFactor(target, prior, "yellow_cards", settings)!;
      expect(f.matches).toBe(6);
      expect(f.factor).toBeGreaterThan(1.3);
      const base = statForecast(target, prior, "yellow_cards")!;
      const withReferee = cardsForecast(target, prior, "yellow_cards", settings)!;
      expect(withReferee.home).toBeCloseTo(base.home * f.factor, 12);
      expect(withReferee.away).toBeCloseTo(base.away * f.factor, 12);
    }
  });

  it("ajustado: no culpa al árbitro de pitar a equipos que ya sacan muchas tarjetas", () => {
    // Los equipos 30 y 31 sacan 5 amarillas con cualquier árbitro; "Duro" solo les ha pitado a ellos.
    const heavy = Array.from({ length: 12 }, (_, i) =>
      ref(m(i % 2 ? 30 : 31, 10 + (i % 10), cards(5), cards(5), 2 + i * 5), i < 6 ? "Duro" : `R${i % 5}`),
    );
    const prior = [...league, ...heavy];
    const rawFactor = refereeFactor(target, prior, "yellow_cards", raw)!.factor;
    const adjustedFactor = refereeFactor(target, prior, "yellow_cards", adjusted)!.factor;
    expect(rawFactor).toBeGreaterThan(1.3);
    // Buena parte de su exceso lo explican los equipos.
    expect(adjustedFactor - 1).toBeLessThan((rawFactor - 1) / 2);
  });

  it("más encogimiento, más cerca de 1; y solo cuentan sus partidos anteriores", () => {
    const strict = [1, 2, 3].map((i) => ref(m(10 + i, 15, cards(5), cards(5), 2 + i * 6), "Duro"));
    const prior = [...league, ...strict];
    const soft = refereeFactor(target, prior, "yellow_cards", { method: "raw", shrink: 20 })!;
    expect(soft.factor).toBeGreaterThan(1);
    expect(soft.factor).toBeLessThan(refereeFactor(target, prior, "yellow_cards", raw)!.factor);
    const future = ref(m(12, 15, cards(9), cards(9), -2), "Duro");
    expect(refereeFactor(target, [...prior, future], "yellow_cards", adjusted)).toEqual(
      refereeFactor(target, prior, "yellow_cards", adjusted),
    );
  });
});

describe("statForecastWith", () => {
  const shooter = [20, 22, 19, 21, 20].map((s, i) => m(1, 10 + i, stats(s), stats(8), 2 + i * 7));
  const away = [18, 17, 19].map((s, i) => m(15 + i, 1, stats(9), stats(s), 4 + i * 7));
  const prior = [...LEAGUE, ...shooter, ...away];

  it("con la configuración publicada, exactamente statForecast", () => {
    for (const key of STAT_KEYS) {
      const a = statForecast(TARGET, prior, key);
      const b = statForecastWith(TARGET, prior, key, PUBLISHED);
      expect(b?.home).toBe(a?.home);
      expect(b?.away).toBe(a?.away);
      expect([b?.homeMatches, b?.awayMatches]).toEqual([a?.homeMatches, a?.awayMatches]);
    }
  });

  it("pooled: cuenta todos los partidos del equipo, en casa y fuera", () => {
    const f = statForecastWith(TARGET, prior, "shots", { structure: "pooled", decay: 0.0018, shrink: 5 })!;
    expect(f.scope).toBe("all");
    expect(f.homeMatches).toBe(8);
    // Tira mucho en casa y fuera: por encima de la liga también con todos sus partidos.
    expect(f.home).toBeGreaterThan(statForecast(TARGET, LEAGUE, "shots")!.home + 3);
    const venue = statForecastWith(TARGET, prior, "shots", { structure: "venue", decay: 0.0018, shrink: 5 })!;
    const blend = statForecastWith(TARGET, prior, "shots", { structure: "blend", decay: 0.0018, shrink: 5 })!;
    expect(blend.home).toBeCloseTo((venue.home + f.home) / 2, 12);
  });

  it("más encogimiento, más cerca de la liga; y solo cuentan los partidos anteriores", () => {
    const loose = statForecastWith(TARGET, prior, "shots", { structure: "pooled", decay: 0.0018, shrink: 2 })!;
    const tight = statForecastWith(TARGET, prior, "shots", { structure: "pooled", decay: 0.0018, shrink: 20 })!;
    expect(loose.home).toBeGreaterThan(tight.home);
    const future = m(1, 2, stats(40), stats(0), -3);
    for (const structure of ["venue", "pooled", "blend"] as const) {
      const settings = { structure, decay: 0.0009, shrink: 10 };
      expect(statForecastWith(TARGET, [...prior, future], "shots", settings)).toEqual(statForecastWith(TARGET, prior, "shots", settings));
    }
  });
});

describe("cardsForecastWith", () => {
  const ref = (x: MatchResult, referee: string) => ({ ...x, referee });
  const league = LEAGUE.map((x, i) => ref(x, `R${i % 5}`));
  const target = { ...TARGET, referee: "R1" };
  const r1 = { method: "raw", shrink: 10 } as const;

  it("liga × árbitro: la media de la liga en cada campo por el factor R1", () => {
    const f = cardsForecastWith(target, league, "yellow_cards", { base: "league", referee: r1 })!;
    const factor = refereeFactor(target, league, "yellow_cards", r1)!.factor;
    // Todos los partidos de la liga tienen 2 amarillas por equipo.
    expect(f.home).toBeCloseTo(2 * factor, 12);
    expect(f.away).toBeCloseTo(2 * factor, 12);
  });

  it("con árbitro pedido y sin designar, nada; sin árbitro, el modelo de equipos", () => {
    expect(cardsForecastWith({ ...target, referee: null }, league, "yellow_cards", { base: "league", referee: r1 })).toBeNull();
    const plain = cardsForecastWith(target, league, "yellow_cards", { base: PUBLISHED, referee: null })!;
    expect(plain.home).toBe(statForecast(target, league, "yellow_cards")!.home);
    const r2 = { method: "adjusted", shrink: 10 } as const;
    expect(cardsForecastWith(target, league, "yellow_cards", { base: PUBLISHED, referee: r2 })!.home).toBeCloseTo(
      cardsForecast(target, league, "yellow_cards", r2)!.home,
      12,
    );
  });
});

describe("predictStats", () => {
  const league = LEAGUE.map((x, i) => ({ ...x, referee: `R${i % 5}` }));

  it("cada estadística con su configuración de MODEL", () => {
    const f = predictStats(TARGET, league);
    for (const key of ["xg", "shots", "shots_on_target", "corners", "fouls"] as const) {
      expect(MODEL[key].referee).toBeNull();
      expect(f[key]).toEqual(statForecastWith(TARGET, league, key, MODEL[key].base as Exclude<(typeof MODEL)[typeof key]["base"], "league">));
    }
  });

  it("las amarillas llevan árbitro: sin árbitro designado, sin estimación", () => {
    expect(predictStats(TARGET, league).yellow_cards).toBeNull();
    const withReferee = predictStats({ ...TARGET, referee: "R2" }, league).yellow_cards!;
    expect(withReferee.referee?.matches).toBe(12);
    expect(withReferee).toEqual(cardsForecastWith({ ...TARGET, referee: "R2" }, league, "yellow_cards", MODEL.yellow_cards));
  });
});
