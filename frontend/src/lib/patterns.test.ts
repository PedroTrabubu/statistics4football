import { describe, expect, it } from "vitest";
import type { Match, MatchResult, TeamMatchStats } from "../api/types";
import { findMarket, hitRate } from "./markets";
import {
  checkPlayedPicks,
  checkRival,
  cornerDuelPicks,
  evidenceText,
  findTeamPatterns,
  isModelMarket,
  leagueRates,
  passesTeamRule,
  pickOutcome,
  pickStrength,
  priorMatches,
  probablePicks,
  refereeFactText,
  refereeFacts,
  rankTeams,
  rivalState,
  summarizeByTeam,
  summarizePicks,
  upcomingPicks,
  teamContexts,
  wilsonLower,
  type TeamPattern,
} from "./patterns";

// --- Partidos de prueba -----------------------------------------------------

const LOCAL = { id: 1, name: "Local" };
const VISITOR = { id: 2, name: "Visitante" };
const MATCH_DATE = "2026-10-09T19:00:00";

const STATS: TeamMatchStats = { corners: 5, yellow_cards: 1, red_cards: 0, fouls: 10, shots: 10, shots_on_target: 4 };

let nextId = 1000;
function mk(p: {
  home: { id: number; name: string };
  away: { id: number; name: string };
  hg: number;
  ag: number;
  day: number;
  season?: string;
  referee?: string | null;
  homeStats?: Partial<TeamMatchStats>;
  awayStats?: Partial<TeamMatchStats>;
}): MatchResult {
  const date = new Date(Date.UTC(2026, 9, 9, 12) - p.day * 86_400_000).toISOString().slice(0, 19);
  return {
    id: nextId++,
    date,
    status: "historical",
    league_id: 2,
    league_code: "ESP-La Liga",
    season: p.season ?? "2627",
    home_team_id: p.home.id,
    away_team_id: p.away.id,
    home_team: p.home.name,
    away_team: p.away.name,
    home_goals: p.hg,
    away_goals: p.ag,
    home_ht_goals: 0,
    away_ht_goals: 0,
    referee: p.referee ?? null,
    matchday: null,
    matchday_estimated: false,
    home_stats: { ...STATS, ...p.homeStats },
    away_stats: { ...STATS, ...p.awayStats },
  };
}

const other = (i: number) => ({ id: 100 + i, name: `Rival ${i}` });

const THIS_MATCH: Match = {
  id: 1,
  date: MATCH_DATE,
  status: "scheduled",
  league_id: 2,
  league_code: "ESP-La Liga",
  season: "2627",
  home_team_id: LOCAL.id,
  away_team_id: VISITOR.id,
  home_team: LOCAL.name,
  away_team: VISITOR.name,
  home_goals: null,
  away_goals: null,
  home_ht_goals: null,
  away_ht_goals: null,
  referee: "Árbitro",
  matchday: 8,
  matchday_estimated: false,
};

/** Partidos fuera de casa del visitante: marca `goals[i]` en el i-esimo y el
 * local no marca (asi no sale "marcan los dos", que absorberia a "Marca"). */
function visitorAway(goals: number[], season = "2627", startDay = 1): MatchResult[] {
  return goals.map((g, i) => mk({ home: other(i), away: VISITOR, hg: 0, ag: g, day: startDay + i * 7, season }));
}

/** Partidos de otros equipos con resultados variados: la liga "normal". */
function league(n = 40): MatchResult[] {
  const scores = [
    [0, 0],
    [1, 0],
    [2, 1],
    [0, 2],
    [1, 1],
    [3, 0],
  ];
  return Array.from({ length: n }, (_, i) => {
    const [hg, ag] = scores[i % scores.length];
    return mk({ home: other(20 + (i % 10)), away: other(30 + (i % 10)), hg, ag, day: 1 + i, season: i < 20 ? "2627" : "2526" });
  });
}

function patternsOf(history: MatchResult[], side: "home" | "away" = "away"): TeamPattern[] {
  const prior = priorMatches(THIS_MATCH, history);
  const team = side === "home" ? { side, ...LOCAL } : { side, ...VISITOR };
  return findTeamPatterns(teamContexts(prior, team.id, side, "2627"), team, leagueRates(prior));
}

