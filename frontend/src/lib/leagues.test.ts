import { afterAll, describe, expect, it } from "vitest";
import type { League } from "../api/types";
import { changeLanguage } from "../i18n";
import {
  LEAGUE_ORDER,
  defaultLeagueCode,
  getSelectedLeagueCode,
  leagueParam,
  leagueSlug,
  parseLeagueParam,
  setSelectedLeagueCode,
} from "./leagues";
import { ALL_PARAM } from "./routes";

const LEAGUES: League[] = [
  { id: 1, code: "ENG-Premier League", name: "ENG-Premier League", country: null, validated: true, high_probability: true },
  { id: 2, code: "ESP-La Liga", name: "ESP-La Liga", country: null, validated: true, high_probability: true },
];

describe("parseLeagueParam", () => {
  it("devuelve el código de la liga con ese slug", () => {
    expect(parseLeagueParam("premier-league", LEAGUES)).toBe("ENG-Premier League");
    expect(parseLeagueParam(" LaLiga ", LEAGUES)).toBe("ESP-La Liga");
  });

  it("'all' (en cualquier caja) son todas las ligas", () => {
    expect(parseLeagueParam(ALL_PARAM, LEAGUES)).toBeNull();
    expect(parseLeagueParam("All", LEAGUES)).toBeNull();
  });

  it("sin parámetro, o con uno que no existe, no elige nada (la página sigue con la de por defecto)", () => {
    expect(parseLeagueParam(null, LEAGUES)).toBeUndefined();
    expect(parseLeagueParam("", LEAGUES)).toBeUndefined();
    expect(parseLeagueParam("serie-a", LEAGUES)).toBeUndefined();
    expect(parseLeagueParam("2", LEAGUES)).toBeUndefined();
    expect(parseLeagueParam("todas", LEAGUES)).toBeUndefined();
  });
});

describe("leagueParam", () => {
  it("es el slug legible de la liga, o 'all'", () => {
    expect(leagueParam(LEAGUES[1])).toBe("laliga");
    expect(leagueParam(null)).toBe(ALL_PARAM);
  });

  it("las ligas públicas tienen su slug; otra, su código en minúsculas y con guiones", () => {
    expect(LEAGUE_ORDER.map(leagueSlug)).toEqual([
      "laliga",
      "laliga-hypermotion",
      "premier-league",
      "ligue-1",
      "bundesliga",
      "serie-a",
      "champions-league",
    ]);
    expect(leagueSlug("TUR-Super Lig")).toBe("tur-super-lig");
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
