// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import html from "./fixtures/winamax_history.html?raw";
import promosHtml from "./fixtures/winamax_promos.html?raw";
import refundedHtml from "./fixtures/winamax_refunded.html?raw";
import type { ParsedBet } from "./types";
import { inferSport, parseAmount, parseStatus, parseWinamaxHistory } from "./winamax";

let bets: ParsedBet[] = [];
let failed = 0;
let byId: Record<string, ParsedBet> = {};

beforeAll(() => {
  ({ bets, failed } = parseWinamaxHistory(html));
  byId = Object.fromEntries(bets.map((b) => [b.id, b]));
}, 60_000);

describe("parseWinamaxHistory", () => {
  it("lee todas las apuestas de la muestra", () => {
    expect(failed).toBe(0);
    expect(bets).toHaveLength(8);
    expect(bets.every((b) => b.warnings.length === 0)).toBe(true);
  });

  it("simple perdida con freebet", () => {
    const b = byId["1000000008"];
    expect(b).toMatchObject({
      type: "simple",
      status: "lost",
      stake: 1,
      freebet: true,
      returned: 0,
      odds: 4.7,
      sport: "Tenis",
      ref: "TEST0008",
      placedAt: "2026-10-06T14:09",
    });
    expect(b.legs[0]).toMatchObject({
      market: "1er set - 12º juego - Ganador",
      pick: "N. Djokovic",
      participants: ["Novak Djokovic", "Alex De Miñaur"],
      eventDate: "06/10",
      score: "7-6 0-1",
    });
  });

  it("simple ganada con dinero propio", () => {
    expect(byId["1000000007"]).toMatchObject({ status: "won", stake: 5, freebet: false, returned: 13, odds: 2.6 });
  });

  it("combinada de tenis con seguro aplicado", () => {
    const b = byId["1000000006"];
    expect(b).toMatchObject({ type: "combinada", legsCount: 2, sport: "Tenis", odds: 1.96, stake: 10, returned: 19.56 });
    expect(b.legs.map((l) => l.odds)).toEqual([1.27, 1.54]);
    expect(b.legs[1].insuranceApplied).toBe(true);
  });

  it("simple de fútbol: marcador de equipos", () => {
    const b = byId["1000000005"];
    expect(b).toMatchObject({ sport: "Fútbol", odds: 3.6, stake: 10, returned: 36 });
    expect(b.legs[0]).toMatchObject({ participants: ["Francia", "Bélgica"], score: "4-1", market: "Resultado", pick: "Francia" });
  });

  it("combinada de dos 'Crea tu apuesta' con el resultado de cada selección", () => {
    const b = byId["1000000003"];
    expect(b).toMatchObject({ type: "combinada", sport: "Fútbol", odds: 4.4, stake: 5, returned: 22 });
    expect(b.legs.every((l) => l.builder)).toBe(true);
    expect(b.legs[0].odds).toBe(2.2);
    expect(b.legs[0].selections).toEqual([
      { market: "Resultado", pick: "Francia", result: "won" },
      { market: "Número total córneres", pick: "Más de 7,5", result: "won" },
      { market: "Número total de tarjetas", pick: "Más de 1,5", result: "won" },
    ]);
    expect(b.legs[1].selections).toHaveLength(2);
  });

  it("anulada: usa la cuota vigente y guarda la tachada", () => {
    const b = byId["1000000002"];
    expect(b).toMatchObject({ status: "void", stake: 1, refund: 1, odds: 1 });
    expect(b.legs[0].originalOdds).toBe(5.9);
  });

  it("freebet ganada: 'Ganancias' es el beneficio neto", () => {
    expect(byId["1000000001"]).toMatchObject({ status: "won", freebet: true, stake: 1, returned: 4, odds: 5 });
  });

  it("no lee nada de un HTML sin historial", () => {
    expect(parseWinamaxHistory("<div><p>Hola</p></div>")).toEqual({ bets: [], failed: 0 });
  });
});

describe("apuesta cancelada por el usuario", () => {
  it("'Reembolsado - Has cancelado esta apuesta' es anulada y el importe es lo reembolsado", () => {
    const { bets: [b], failed: f } = parseWinamaxHistory(refundedHtml);
    expect(f).toBe(0);
    expect(b).toMatchObject({ status: "void", stake: 15, refund: 15, odds: 2.15, warnings: [], placedAt: "2026-09-20T18:23" });
    expect(b.legs[0]).toMatchObject({ builder: true, participants: ["Deportivo de A Coruña", "Real Betis"], score: "1-1" });
    expect(b.legs[0].selections.map((s) => s.pick)).toEqual(["Sí", "Real Betis o empate"]);
  });
});

describe("promociones", () => {
  it("detecta La Gran Supercuota, su resultado y la promoción del resumen", () => {
    const { bets: promoBets, failed: f } = parseWinamaxHistory(promosHtml);
    const by = Object.fromEntries(promoBets.map((b) => [b.id, b]));
    expect(f).toBe(0);
    expect(by["1000000010"]).toMatchObject({ status: "won", stake: 10, returned: 20, odds: 2, promotions: ["La Gran Supercuota"], sport: "Fútbol", warnings: [] });
    expect(by["1000000010"].legs[0]).toMatchObject({
      boosted: true,
      promoTitle: "La Gran Supercuota: Real Madrid - Rayo Vallecano",
      participants: ["Real Madrid", "Rayo Vallecano"],
      pick: "Real Madrid marca al menos 3 goles",
    });
    expect(by["1000000011"]).toMatchObject({ status: "lost", promotions: ["La Gran Supercuota"] });
    expect(by["1000000012"]).toMatchObject({ status: "won", promotions: ["Bang to the Moon"], stake: 2.5, returned: 5.25 });
    expect(by["1000000012"].legs[0].boosted).toBe(false);
  });

  it("las apuestas normales no tienen promociones; las misiones del resumen sí cuentan", () => {
    expect(byId["1000000007"].promotions).toEqual([]);
    expect(byId["1000000003"].promotions).toEqual(["Misión Fútbol"]);
  });
});

describe("helpers", () => {
  it("parseStatus mira el principio del texto", () => {
    expect(parseStatus("Reembolsado - Has cancelado esta apuesta")).toBe("void");
    expect(parseStatus("Ganada")).toBe("won");
    expect(parseStatus("Cash out")).toBe("cashout");
    expect(parseStatus("Ganadas")).toBeNull();
    expect(parseStatus("Simple")).toBeNull();
  });

  it("parseAmount entiende el formato español", () => {
    expect(parseAmount("1.234,56 €")).toBe(1234.56);
    expect(parseAmount("0,00 €")).toBe(0);
    expect(parseAmount("—")).toBeNull();
  });

  it("inferSport por el mercado", () => {
    expect(inferSport(["2º set - Ganador"], false, 4)).toBe("Tenis");
    expect(inferSport(["Número total córneres"], true, 2)).toBe("Fútbol");
    expect(inferSport(["Ganador"], false, 0)).toBe("Desconocido");
  });
});

describe("de la muestra al resumen", () => {
  it("cuadra el dinero de la muestra", async () => {
    const { settle, summarize } = await import("./analysis");
    const rows = bets.map(settle).filter((r) => r !== null);
    const s = summarize(bets, rows);
    expect(s).toMatchObject({ totalImported: 8, voids: 1, bets: 7, wins: 5, ownStaked: 30, ownProfit: 60.56, freebetProfit: 4, profit: 64.56 });
  });
});
