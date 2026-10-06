import { describe, expect, it } from "vitest";
import {
  INSIGHT_MIN_BETS,
  inPeriod,
  insights,
  monthKey,
  monthLabel,
  monthlySplit,
  monthlyStats,
  yearKey,
  yearlySplit,
  settle,
  stats,
  summarize,
  withoutPromotions,
  type SettledBet,
} from "./analysis";
import type { ParsedBet } from "./types";

// El navegador puede estar en cualquier zona horaria: el mes tiene que salir igual.
process.env.TZ = "Pacific/Auckland";

let seq = 0;
function bet(overrides: Partial<ParsedBet>): ParsedBet {
  seq += 1;
  return {
    id: String(seq),
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
    returned: 20,
    refund: null,
    odds: 2,
    legs: [],
    promotions: [],
    warnings: [],
    ...overrides,
  };
}

const settled = (bs: ParsedBet[]) => bs.map(settle).filter((r): r is SettledBet => r !== null);
const lost = (o: Partial<ParsedBet> = {}) => bet({ status: "lost", returned: 0, ...o });

describe("agrupación mensual (hora de Madrid tal como la muestra Winamax)", () => {
  it("el cambio de mes se decide por la fecha de la apuesta, sin convertir zonas", () => {
    expect(monthKey(bet({ placedAt: "2026-10-31T23:59" }))).toBe("2026-10");
    expect(monthKey(bet({ placedAt: "2026-11-01T00:30" }))).toBe("2026-11");
    // Madrugada del cambio de hora (25 de octubre de 2026, 02:30 no existe en UTC+2 → UTC+1).
    expect(monthKey(bet({ placedAt: "2026-10-25T02:30" }))).toBe("2026-10");
    expect(monthKey(bet({ placedAt: null }))).toBeNull();
  });

  it("agrupa y ordena cronológicamente", () => {
    const rows = settled([
      bet({ placedAt: "2026-11-01T00:30" }),
      bet({ placedAt: "2026-09-10T20:00" }),
      lost({ placedAt: "2026-10-31T23:59" }),
      bet({ placedAt: "2026-10-01T00:05" }),
      bet({ placedAt: "2026-10-15T00:05", status: "void" }), // anulada: no cuenta
    ]);
    const months = monthlyStats(rows);
    expect(months.map((m) => `${m.key}:${m.wins}/${m.decided}:${m.profit}`)).toEqual([
      "2026-09:1/1:10",
      "2026-10:1/2:0",
      "2026-11:1/1:10",
    ]);
  });

  it("etiquetas de mes en español; los años se dejan tal cual", () => {
    expect(monthLabel("2026-10")).toBe("octubre de 2026");
    expect(monthLabel("2026-01", "short")).toMatch(/ene/);
    expect(monthLabel("2026")).toBe("2026");
  });
});

describe("agrupación por año", () => {
  it("el cambio de año se decide por la fecha de la apuesta, y cada año suma sus meses", () => {
    const bs = [
      bet({ placedAt: "2025-12-31T23:59" }),
      lost({ placedAt: "2026-01-01T00:10" }),
      bet({ placedAt: "2026-10-05T12:00" }),
      bet({ placedAt: "2026-10-06T12:00", promotions: ["La Gran Supercuota"] }),
    ];
    expect(yearKey(bs[0])).toBe("2025");
    expect(yearKey(bs[1])).toBe("2026");
    const years = yearlySplit(settled(bs));
    expect(years.map((y) => `${y.key}:${y.total.bets}:${y.total.profit}`)).toEqual(["2025:1:10", "2026:3:10"]);
    const y2026 = years[1];
    expect(y2026.withPromo.profit + y2026.withoutPromo.profit).toBe(y2026.total.profit);
    const months2026 = monthlySplit(settled(bs)).filter((m) => m.key.startsWith("2026"));
    expect(months2026.reduce((sum, m) => sum + m.total.profit, 0)).toBe(y2026.total.profit);
  });

  it("inPeriod distingue mes y año", () => {
    const b = bet({ placedAt: "2026-11-01T00:30" });
    expect(inPeriod(b, "2026")).toBe(true);
    expect(inPeriod(b, "2026-11")).toBe(true);
    expect(inPeriod(b, "2026-10")).toBe(false);
  });
});

describe("sin promociones", () => {
  const bs = [
    bet({ promotions: ["La Gran Supercuota"], returned: 20 }),
    bet({ promotions: ["Supercuota", "Bang to the Moon"], returned: 40, odds: 4 }),
    bet({ returned: 20 }),
    lost(),
  ];

  it("quita cada apuesta con promoción una sola vez, aunque tenga dos", () => {
    const rest = withoutPromotions(bs);
    expect(rest).toHaveLength(2);
    const s = stats("rest", settled(rest));
    expect(s.profit).toBe(0); // +10 y -10
    // Restar los grupos de promoción del total restaría dos veces la apuesta con dos promociones.
    expect(stats("total", settled(bs)).profit - 10 - 30 - 30).not.toBe(s.profit);
  });

  it("las copias antiguas sin el campo promotions cuentan como sin promoción", () => {
    const old = { ...bet({}), promotions: undefined } as unknown as ParsedBet;
    expect(withoutPromotions([old])).toHaveLength(1);
  });
});

describe("bloque principal: las cifras cuadran", () => {
  it("resueltas = acertadas + falladas + cash out", () => {
    const bs = [bet({}), bet({}), lost(), bet({ status: "cashout", returned: 7 }), bet({ status: "void" }), bet({ status: "pending" })];
    const s = summarize(bs, settled(bs));
    expect({ bets: s.bets, wins: s.wins, losses: s.losses, cashouts: s.cashouts, decided: s.decided }).toEqual({
      bets: 4,
      wins: 2,
      losses: 1,
      cashouts: 1,
      decided: 3,
    });
    expect(s.wins + s.losses + s.cashouts).toBe(s.bets);
  });
});

describe("frases de resumen", () => {
  it("avisa si una promoción aporta más de la mitad del beneficio y da el resultado sin ella", () => {
    const bs = [
      ...Array.from({ length: 5 }, () => bet({ promotions: ["La Gran Supercuota"], returned: 20 })), // +50
      ...Array.from({ length: 6 }, () => lost()), // -60
      ...Array.from({ length: 2 }, () => bet({})), // +20
    ];
    const [first] = insights(settled(bs));
    expect(first).toContain("La Gran Supercuota aporta +50,00");
    expect(first).toContain("más que todo tu beneficio (+10,00");
    expect(first).toContain("Sin La Gran Supercuota, tu resultado sería -40,00");
  });

  it("no saca conclusiones con muestras pequeñas", () => {
    const bs = [
      ...Array.from({ length: 4 }, () => bet({ promotions: ["La Gran Supercuota"], returned: 20 })),
      bet({ sport: "Tenis" }),
    ];
    expect(insights(settled(bs))).toEqual([]);
  });

  it("mejor y peor deporte solo con suficientes apuestas en cada uno", () => {
    const bs = [
      ...Array.from({ length: INSIGHT_MIN_BETS }, () => bet({ sport: "Fútbol" })),
      ...Array.from({ length: INSIGHT_MIN_BETS }, () => lost({ sport: "Tenis" })),
      ...Array.from({ length: 3 }, () => bet({ sport: "Baloncesto", returned: 100 })),
    ];
    const [sentence] = insights(settled(bs));
    expect(sentence).toMatch(/^Por deporte, te va mejor en Fútbol .* y peor en Tenis/);
    expect(sentence).not.toContain("Baloncesto");
  });
});
