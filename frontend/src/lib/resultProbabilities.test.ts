import { describe, expect, it } from "vitest";
import { teamHitTable } from "./resultProbabilities";

const p = (match_id: number, home: number, draw: number, away: number, status = "ok") => ({
  match_id,
  status,
  p_home: home,
  p_draw: draw,
  p_away: away,
});
const m = (id: number, home_team: string, away_team: string, home_goals: number | null, away_goals: number | null) => ({
  id,
  home_team,
  away_team,
  home_goals,
  away_goals,
});

describe("teamHitTable", () => {
  it("cuenta el más probable y la mejor doble oportunidad para los dos equipos y la liga", () => {
    const { teams, league, always1x } = teamHitTable(
      [p(1, 0.6, 0.25, 0.15), p(2, 0.2, 0.3, 0.5), p(3, 0.5, 0.3, 0.2)],
      [
        m(1, "A", "B", 2, 0), // gana el local: acierta 1X2 (local) y 1X
        m(2, "A", "C", 1, 1), // empate: falla 1X2 (visitante), acierta X2
        m(3, "B", "C", 0, 1), // gana el visitante: falla 1X2 (local) y 1X
      ],
    );
    expect(league.top).toEqual({ hits: 1, n: 3 });
    expect(league.double).toEqual({ hits: 2, n: 3 });
    // Siempre 1X: acierta con el local y con el empate, no con el visitante.
    expect(always1x).toEqual({ hits: 2, n: 3 });
    const a = teams.find((t) => t.team === "A")!;
    expect(a.top).toEqual({ hits: 1, n: 2 });
    expect(a.double).toEqual({ hits: 2, n: 2 });
    expect(teams[0].team).toBe("A");
  });

  it("no cuenta partidos sin jugar, sin porcentajes o sin modelo", () => {
    const { teams, league } = teamHitTable(
      [p(1, 0.6, 0.25, 0.15), p(2, 0.4, 0.3, 0.3, "insufficient_history")],
      [m(1, "A", "B", null, null), m(2, "A", "B", 1, 0), m(3, "A", "B", 2, 2)],
    );
    expect(league.top.n).toBe(0);
    expect(teams).toEqual([]);
  });
});