/** Patrones "Marca (más de X)": la escalera de "más de" de los goles del equipo. */
const scoring = (patterns: TeamPattern[]) =>
  patterns.filter((p) => p.family === "goles-equipo" && p.info.dir === "over");

// --- Tests ----------------------------------------------------------------------

describe("wilsonLower", () => {
  it("penaliza la muestra pequeña", () => {
    expect(wilsonLower(5, 5)).toBeCloseTo(0.566, 2);
    expect(wilsonLower(20, 20)).toBeCloseTo(0.839, 2);
    expect(wilsonLower(5, 5)).toBeLessThan(wilsonLower(20, 20));
    expect(wilsonLower(0, 0)).toBe(0);
  });
});

describe("muestra mínima de un patrón de equipo", () => {
  const rate = (hits: number, total: number) => ({ hits, total, missing: 0, pct: total ? hits / total : null });
  it("100 %: desde 5 partidos", () => {
    expect(passesTeamRule(rate(5, 5))).toBe(true);
    expect(passesTeamRule(rate(4, 4))).toBe(false);
  });
  it("80-99 %: desde 8 partidos", () => {
    expect(passesTeamRule(rate(7, 8))).toBe(true);
    expect(passesTeamRule(rate(6, 7))).toBe(false);
  });
  it("por debajo del 80 %, nunca", () => {
    expect(passesTeamRule(rate(7, 9))).toBe(false);
    expect(passesTeamRule(rate(15, 20))).toBe(false);
  });
});

describe("findTeamPatterns", () => {
  it("'marcan los dos' hace sobrar 'Marca'", () => {
    const both = [1, 2, 1, 1, 3, 1].map((g, i) => mk({ home: other(i), away: VISITOR, hg: 1, ag: g, day: 1 + i * 7 }));
    const found = patternsOf([...league(), ...both]);
    expect(found.some((p) => p.family === "ambos-marcan" && p.option.key === "si")).toBe(true);
    expect(scoring(found)).toHaveLength(0);
  });

  it("detecta un 100 %: marca en los 6 partidos fuera", () => {
    const found = scoring(patternsOf([...league(), ...visitorAway([1, 2, 1, 1, 3, 1])]));
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe("Marca");
    expect(found[0].rate).toMatchObject({ hits: 6, total: 6 });
    expect(found[0].context.venue).toBe("away");
  });

  it("detecta un 80-99 % con muestra suficiente y descarta el que no la tiene", () => {
    expect(scoring(patternsOf([...league(), ...visitorAway([1, 1, 0, 1, 1, 2, 1, 1])]))[0].rate).toMatchObject({
      hits: 7,
      total: 8,
    });
    expect(scoring(patternsOf([...league(), ...visitorAway([1, 1, 0, 1, 1, 2, 1])]))).toHaveLength(0);
  });

  it("no muestra nada por debajo del umbral", () => {
    expect(scoring(patternsOf([...league(), ...visitorAway([1, 0, 0, 1, 1, 2, 0, 1, 1, 0])]))).toHaveLength(0);
  });

  it("solo muestra la línea más exigente que se cumple", () => {
    const found = scoring(patternsOf([...league(), ...visitorAway([2, 3, 2, 2, 4, 2])]));
    expect(found.map((p) => p.text)).toEqual(["Marca más de 1.5 goles"]);
  });

  it("usa el campo del partido: lo que hace en casa no cuenta para sus partidos fuera", () => {
    const home = Array.from({ length: 6 }, (_, i) => mk({ home: VISITOR, away: other(50 + i), hg: 0, ag: 1, day: 3 + i * 7 }));
    const found = scoring(patternsOf([...league(), ...visitorAway([1, 2, 1, 1, 3, 1]), ...home]));
    expect(found[0]).toMatchObject({ text: "Marca", rate: { hits: 6, total: 6 } });
    expect(found[0].context.kind).toBe("season-venue");
  });

  it("cero fuga del futuro: un partido posterior no cambia nada", () => {
    const history = [...league(), ...visitorAway([1, 2, 1, 1, 3, 1])];
    const later = mk({ home: other(9), away: VISITOR, hg: 2, ag: 0, day: -3 });
    const sameMatch = { ...mk({ home: LOCAL, away: VISITOR, hg: 0, ag: 0, day: 0 }), id: THIS_MATCH.id };
    expect(priorMatches(THIS_MATCH, [later, sameMatch])).toEqual([]);
    const strip = (ps: TeamPattern[]) => ps.map((p) => `${p.family}|${p.option.key}|${p.rate.hits}/${p.rate.total}`);
    expect(strip(patternsOf([...history, later, sameMatch]))).toEqual(strip(patternsOf(history)));
  });

  it("descarta lo trivial: lo que en la liga pasa casi siempre", () => {
    // Todos los equipos reciben 1 tarjeta: "Recibe más de 0.5 tarjetas" se
    // cumple siempre, pero también en toda la liga.
    const found = patternsOf([...league(), ...visitorAway([1, 2, 1, 1, 3, 1])]);
    expect(found.some((p) => p.family === "tarjetas-equipo")).toBe(false);
  });

  it("indica el contexto y las temporadas usadas", () => {
    const history = [...league(), ...visitorAway([1, 1, 1], "2627"), ...visitorAway([1, 1, 1, 1, 1, 1, 1], "2526", 60)];
    const [pattern] = scoring(patternsOf(history));
    expect(pattern.context.kind).toBe("recent-venue");
    expect(evidenceText(pattern.rate.hits, pattern.rate.total, pattern.context)).toBe(
      "En 10 de sus últimos 10 partidos fuera de casa (25/26 y 26/27)",
    );
  });
});

