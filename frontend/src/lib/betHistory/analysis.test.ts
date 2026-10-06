import { describe, expect, it } from "vitest";
import {
  betType,
  biggestLeaks,
  builderSelections,
  cumulativeProfit,
  groupBy,
  habits,
  marketFamily,
  oddsBucket,
  promotionGroups,
  settle,
  summarize,
  type SettledBet,
} from "./analysis";
import type { ParsedBet } from "./types";

function bet(overrides: Partial<ParsedBet>): ParsedBet {
  return {
    id: Math.random().toString(),
    bookmaker: "winamax",
    ref: null,
    placedAt: "2026-10-05T12:00",
    type: "simple",
    typeLabel: "Simple",
    legsCount: 1,
    sport: "Fútbol",
    status: "won",
    statusLabel: "Ganada",
    stake: 10,
    freebet: false,
    returned: null,
    refund: null,
    odds: 2,
    legs: [],
    promotions: [],
    warnings: [],
    ...overrides,
  };
}

const settled = (bs: ParsedBet[]) => bs.map(settle).filter((r): r is SettledBet => r !== null);

describe("settle", () => {
  it("dinero propio: beneficio = retorno - importe", () => {
    expect(settle(bet({ stake: 5, returned: 13, odds: 2.6 }))?.profit).toBe(8);
    expect(settle(bet({ status: "lost", stake: 5, returned: 0 }))?.profit).toBe(-5);
  });

  it("freebet: 'Ganancias' ya es beneficio y no cuenta como dinero propio", () => {
    const won = settle(bet({ freebet: true, stake: 1, returned: 4, odds: 5 }));
    expect(won).toMatchObject({ profit: 4, ownStake: 0, freebetStake: 1, hit: true });
    expect(settle(bet({ freebet: true, status: "lost", stake: 1, returned: 0 }))?.profit).toBe(0);
  });

  it("sin 'Ganancias' se calcula con la cuota", () => {
    expect(settle(bet({ stake: 10, returned: null, odds: 1.5 }))?.profit).toBe(5);
  });

  it("anuladas y pendientes quedan fuera; el cash out no cuenta para el acierto", () => {
    expect(settle(bet({ status: "void" }))).toBeNull();
    expect(settle(bet({ status: "pending" }))).toBeNull();
    expect(settle(bet({ status: "cashout", returned: 7 }))?.hit).toBeNull();
  });
});

describe("agrupaciones", () => {
  it("acierto real frente al que implica la cuota, y ROI sobre dinero propio", () => {
    const rows = settled([
      bet({ odds: 2, returned: 20 }),
      bet({ odds: 2, status: "lost", returned: 0 }),
      bet({ odds: 2, status: "lost", returned: 0 }),
      bet({ odds: 2, status: "lost", returned: 0 }),
    ]);
    const [g] = groupBy(rows, (r) => oddsBucket(r.bet.odds));
    expect(g).toMatchObject({ key: "2,00 – 2,99", bets: 4, wins: 1, hitRate: 0.25, impliedRate: 0.5, ownStaked: 40, profit: -20 });
    expect(g.roi).toBeCloseTo(-0.5);
  });

  it("tipos y tramos", () => {
    expect(betType(bet({ type: "combinada", legsCount: 3 }))).toBe("Combinada de 3");
    expect(betType(bet({ type: "combinada", legsCount: 7 }))).toBe("Combinada de 5 o más");
    expect(oddsBucket(1.25)).toBe("1,01 – 1,29");
    expect(oddsBucket(9)).toBe("8,00 o más");
    expect(oddsBucket(1)).toBeNull();
  });

  it("familias de mercado de Winamax", () => {
    expect(marketFamily("Número total córneres", "Más de 7,5")).toBe("Córners");
    expect(marketFamily("Expulsión", "Sí")).toBe("Tarjetas");
    expect(marketFamily("1er set - 12º juego - Ganador")).toBe("Juegos (tenis)");
    expect(marketFamily("2º set - Ganador")).toBe("Sets (tenis)");
    expect(marketFamily("Resultado", "Francia")).toBe("Resultado / ganador");
    expect(marketFamily("Ambos equipos marcan", "Sí")).toBe("Ambos marcan");
  });
});

