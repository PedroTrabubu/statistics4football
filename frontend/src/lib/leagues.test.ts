import { afterAll, describe, expect, it } from "vitest";
import type { League } from "../api/types";
import { changeLanguage } from "../i18n";
import {
  defaultLeagueCode,
  getSelectedLeagueCode,
  leagueParam,
  parseLeagueParam,
  setSelectedLeagueCode,
} from "./leagues";

const LEAGUES: League[] = [
  { id: 1, code: "ENG-Premier League", name: "ENG-Premier League", country: null, validated: true, high_probability: true },
  { id: 2, code: "ESP-La Liga", name: "ESP-La Liga", country: null, validated: true, high_probability: true },
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

describe("liga por defecto según el idioma", () => {
  afterAll(() => changeLanguage("es"));

  it("la del país de cada idioma", () => {
    expect(defaultLeagueCode("es")).toBe("ESP-La Liga");
    expect(defaultLeagueCode("en")).toBe("ENG-Premier League");
    expect(defaultLeagueCode("fr")).toBe("FRA-Ligue 1");
  });

  it("sigue al idioma hasta que se elige una; la elegida se queda", async () => {
    expect(getSelectedLeagueCode()).toBe("ESP-La Liga");
    await changeLanguage("en");
    expect(getSelectedLeagueCode()).toBe("ENG-Premier League");
    await changeLanguage("fr");
    expect(getSelectedLeagueCode()).toBe("FRA-Ligue 1");

    setSelectedLeagueCode("ITA-Serie A");
    await changeLanguage("en");
    expect(getSelectedLeagueCode()).toBe("ITA-Serie A");

    // "Todas" también es una elección.
    setSelectedLeagueCode(null);
    await changeLanguage("es");
    expect(getSelectedLeagueCode()).toBeNull();
  });
});