describe("contraste con el rival", () => {
  const rate = (hits: number, total: number) => ({ hits, total, missing: 0, pct: total ? hits / total : null });

  it("los cuatro estados", () => {
    expect(rivalState(rate(6, 6))).toBe("backed");
    expect(rivalState(rate(4, 4))).toBe("partial"); // lo cumple, pero con muestra menor
    expect(rivalState(rate(3, 5))).toBe("partial");
    expect(rivalState(rate(1, 5))).toBe("against");
    expect(rivalState(rate(2, 2))).toBe("none");
    expect(rivalState(null)).toBe("none");
  });

  /** "Visitante marca fuera" contra el local en casa, que encaja `conceded[i]`. */
  function crossWith(conceded: number[]) {
    const localHome = conceded.map((g, i) => mk({ home: LOCAL, away: other(60 + i), hg: 1, ag: g, day: 2 + i * 7 }));
    const history = [...league(), ...visitorAway([1, 2, 1, 1, 3, 1]), ...localHome];
    const prior = priorMatches(THIS_MATCH, history);
    const [pattern] = scoring(patternsOf(history));
    return checkRival(pattern, teamContexts(prior, LOCAL.id, "home", "2627"), { name: LOCAL.name });
  }

  it("mide en el rival el suceso complementario (marca fuera -> encaja en casa)", () => {
    const backed = crossWith([1, 1, 2, 1, 1, 1]);
    expect(backed).toMatchObject({ state: "backed", text: "Encaja", rate: { hits: 6, total: 6 } });
    expect(crossWith([1, 0, 1, 2, 0]).state).toBe("partial");
    expect(crossWith([0, 0, 0, 1, 0]).state).toBe("against");
    expect(crossWith([1, 1]).state).toBe("none");
  });

  it("sin métrica complementaria sensata, sin contraste", () => {
    const cards = Array.from({ length: 6 }, (_, i) =>
      mk({ home: other(70 + i), away: VISITOR, hg: 1, ag: 1, day: 1 + i * 7, awayStats: { yellow_cards: 4 } }),
    );
    const history = [...league(), ...cards];
    const prior = priorMatches(THIS_MATCH, history);
    const pattern = patternsOf(history).find((p) => p.family === "tarjetas-equipo")!;
    expect(pattern.text).toBe("Recibe más de 3.5 tarjetas");
    expect(checkRival(pattern, teamContexts(prior, LOCAL.id, "home", "2627"), LOCAL).state).toBe("none");
  });
});

describe("probablePicks", () => {
  it("un suceso del partido que sale en los dos equipos aparece una sola vez", () => {
    // Los dos equipos: siempre más de 2.5 goles en sus partidos.
    const visitor = Array.from({ length: 6 }, (_, i) => mk({ home: other(i), away: VISITOR, hg: 2, ag: 2, day: 1 + i * 7 }));
    const local = Array.from({ length: 6 }, (_, i) => mk({ home: LOCAL, away: other(10 + i), hg: 2, ag: 2, day: 2 + i * 7 }));
    const picks = probablePicks(THIS_MATCH, [...league(), ...visitor, ...local]);
    expect(picks.filter((p) => p.family === "goles" && p.info.dir === "over")).toHaveLength(1);
    expect(picks.length).toBeLessThanOrEqual(6);
  });
});

