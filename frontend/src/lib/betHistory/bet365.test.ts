// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import { settle } from "./analysis";
import { looksLikeBet365, parseBet365History, parseDateTime } from "./bet365";
import html from "./fixtures/bet365_history.html?raw";
import winamaxHtml from "./fixtures/winamax_refunded.html?raw";
import type { ParsedBet } from "./types";

let bets: ParsedBet[] = [];
let failed = 0;
let byDate: Record<string, ParsedBet> = {};

beforeAll(() => {
  ({ bets, failed } = parseBet365History(html));
  byDate = Object.fromEntries(bets.map((b) => [b.placedAt, b]));
}, 60_000);

describe("parseBet365History", () => {
  it("lee las apuestas completas y descarta el último bloque, cortado", () => {
    expect(bets).toHaveLength(10);
    expect(failed).toBe(1);
    expect(bets.every((b) => b.bookmaker === "bet365" && b.ref === null)).toBe(true);
  });

  it("id estable a partir de la fecha con segundos y el contenido: importar dos veces no duplica", () => {
    const again = parseBet365History(html).bets.map((b) => b.id);
    expect(again).toEqual(bets.map((b) => b.id));
    expect(new Set(again).size).toBe(bets.length);
    expect(byDate["2026-05-08T22:28"].id).toMatch(/^b365-20260508222812-[0-9a-z]+$/);
  });

  it("crear apuesta perdida con aumento de ganancias", () => {
    const b = byDate["2026-05-08T22:28"];
    expect(b).toMatchObject({
      type: "simple",
      typeLabel: "Crear apuesta",
      status: "lost",
      stake: 30,
      returned: 0,
      odds: 2.05,
      freebet: false,
      sport: "Fútbol",
      promotions: ["Aumento de ganancias"],
      warnings: [],
    });
    expect(b.legs[0]).toMatchObject({ builder: true, market: "Crear apuesta", participants: ["Selección Norte", "Selección Sur"] });
    expect(b.legs[0].selections).toEqual([
      { market: "Resultado final", pick: "Resultado final: Selección Norte", result: null },
      { market: "Comparación de córners", pick: "Mayor número de córners: Selección Norte", result: null },
      { market: "Córners", pick: "Más de 5 córners", result: null },
    ]);
  });

  it("sencilla: solo la selección, el deporte sale del nombre del equipo", () => {
    expect(byDate["2026-03-19T20:33"]).toMatchObject({
      typeLabel: "Sencillo",
      status: "lost",
      stake: 7.2,
      odds: 4,
      sport: "Fútbol",
    });
    expect(byDate["2026-03-19T20:33"].legs[0]).toMatchObject({ pick: "Real Ejemplo", participants: [], market: "" });
    expect(byDate["2026-02-19T19:05"]).toMatchObject({ status: "won", stake: 12, returned: 25.2, odds: 2.1 });
  });

  it("superaumento: cuota aumentada y la original", () => {
    const b = byDate["2026-02-25T21:54"];
    expect(b).toMatchObject({ status: "won", stake: 12, returned: 30, odds: 2.5, promotions: ["Superaumento"] });
    expect(b.legs[0]).toMatchObject({ odds: 2.5, originalOdds: 1.72, boosted: true });
    expect(byDate["2026-01-30T13:26"]).toMatchObject({ status: "lost", odds: 4, promotions: ["Superaumento"] });
    expect(byDate["2026-01-16T21:00"]).toMatchObject({
      status: "won",
      odds: 10,
      returned: 30,
      promotions: ["Aumento de apuesta"],
    });
  });

  it("ganada con aumento de ganancias: cobra más de lo que pagaba la cuota", () => {
    expect(byDate["2026-02-12T19:43"]).toMatchObject({ status: "won", stake: 6, returned: 15, odds: 2.2 });
  });

  it("créditos de apuesta: cuentan como freebet y solo suma la ganancia neta", () => {
    const won = byDate["2026-02-06T22:35"];
    expect(won).toMatchObject({ status: "won", stake: 12, freebet: true, returned: 15 });
    expect(settle(won)).toMatchObject({ ownStake: 0, freebetStake: 12, profit: 15 });
    const lost = byDate["2026-01-30T18:18"];
    expect(lost).toMatchObject({ status: "lost", stake: 18, freebet: true, returned: 0 });
    expect(settle(lost)?.profit).toBe(0);
  });

  it("cobra justo el importe: anulada, y no cuenta", () => {
    const b = byDate["2025-12-05T14:23"];
    expect(b).toMatchObject({ status: "void", refund: 12 });
    expect(settle(b)).toBeNull();
  });
});

describe("utilidades", () => {
  it("fecha y hora de bet365", () => {
    expect(parseDateTime("14/06/2026 21:05:12")).toEqual({ placedAt: "2026-06-14T21:05", stamp: "20260614210512" });
    expect(parseDateTime("1/2/2026 9:05")).toEqual({ placedAt: "2026-02-01T09:05", stamp: "20260201090500" });
    expect(parseDateTime("ayer")).toBeNull();
  });

  it("distingue un historial de bet365 de uno de Winamax", () => {
    expect(looksLikeBet365(html)).toBe(true);
    expect(looksLikeBet365(winamaxHtml)).toBe(false);
  });
});
