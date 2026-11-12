import { describe, expect, it } from "vitest";
import { settle } from "./analysis";
import { EXAMPLE_SIZE, exampleBets } from "./example";

const NOW = new Date(2026, 10, 9, 12, 0);

describe("datos de ejemplo", () => {
  it("siempre las mismas apuestas, con ids únicos y hasta hoy", () => {
    const bets = exampleBets(NOW);
    expect(bets).toHaveLength(EXAMPLE_SIZE);
    expect(exampleBets(NOW)).toEqual(bets);
    expect(new Set(bets.map((b) => b.id)).size).toBe(bets.length);
    expect(bets.every((b) => b.placedAt !== null && b.placedAt <= "2026-11-09T12:00")).toBe(true);
  });

  it("casi todas resueltas, con Supercuota de importe fijo y sin avisos", () => {
    const bets = exampleBets(NOW);
    const settled = bets.map(settle).filter((r) => r !== null);
    expect(settled.length).toBeGreaterThan(EXAMPLE_SIZE * 0.9);
    const supercuota = bets.filter((b) => b.promotions.includes("Supercuota"));
    expect(supercuota.length).toBeGreaterThan(5);
    expect(supercuota.every((b) => b.stake === 10)).toBe(true);
    expect(bets.every((b) => b.warnings.length === 0)).toBe(true);
  });
});