describe("refereeFacts", () => {
  /** `n` partidos del visitante con el arbitro, recibiendo 3 tarjetas. */
  function facts(n: number) {
    const withReferee = Array.from({ length: n }, (_, i) =>
      mk({ home: other(80 + i), away: VISITOR, hg: 1, ag: 1, day: 1 + i * 7, referee: "Árbitro", awayStats: { yellow_cards: 3 } }),
    );
    return refereeFacts(THIS_MATCH, withReferee, { venueOnly: false, history: league() }).filter(
      (f) => f.team === VISITOR.name && f.family === "tarjetas-equipo",
    );
  }

  it("con 2 partidos no se muestra", () => {
    expect(facts(2)).toHaveLength(0);
  });
  it("con 3 y 4, muestra pequeña", () => {
    expect(facts(3)[0]).toMatchObject({ smallSample: true, rate: { hits: 3, total: 3 } });
    expect(facts(4)[0].smallSample).toBe(true);
  });
  it("con 5, sin aviso", () => {
    expect(facts(5)[0].smallSample).toBe(false);
  });
});

describe("textos", () => {
  const cards = findMarket("tarjetas-equipo")!.options.find((o) => o.key === "over-1.5")!;
  const total = findMarket("tarjetas")!.options.find((o) => o.key === "under-4.5")!;
  const fact = (family: string, option: typeof cards, hits: number, n: number, matchLevel: boolean) => ({
    team: "Espanol",
    family,
    matchLevel,
    info: { key: option.key, dir: option.key.startsWith("over") ? ("over" as const) : ("under" as const), line: Number(option.key.split("-")[1]) },
    rate: { hits, total: n, missing: 0, pct: hits / n },
  });

  it("'siempre' cuando se cumplió en todos, 'N de M' si no", () => {
    expect(refereeFactText(fact("tarjetas-equipo", cards, 4, 4, false))).toBe(
      "Con este árbitro, Espanol siempre ha recibido más de 1.5 tarjetas (4 de 4 partidos).",
    );
    expect(refereeFactText(fact("tarjetas-equipo", cards, 4, 5, false))).toBe(
      "Con este árbitro, Espanol ha recibido más de 1.5 tarjetas en 4 de 5 partidos.",
    );
  });

  it("sucesos del partido", () => {
    expect(refereeFactText(fact("tarjetas", total, 4, 4, true))).toBe(
      "Con este árbitro, siempre ha habido menos de 4.5 tarjetas en los partidos de Espanol (4 de 4 partidos).",
    );
    expect(refereeFactText(fact("tarjetas", total, 4, 5, true))).toBe(
      "Con este árbitro, ha habido menos de 4.5 tarjetas en 4 de 5 partidos de Espanol.",
    );
  });

  it("evidencia de esta temporada", () => {
    const prior = priorMatches(THIS_MATCH, visitorAway([1, 1, 1, 1, 1, 1, 1]));
    const [context] = teamContexts(prior, VISITOR.id, "away", "2627");
    expect(evidenceText(7, 7, context)).toBe("En 7 de 7 partidos fuera de casa esta temporada (26/27)");
    expect(hitRate(context.views, { hit: () => true }).total).toBe(7);
  });
});

describe("fuerza de un pick", () => {
  const rate = (hits: number, total: number) => ({ hits, total, missing: 0, pct: hits / total });
  const pattern = (hits: number, total: number) => ({ rate: rate(hits, total) }) as TeamPattern;
  const rival = (state: "backed" | "partial" | "against" | "none", hits = 0, total = 0) => ({
    state,
    crossable: state !== "none",
    team: "Rival",
    text: "",
    rate: total ? rate(hits, total) : null,
    context: null,
  });

  it("Alta: respaldado por el rival y con muestra amplia", () => {
    expect(pickStrength(pattern(10, 10), rival("backed", 10, 10)).strength).toBe("alta");
  });
  it("Media: sin contraste nunca pasa de media, aunque el equipo lo cumpla siempre", () => {
    expect(pickStrength(pattern(20, 20), rival("none")).strength).toBe("media");
  });
  it("Baja: si el rival lo contradice", () => {
    expect(pickStrength(pattern(10, 10), rival("against", 1, 5)).strength).toBe("baja");
  });
});

