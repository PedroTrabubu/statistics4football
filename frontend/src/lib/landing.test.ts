import { describe, expect, it } from "vitest";
import { LANDING_LEAGUES, STAT_CATEGORIES } from "./landing";
import { LEAGUE_ORDER, leagueName } from "./leagues";

describe("portada", () => {
  it("cada estadística apunta a un mercado que existe", () => {
    // Si se renombra un slug en markets.ts, la tarjeta desaparecería sin avisar.
    expect(STAT_CATEGORIES.map((c) => c.label)).toEqual([
      "Goles",
      "Goles por parte",
      "Resultado",
      "Descanso / Final",
      "Portería a cero",
      "Córners",
      "Tarjetas",
      "Puntos de tarjeta",
      "Tiros",
      "Tiros a puerta",
      "Faltas",
      "Árbitros",
    ]);
  });

  it("la galería sigue el orden de las ligas del resto de la web", () => {
    expect(LANDING_LEAGUES.map((l) => l.code)).toEqual(LEAGUE_ORDER);
  });

  it("las ligas de la galería tienen nombre propio en la web", () => {
    expect(LANDING_LEAGUES.map((l) => leagueName(l.code))).toEqual([
      "LaLiga",
      "LaLiga Hypermotion",
      "Premier League",
      "Ligue 1",
      "Champions League",
    ]);
  });
});
