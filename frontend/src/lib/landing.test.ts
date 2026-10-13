import { describe, expect, it } from "vitest";
import { LANDING_LEAGUES, STAT_CATEGORIES } from "./landing";
import { leagueName } from "./leagues";

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

  it("las ligas de la galería tienen nombre propio en la web", () => {
    expect(LANDING_LEAGUES.map((l) => leagueName(l.code))).toEqual([
      "LaLiga",
      "LaLiga Hypermotion",
      "Ligue 1",
      "Premier League",
    ]);
  });
});