describe("mercados del bloque de probabilidades", () => {
  const option = (slug: string, key: string) => ({ family: slug, option: findMarket(slug)!.options.find((o) => o.key === key)! });
  it("1X2, más/menos 2.5 y ambos marcan; nada más", () => {
    expect(isModelMarket(option("goles", "over-2.5"))).toBe(true);
    expect(isModelMarket(option("goles", "under-2.5"))).toBe(true);
    expect(isModelMarket(option("goles", "over-1.5"))).toBe(false);
    expect(isModelMarket(option("resultado", "gana"))).toBe(true);
    expect(isModelMarket(option("resultado", "no-pierde"))).toBe(false);
    expect(isModelMarket(option("ambos-marcan", "si"))).toBe(true);
    expect(isModelMarket(option("corners", "over-9.5"))).toBe(false);
  });
});

describe("comprobar picks de partidos jugados", () => {
  /** Liga con resultados y estadisticas variados (pseudoaleatorios, siempre
   * los mismos), dos temporadas, 8 equipos. */
  function randomLeague(): MatchResult[] {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const teams = Array.from({ length: 8 }, (_, i) => ({ id: 200 + i, name: `Equipo ${i}` }));
    const matches: MatchResult[] = [];
    for (let day = 0; day < 140; day += 2) {
      const home = teams[rand(8)];
      let away = teams[rand(8)];
      if (away.id === home.id) away = teams[(teams.indexOf(home) + 1) % 8];
      const stats = () => ({ corners: rand(10), yellow_cards: rand(5), red_cards: rand(4) === 0 ? 1 : 0, fouls: 6 + rand(12), shots: 4 + rand(14), shots_on_target: rand(8) });
      matches.push(
        mk({ home, away, hg: rand(4), ag: rand(3), day: 140 - day, season: day < 70 ? "2526" : "2627", homeStats: stats(), awayStats: stats() }),
      );
    }
    return matches;
  }

  const key = (p: { side: string; family: string; option: { key: string }; strength: string; strengthScore: number; leagueRate: number | null; rate: { hits: number; total: number } }) =>
    `${p.side}|${p.family}|${p.option.key}|${p.strength}|${p.strengthScore.toFixed(6)}|${p.leagueRate?.toFixed(6)}|${p.rate.hits}/${p.rate.total}`;

  it("da los mismos picks que la ficha de cada partido", () => {
    const history = randomLeague();
    const played = history.filter((m) => m.season === "2627");
    const results = checkPlayedPicks(played, history);
    expect(results.length).toBe(played.length);
    expect(results.some((r) => r.picks.length > 0)).toBe(true);
    for (const { match, picks } of results) {
      expect(picks.map((r) => key(r.pick))).toEqual(probablePicks(match, history).map(key));
    }
  });

  it("los picks de los partidos por jugar son los de su ficha", () => {
    const history = randomLeague();
    const pending: Match[] = [0, 3, 1].map((day, i) => ({
      ...THIS_MATCH,
      id: 9000 + i,
      date: new Date(Date.UTC(2026, 9, 12 + day, 18)).toISOString().slice(0, 19),
      home_team_id: 200 + i,
      away_team_id: 204 + i,
      home_team: `Equipo ${i}`,
      away_team: `Equipo ${4 + i}`,
    }));
    const played = { ...pending[0], id: 9999, status: "historical" as const };
    const results = upcomingPicks([...pending, played], history);
    expect(results.map((r) => r.match.id)).toEqual([9000, 9002, 9001]); // por fecha, sin el ya jugado
    expect(results.some((r) => r.picks.length > 0)).toBe(true);
    for (const { match, picks } of results) {
      expect(picks.map(key)).toEqual(probablePicks(match, history).map(key));
    }
  });

  it("cero fuga del futuro: quitar los partidos posteriores no cambia los picks", () => {
    const history = randomLeague();
    const played = history.filter((m) => m.season === "2627");
    const target = played[Math.floor(played.length / 2)];
    const past = history.filter((m) => Date.parse(m.date) < Date.parse(target.date) || m.id === target.id);
    const all = checkPlayedPicks([target], history)[0].picks.map((r) => key(r.pick));
    expect(checkPlayedPicks([target], past)[0].picks.map((r) => key(r.pick))).toEqual(all);
  });

  it("un pick se cumple, no se cumple o no se puede decidir", () => {
    const scores = { side: "away" as const, option: findMarket("goles-equipo")!.options.find((o) => o.key === "over-0.5")! };
    expect(pickOutcome(scores, mk({ home: LOCAL, away: VISITOR, hg: 0, ag: 2, day: 1 }))).toBe(true);
    expect(pickOutcome(scores, mk({ home: LOCAL, away: VISITOR, hg: 1, ag: 0, day: 1 }))).toBe(false);
    const corners = { side: "home" as const, option: findMarket("corners-equipo")!.options.find((o) => o.key === "over-4.5")! };
    const noStats = { ...mk({ home: LOCAL, away: VISITOR, hg: 1, ag: 0, day: 1 }), home_stats: null, away_stats: null };
    expect(pickOutcome(corners, noStats)).toBeNull();
  });

  it("el resumen cuenta aciertos, picks sin dato y lo esperable en la liga", () => {
    const pick = (leagueRate: number) => ({ leagueRate }) as Parameters<typeof summarizePicks>[0][number]["pick"];
    const summary = summarizePicks([
      { pick: pick(0.6), hit: true },
      { pick: pick(0.7), hit: true },
      { pick: pick(0.8), hit: false },
      { pick: pick(0.5), hit: null },
    ]);
    expect(summary).toMatchObject({ total: 3, hits: 2, undecided: 1 });
    expect(summary.rate).toBeCloseTo(2 / 3);
    expect(summary.expected).toBeCloseTo(0.7);
    expect(summary.low!).toBeLessThan(summary.rate!);
    expect(summary.high!).toBeGreaterThan(summary.rate!);
  });
});

