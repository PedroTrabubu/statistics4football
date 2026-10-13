import { describe, expect, it } from "vitest";
import type { League } from "../api/types";
import { leagueParam, parseLeagueParam } from "./leagues";

const LEAGUES: League[] = [
  { id: 1, code: "ENG-Premier League", name: "ENG-Premier League", country: null, validated: true },
  { id: 2, code: "ESP-La Liga", name: "ESP-La Liga", country: null, validated: true },
];

describe("parseLeagueParam", () => {
  it("devuelve el código de la liga con ese id", () => {
    expect(parseLeagueParam("1", LEAGUES)).toBe("ENG-Premier League");
    expect(parseLeagueParam(" 2 ", LEAGUES)).toBe("ESP-La Liga");
  });

  it("'todas' (en cualquier caja) son todas las ligas", () => {
    expect(parseLeagueParam("todas", LEAGUES)).toBeNull();
    expect(parseLeagueParam("Todas", LEAGUES)).toBeNull();
  });

  it("sin parámetro, o con uno que no existe, no elige nada", () => {
    expect(parseLeagueParam(null, LEAGUES)).toBeUndefined();
    expect(parseLeagueParam("", LEAGUES)).toBeUndefined();
    expect(parseLeagueParam("99", LEAGUES)).toBeUndefined();
    expect(parseLeagueParam("laliga", LEAGUES)).toBeUndefined();
    expect(parseLeagueParam("1.0", LEAGUES)).toBeUndefined();
  });
});

describe("leagueParam", () => {
  it("es el id de la liga, o 'todas'", () => {
    expect(leagueParam(LEAGUES[1])).toBe("2");
    expect(leagueParam(null)).toBe("todas");
  });

  it("lo que escribe se lee igual", () => {
    for (const league of LEAGUES) expect(parseLeagueParam(leagueParam(league), LEAGUES)).toBe(league.code);
    expect(parseLeagueParam(leagueParam(null), LEAGUES)).toBeNull();
  });
});
