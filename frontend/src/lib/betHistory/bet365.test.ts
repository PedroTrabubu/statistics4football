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
    expect(byDate["2026-06-14T21:05"].id).toMatch(/^b365-20260614210512-[0-9a-z]+$/);
  });

  it("crear apuesta perdida con aumento de ganancias", () => {
    const b = byDate["2026-06-14T21:05"];
    expect(b).toMatchObject({
      type: "simple",
      typeLabel: "Crear apuesta",
      status: "lost",
      stake: 15,
      returned: 0,
      odds: 2.05,
      freebet: false,
      sport: "Fútbol",
      promotions: ["Aumento de ganancias"],
      warnings: [],
    });
    expect(b.legs[0]).toMatchObject({ builder: true, market: "Crear apuesta", participants: ["Portugal", "Japón"] });
    expect(b.legs[0].selections).toEqual([
      { market: "Resultado final", pick: "Resultado final: Portugal", result: null },
      { market: "Comparación de córners", pick: "Mayor número de córners: Portugal", result: null },
      { market: "Córners", pick: "Más de 5 córners", result: null },
    ]);
  });

  it("sencilla: solo la selección, el deporte sale del nombre del equipo", () => {
    expect(byDate["2026-04-25T19:10"]).toMatchObject({
      typeLabel: "Sencillo",
      status: "lost",
      stake: 3.6,
      odds: 4,
      sport: "Fútbol",
    });
    expect(byDate["2026-04-25T19:10"].legs[0]).toMatchObject({ pick: "Real Sociedad", participants: [], market: "" });
    expect(byDate["2026-03-28T17:42"]).toMatchObject({ status: "won", stake: 6, returned: 12.6, odds: 2.1 });
  });

  it("superaumento: cuota aumentada y la original", () => {
    const b = byDate["2026-04-03T20:31"];
    expect(b).toMatchObject({ status: "won", stake: 6, returned: 15, odds: 2.5, promotions: ["Superaumento"] });
    expect(b.legs[0]).toMatchObject({ odds: 2.5, originalOdds: 1.72, boosted: true });
    expect(byDate["2026-03-08T12:03"]).toMatchObject({ status: "lost", odds: 4, promotions: ["Superaumento"] });
    expect(byDate["2026-02-22T19:37"]).toMatchObject({
      status: "won",
      odds: 10,
      returned: 15,
      promotions: ["Aumento de apuesta"],
    });
  });

  it("ganada con aumento de ganancias: cobra más de lo que pagaba la cuota", () => {
    expect(byDate["2026-03-21T18:20"]).toMatchObject({ status: "won", stake: 3, returned: 7.5, odds: 2.2 });
  });

  it("créditos de apuesta: cuentan como freebet y solo suma la ganancia neta", () => {
    const won = byDate["2026-03-15T21:12"];
    expect(won).toMatchObject({ status: "won", stake: 6, freebet: true, returned: 7.5 });
    expect(settle(won)).toMatchObject({ ownStake: 0, freebetStake: 6, profit: 7.5 });
    const lost = byDate["2026-03-08T16:55"];
    expect(lost).toMatchObject({ status: "lost", stake: 9, freebet: true, returned: 0 });
    expect(settle(lost)?.profit).toBe(0);
  });

  it("cobra justo el importe: anulada, y no cuenta", () => {
    const b = byDate["2026-01-11T13:00"];
    expect(b).toMatchObject({ status: "void", refund: 6 });
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
