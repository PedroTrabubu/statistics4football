import { describe, expect, it } from "vitest";
import { matchesSearch } from "./teamSearch";

describe("matchesSearch", () => {
  it("ignora mayúsculas, acentos y signos", () => {
    expect(matchesSearch("Betis", "bEtIs")).toBe(true);
    expect(matchesSearch("Alaves", "Alavés")).toBe(true);
    expect(matchesSearch("Nott'm Forest", "nottm")).toBe(true);
  });

  it("encuentra los nombres abreviados por su nombre habitual", () => {
    expect(matchesSearch("Ath Madrid", "atlético")).toBe(true);
    expect(matchesSearch("Sociedad", "Real Sociedad")).toBe(true);
    expect(matchesSearch("Vallecano", "rayo")).toBe(true);
    expect(matchesSearch("Paris SG", "psg")).toBe(true);
    expect(matchesSearch("St Etienne", "saint etienne")).toBe(true);
  });

  it("vacío encaja con todo y lo que no coincide no encaja", () => {
    expect(matchesSearch("Getafe", "  ")).toBe(true);
    expect(matchesSearch("Getafe", "betis")).toBe(false);
  });
});
