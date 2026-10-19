import { describe, expect, it } from "vitest";
import type { MatchResult, TeamMatchStats, UpcomingMatch } from "../api/types";
import { activeStreaks, matchesChip, selectStreaks, studyEvents, summarizeStudy } from "./streaks";

// --- Liga de prueba ---------------------------------------------------------
// Diez equipos de relleno con resultados y córners variados (la frecuencia de
// la liga) y el "Líder", que gana 2-0 sus 8 últimos partidos sacando 9 córners.

const LEADER = { id: 1, name: "Líder" };
const RIVAL = { id: 2, name: "Rival" };
const FILLERS = Array.from({ length: 10 }, (_, i) => ({ id: 10 + i, name: `Relleno ${i}` }));

let nextId = 1;
function mk(
  home: { id: number; name: string },
  away: { id: number; name: string },
  hg: number,
  ag: number,
  daysAgo: number,
  homeStats: Partial<TeamMatchStats>,
  awayStats: Partial<TeamMatchStats>,
  referee: string | null = null,
): MatchResult {
  const base: TeamMatchStats = { corners: 4, yellow_cards: 2, red_cards: 0, fouls: 11, shots: 11, shots_on_target: 4 };
  return {
    id: nextId++,
    date: new Date(Date.UTC(2026, 9, 10, 18) - daysAgo * 86_400_000).toISOString().slice(0, 19),
    status: "historical",
    league_id: 2,
    league_code: "ESP-La Liga",
    season: "2627",
    home_team_id: home.id,
    away_team_id: away.id,
    home_team: home.name,
    away_team: away.name,
    home_goals: hg,
    away_goals: ag,
    home_ht_goals: Math.min(hg, 1),
    away_ht_goals: 0,
    referee,
    matchday: null,
    matchday_estimated: false,
    home_stats: { ...base, ...homeStats },
    away_stats: { ...base, ...awayStats },
  };
}

const played: MatchResult[] = [
  ...Array.from({ length: 60 }, (_, i) =>
    mk(FILLERS[i % 10], FILLERS[(i + 3) % 10], i % 3, (i + 1) % 3, 20 + i, { corners: 3 + (i % 6) }, { corners: 2 + (i % 5) }),
  ),
  ...Array.from({ length: 8 }, (_, i) =>
    i % 2 === 0
      ? mk(LEADER, FILLERS[i], 2, 0, 1 + i * 2, { corners: 9, yellow_cards: 3 }, { corners: 4, yellow_cards: 3 }, "R Uno")
      : mk(FILLERS[i], LEADER, 0, 2, 1 + i * 2, { corners: 4, yellow_cards: 3 }, { corners: 9, yellow_cards: 3 }, "R Uno"),
  ),
];

function upcoming(referee: string | null): UpcomingMatch {
  return {
    id: 999,
    date: "2026-10-17T19:00:00",
    status: "scheduled",
    league_id: 2,
    league_code: "ESP-La Liga",
    season: "2627",
    home_team_id: LEADER.id,
    away_team_id: RIVAL.id,
    home_team: LEADER.name,
    away_team: RIVAL.name,
    home_goals: null,
    away_goals: null,
    home_ht_goals: null,
    away_ht_goals: null,
    referee,
    matchday: null,
    matchday_estimated: false,
    odds: [
      { market: "1x2", selection: "home", line: null, odds: 1.5 },
      { market: "1x2", selection: "draw", line: null, odds: 4.2 },
      { market: "1x2", selection: "away", line: null, odds: 6.5 },
    ],
    odds_taken_at: "2026-10-13T10:00:00",
    odds_source: "Football-Data.co.uk",
  };
}

const rows = activeStreaks("ESP-La Liga", played, [upcoming("R Uno")]);
const leader = rows.filter((r) => r.entityKey === `t${LEADER.id}`);

describe("rachas activas", () => {
  it("una por equipo y mercado, con la línea más exigente que se cumple en toda la racha", () => {
    const corners = selectStreaks(leader.filter((r) => matchesChip(r, "Córners"))).rows;
    const own = corners.filter((r) => r.type.market.slug === "corners-equipo");
    expect(own).toHaveLength(1);
    expect(own[0].type.option.key).toBe("over-8.5");
    expect(own[0].text).toBe("Líder ha sacado más de 8,5 córners en cada uno de sus últimos 8 partidos de liga");
  });

  it("descarta lo que pasa casi siempre (frecuencia ^ longitud por encima del umbral)", () => {
    expect(leader.some((r) => r.type.market.slug === "goles" && r.type.option.key === "under-6.5")).toBe(false);
    expect(leader.every((r) => r.chance <= 0.05)).toBe(true);
  });

  it("cuota media solo para el mercado exacto (gana en 1X2); el resto sin cuota", () => {
    const wins = leader.find((r) => r.type.market.slug === "resultado" && r.type.option.key === "gana" && r.context === "all");
    expect(wins?.text).toBe("Líder ha ganado sus últimos 8 partidos de liga");
    expect(wins?.odds?.odds).toBe(1.5);
    expect(leader.filter((r) => r.type.category === "Córners").every((r) => r.odds === null)).toBe(true);
  });

  it("como mucho tres por equipo y día, las más raras primero", () => {
    const { rows: shown } = selectStreaks(leader);
    expect(shown.length).toBeLessThanOrEqual(3);
    expect(shown.map((r) => r.chance)).toEqual([...shown.map((r) => r.chance)].sort((a, b) => a - b));
  });

  it("las del árbitro, solo con el árbitro designado", () => {
    expect(rows.some((r) => r.kind === "referee" && r.entity === "R Uno")).toBe(true);
    const withoutReferee = activeStreaks("ESP-La Liga", played, [upcoming(null)]);
    expect(withoutReferee.some((r) => r.kind === "referee")).toBe(false);
  });
});

describe("¿se prolongan?", () => {
  it("con semilla fija, el mismo resultado siempre", () => {
    const events = studyEvents(played);
    expect(events.length).toBeGreaterThan(0);
    expect(summarizeStudy(events)).toEqual(summarizeStudy(events));
  });
});
