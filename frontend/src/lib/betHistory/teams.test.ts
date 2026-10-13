import { describe, expect, it } from "vitest";
import { settle, type SettledBet } from "./analysis";
import { teamGroups, teamKey } from "./teams";
import type { BetLeg, ParsedBet } from "./types";

let seq = 0;
function leg(overrides: Partial<BetLeg> = {}): BetLeg {
  return {
    eventDate: "12/09",
    participants: ["Real Madrid", "Rayo Vallecano"],
    score: "4-1",
    sport: "Fútbol",
    builder: false,
    market: "Resultado",
    pick: "Real Madrid",
    odds: 2,
    originalOdds: null,
    selections: [],
    insuranceApplied: false,
    promoTitle: null,
    boosted: false,
    ...overrides,
  };
}
function bet(overrides: Partial<ParsedBet> = {}): ParsedBet {
  seq += 1;
  return {
    id: String(seq),
    bookmaker: "winamax",
    ref: null,
    placedAt: "2026-09-12T20:00",
    type: "simple",
    typeLabel: "Simple",
    legsCount: 1,
    sport: "Fútbol",
    status: "won",
    statusLabel: "Ganada",
    stake: 10,
    freebet: false,
    returned: 20,
    refund: null,
    odds: 2,
    legs: [leg()],
    promotions: [],
    warnings: [],
    ...overrides,
  };
}
const settled = (bs: ParsedBet[]) => bs.map(settle).filter((r): r is SettledBet => r !== null);
const lost = (o: Partial<ParsedBet> = {}) => bet({ status: "lost", returned: 0, ...o });

describe("acierto por equipo y por tenista", () => {
  it("el mismo equipo escrito de formas distintas es uno", () => {
    expect(teamKey("Atlético de Madrid")).toBe(teamKey("Atlético Madrid"));
    expect(teamKey("FC Barcelona")).toBe(teamKey("Barcelona"));
    expect(teamKey("Sevilla FC")).toBe("sevilla");
    expect(teamKey("PSG")).toBe(teamKey("Paris Saint-Germain"));
  });

  it("cada apuesta de un partido cuenta para sus dos equipos; de más a menos acierto", () => {
    const groups = teamGroups(
      settled([
        bet(),
        bet(),
        lost(),
        bet({ legs: [leg({ participants: ["Rayo Vallecano", "Getafe"] })] }),
        lost({ legs: [leg({ participants: ["Rayo Vallecano", "Getafe"] })] }),
      ]),
    );
    const byName = Object.fromEntries(groups.map((g) => [g.name, g]));
    expect(byName["Real Madrid"]).toMatchObject({ sport: "Fútbol", bets: 3, wins: 2, profit: 10 });
    expect(byName["Rayo Vallecano"]).toMatchObject({ bets: 5, wins: 3 });
    expect(byName["Getafe"]).toBeUndefined(); // solo 2 apuestas
    expect(groups.map((g) => g.name)).toEqual(["Real Madrid", "Rayo Vallecano"]);
  });

  it("las combinadas de varios partidos no cuentan", () => {
    const combo = bet({ type: "combinada", legsCount: 2, legs: [leg(), leg({ participants: ["Getafe", "Elche"] })] });
    expect(teamGroups(settled([combo, combo, combo]))).toEqual([]);
  });

  it("tenistas aparte, y una apuesta guardada como «Desconocido» toma el deporte del jugador", () => {
    const tennis = (o: Partial<ParsedBet> = {}) =>
      bet({ sport: "Tenis", legs: [leg({ sport: "Tenis", participants: ["Carlos Alcaraz", "Jannik Sinner"] })], ...o });
    const unknown = bet({
      sport: "Desconocido",
      legs: [leg({ sport: "Desconocido", score: null, market: "", pick: "X", participants: ["Carlos Alcaraz", "Jannik Sinner"] })],
    });
    const groups = teamGroups(settled([tennis(), tennis({ status: "lost", returned: 0 }), unknown]));
    expect(groups.find((g) => g.name === "Carlos Alcaraz")).toMatchObject({ sport: "Tenis", bets: 3 });
  });

  it("sencillas sin partido (bet365): la selección cuenta si es un equipo conocido", () => {
    const single = (pick: string) => bet({ bookmaker: "bet365", legs: [leg({ participants: [], pick, market: "" })] });
    const isKnownTeam = (name: string) => name === "Real Madrid";
    const groups = teamGroups(settled([single("Real Madrid"), single("Real Madrid"), single("Real Madrid"), single("Empate")]), isKnownTeam);
    expect(groups.map((g) => [g.name, g.bets])).toEqual([["Real Madrid", 3]]);
  });

  it("deportes que no son fútbol ni tenis se quedan fuera", () => {
    const esports = () => bet({ sport: "eSports", legs: [leg({ sport: "eSports", participants: ["G2", "Fnatic"] })] });
    expect(teamGroups(settled([esports(), esports(), esports()]))).toEqual([]);
  });
});