describe("acierto por equipo", () => {
  /** Un pick inventado de un equipo, con su fuerza y si se cumplio. */
  const result = (teamId: number, team: string, strength: "alta" | "media" | "baja", hit: boolean) => ({
    pick: { teamId, team, strength, leagueRate: 0.7 } as Parameters<typeof summarizePicks>[0][number]["pick"],
    hit,
  });
  const matchOf = (picks: ReturnType<typeof result>[]) => ({ match: mk({ home: LOCAL, away: VISITOR, hg: 0, ag: 0, day: 1 }), picks });

  it("cuenta para cada equipo solo los picks de su historial, por nivel", () => {
    const records = summarizeByTeam([
      matchOf([result(1, "Local", "alta", true), result(1, "Local", "media", false), result(2, "Visitante", "alta", true)]),
      matchOf([result(1, "Local", "alta", false), result(1, "Local", "baja", true)]),
    ]);
    const local = records.find((r) => r.teamId === 1)!;
    expect(local.alta).toMatchObject({ hits: 1, total: 2 });
    expect(local.media).toMatchObject({ hits: 0, total: 1 });
    expect(local.top).toMatchObject({ hits: 1, total: 3 }); // la de fuerza baja no cuenta
    expect(records.find((r) => r.teamId === 2)!.alta).toMatchObject({ hits: 1, total: 1 });
  });

  it("ordena por acierto y deja al final a los que tienen pocos picks", () => {
    const many = (teamId: number, team: string, hits: number, total: number) =>
      matchOf(Array.from({ length: total }, (_, i) => result(teamId, team, "media", i < hits)));
    const records = summarizeByTeam([many(1, "A", 8, 10), many(2, "B", 9, 10), many(3, "C", 2, 2), many(4, "D", 7, 12)]);
    expect(rankTeams(records, "top").map((r) => r.team)).toEqual(["B", "A", "D", "C"]);
    expect(rankTeams(records, "alta").every((r) => r.alta.total === 0)).toBe(true);
  });
});