describe("resumen y hábitos", () => {
  const bs = [
    bet({ placedAt: "2026-10-01T10:00", status: "lost", stake: 5, returned: 0 }),
    bet({ placedAt: "2026-10-02T10:00", status: "lost", stake: 10, returned: 0 }),
    bet({ placedAt: "2026-10-03T10:00", status: "won", stake: 20, returned: 40 }),
    bet({ placedAt: "2026-10-04T10:00", status: "won", stake: 5, returned: 10 }),
    bet({ placedAt: "2026-10-05T10:00", status: "void", stake: 5 }),
    bet({ placedAt: "2026-10-06T10:00", freebet: true, stake: 1, returned: 4, odds: 5 }),
  ];
  const rows = settled(bs);

  it("resumen separa dinero propio y freebets", () => {
    const s = summarize(bs, rows);
    expect(s).toMatchObject({ totalImported: 6, voids: 1, bets: 5, ownStaked: 40, ownProfit: 10, freebetProfit: 4, profit: 14 });
  });

  it("beneficio acumulado en orden cronológico", () => {
    expect(cumulativeProfit(rows).map((p) => p.profit)).toEqual([-5, -15, 5, 10, 14]);
  });

  it("rachas e importe tras perder", () => {
    const h = habits(rows);
    expect(h.longestLosingStreak).toBe(2);
    expect(h.longestWinningStreak).toBe(3);
    // Tras las dos derrotas se apostó 10 y 20: media 15. Tras ganar: 5 (la freebet no cuenta).
    expect(h.stakeAfterLoss).toBe(15);
    expect(h.stakeAfterWin).toBe(5);
  });

  it("mayores pérdidas por categoría", () => {
    const leaks = biggestLeaks({ tipo: [{ ...groupBy(rows, () => "Simple")[0], bets: 6, profit: -30 }] }, 5);
    expect(leaks[0].group.profit).toBe(-30);
    expect(biggestLeaks({ tipo: groupBy(rows, () => "Simple") }, 5)).toEqual([]);
  });

  it("selecciones de 'Crea tu apuesta'", () => {
    const b = bet({
      legs: [
        {
          eventDate: null,
          participants: [],
          score: null,
          sport: "Fútbol",
          builder: true,
          market: "Crea tu apuesta",
          pick: "",
          odds: 2,
          originalOdds: null,
          insuranceApplied: false,
          promoTitle: null,
          boosted: false,
          selections: [
            { market: "Número total córneres", pick: "Más de 7,5", result: "won" },
            { market: "Número total de tarjetas", pick: "Más de 1,5", result: "lost" },
          ],
        },
      ],
    });
    expect(builderSelections(settled([b]))).toEqual([
      { family: "Córners", selections: 1, won: 1, hitRate: 1 },
      { family: "Tarjetas", selections: 1, won: 0, hitRate: 0 },
    ]);
  });
});

describe("promociones", () => {
  it("cada promoción tiene su grupo y las apuestas sin promoción van al final", () => {
    const rows = settled([
      bet({ promotions: ["La Gran Supercuota"], returned: 20 }),
      bet({ promotions: ["La Gran Supercuota"], status: "lost", returned: 0 }),
      bet({ promotions: ["Supercuota", "Bang to the Moon"], returned: 20 }),
      bet({}),
    ]);
    const groups = promotionGroups(rows);
    expect(groups.map((g) => `${g.key}:${g.wins}/${g.decided}`)).toEqual([
      "La Gran Supercuota:1/2",
      "Supercuota:1/1",
      "Bang to the Moon:1/1",
      "Sin promoción:1/1",
    ]);
  });
});