describe("duelo de córners (nuevo, aparte de los demás picks)", () => {
  /** Liga con duelos de córners variados: gana el local, el visitante o empatan. */
  function cornerLeague(n = 42): MatchResult[] {
    const corners = [
      [6, 4],
      [4, 6],
      [5, 5],
    ];
    return league(n).map((m, i) => ({
      ...m,
      home_stats: { ...STATS, corners: corners[i % 3][0] },
      away_stats: { ...STATS, corners: corners[i % 3][1] },
    }));
  }

  /** Partidos fuera del visitante con `[suyos, del rival]` córners. */
  const visitorCorners = (pairs: [number, number][]) =>
    pairs.map(([own, rival], i) =>
      mk({ home: other(i), away: VISITOR, hg: 1, ag: 1, day: 1 + i * 7, homeStats: { corners: rival }, awayStats: { corners: own } }),
    );
  const visitorDuels = (history: MatchResult[]) => cornerDuelPicks(THIS_MATCH, history).filter((p) => p.side === "away");
  const WINS: [number, number][] = [[7, 3], [6, 2], [8, 5], [5, 4], [9, 1], [6, 3]];

  it("detecta 'gana el duelo' y entonces sobra 'no pierde'", () => {
    const found = visitorDuels([...cornerLeague(), ...visitorCorners(WINS)]);
    expect(found.map((p) => p.text)).toEqual(["Gana el duelo de córners"]);
    expect(found[0].rate).toMatchObject({ hits: 6, total: 6 });
    // Liga: el visitante gana el duelo en 14 de 42 partidos, más los 6 suyos.
    expect(found[0].leagueRate).toBeCloseTo(20 / 48, 5);
  });

  it("'no pierde' sale cuando a veces empata", () => {
    const found = visitorDuels([...cornerLeague(), ...visitorCorners([[7, 3], [5, 5], [8, 5], [4, 4], [9, 1], [6, 6]])]);
    expect(found.map((p) => p.text)).toEqual(["No pierde el duelo de córners"]);
  });

  it("el empate solo aparece si es un patrón", () => {
    const always = visitorDuels([...cornerLeague(), ...visitorCorners([[5, 5], [4, 4], [6, 6], [3, 3], [5, 5], [7, 7]])]);
    expect(always.map((p) => p.text)).toContain("Empata el duelo de córners");
    const mixed = visitorDuels([...cornerLeague(), ...visitorCorners([[5, 5], [7, 4], [6, 6], [3, 5], [5, 5], [2, 7]])]);
    expect(mixed).toHaveLength(0);
  });

  it("se contrasta con el rival y tiene fuerza como el resto", () => {
    const localHome = [2, 3, 1, 4, 2, 3].map((own, i) =>
      mk({ home: LOCAL, away: other(60 + i), hg: 1, ag: 1, day: 2 + i * 7, homeStats: { corners: own }, awayStats: { corners: 6 } }),
    );
    const [pick] = visitorDuels([...cornerLeague(), ...visitorCorners(WINS), ...localHome]);
    expect(pick.rival).toMatchObject({ state: "backed", text: "Pierde el duelo de córners", rate: { hits: 6, total: 6 } });
    expect(pick.strength).toBe("alta");
  });

  it("no cambia los demás picks: va aparte, sin tope ni cifras", () => {
    const history = [...cornerLeague(), ...visitorCorners(WINS)];
    expect(probablePicks(THIS_MATCH, history).some((p) => p.family === "duelo-corners")).toBe(false);
    const played = { ...history[history.length - 1] };
    const [checked] = checkPlayedPicks([played], history);
    expect(checked.picks.some((r) => r.pick.family === "duelo-corners")).toBe(false);
    expect(checked.duel).not.toBeNull();
    expect(summarizePicks(checked.picks).total).toBe(checked.picks.filter((r) => r.hit !== null).length);
  });

  it("un partido sin córners no se puede decidir", () => {
    const [pick] = visitorDuels([...cornerLeague(), ...visitorCorners(WINS)]);
    const played = (home: number | null, away: number | null) =>
      ({ ...THIS_MATCH, status: "historical", home_goals: 1, away_goals: 1,
         home_stats: { ...STATS, corners: home }, away_stats: { ...STATS, corners: away } }) as MatchResult; // prettier-ignore
    expect(pickOutcome(pick, played(3, 6))).toBe(true);
    expect(pickOutcome(pick, played(6, 6))).toBe(false);
    expect(pickOutcome(pick, played(null, 6))).toBeNull();
  });
});
