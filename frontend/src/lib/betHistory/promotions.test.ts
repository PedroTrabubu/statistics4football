import { describe, expect, it } from "vitest";
import { expectedLongestLosingStreak, insights, settle, sportOf, type SettledBet } from "./analysis";
import { excludingPromotions, fixedStakePromotions, promoEvidence, promoSplit, wilson } from "./promotions";
import type { BetLeg, ParsedBet } from "./types";

let seq = 0;
function leg(overrides: Partial<BetLeg> = {}): BetLeg {
  return {
    eventDate: "12/09",
    participants: ["Real Madrid", "Rayo Vallecano"],
    score: "4-1",
    sport: "Fútbol",
    builder: false,
    market: "Resultado",
    pick: "Real Madrid",
    odds: 2,
    originalOdds: null,
    selections: [],
    insuranceApplied: false,
    promoTitle: null,
    boosted: false,
    ...overrides,
  };
}
function bet(overrides: Partial<ParsedBet> = {}): ParsedBet {
  seq += 1;
  return {
    id: String(seq),
    bookmaker: "winamax",
    ref: null,
    placedAt: "2026-09-12T20:00",
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
    legs: [leg()],
    promotions: [],
    warnings: [],
    ...overrides,
  };
}
const settled = (bs: ParsedBet[]) => bs.map(settle).filter((r): r is SettledBet => r !== null);
const lost = (o: Partial<ParsedBet> = {}) => bet({ status: "lost", returned: 0, ...o });

describe("desglose con / sin promoción", () => {
  it("con + sin = total, y una apuesta con dos promociones cuenta una vez", () => {
    const rows = settled([
      bet({ promotions: ["La Gran Supercuota"] }),
      bet({ promotions: ["Supercuota", "Bang to the Moon"] }),
      lost(),
      bet(),
    ]);
    const s = promoSplit(rows);
    expect(s.withPromo.bets + s.withoutPromo.bets).toBe(s.total.bets);
    expect(s.withPromo.profit + s.withoutPromo.profit).toBeCloseTo(s.total.profit);
    expect(s.withPromo.ownStaked + s.withoutPromo.ownStaked).toBeCloseTo(s.total.ownStaked);
    expect(s.withPromo.bets).toBe(2);
  });
});

describe("promociones de importe fijo", () => {
  it("se detectan porque todas sus apuestas tienen el mismo importe", () => {
    const rows = settled([
      ...Array.from({ length: 3 }, () => bet({ promotions: ["La Gran Supercuota"], stake: 10 })),
      bet({ promotions: ["Bang to the Moon"], stake: 5 }),
      bet({ promotions: ["Bang to the Moon"], stake: 2.5 }),
      bet({ promotions: ["Bang to the Moon"], stake: 10 }),
    ]);
    expect(fixedStakePromotions(rows)).toEqual(["La Gran Supercuota"]);
    expect(excludingPromotions(rows, ["La Gran Supercuota"])).toHaveLength(3);
  });
});

describe("evidencia de una promoción", () => {
  it("Wilson 95 %", () => {
    const [lo, hi] = wilson(7, 10) as [number, number];
    expect(lo).toBeCloseTo(0.3968, 3);
    expect(hi).toBeCloseTo(0.8922, 3);
    expect(wilson(0, 0)).toBeNull();
  });

  it("con pocas apuestas no hay evidencia aunque el acierto sea alto", () => {
    const rows = settled([
      ...Array.from({ length: 4 }, () => bet({ promotions: ["La Gran Supercuota"] })),
      lost({ promotions: ["La Gran Supercuota"] }),
    ]);
    const e = promoEvidence(rows, "La Gran Supercuota");
    expect(e).toMatchObject({ bets: 5, wins: 4, hitRate: 0.8, breakEven: 0.5, supported: false });
  });

  it("con muchas apuestas acertadas, el límite inferior supera el acierto necesario", () => {
    const rows = settled([
      ...Array.from({ length: 40 }, () => bet({ promotions: ["La Gran Supercuota"] })),
      ...Array.from({ length: 10 }, () => lost({ promotions: ["La Gran Supercuota"] })),
    ]);
    expect(promoEvidence(rows, "La Gran Supercuota")?.supported).toBe(true);
  });
});

describe("deporte re-deducido", () => {
  it("una apuesta guardada como Desconocido se deduce por el equipo o la selección", () => {
    expect(sportOf(bet({ sport: "Desconocido", legs: [leg({ sport: "Desconocido", score: null, market: "", pick: "Real Madrid marca al menos 3 goles" })] }))).toBe("Fútbol");
    expect(sportOf(bet({ sport: "Desconocido", legs: [leg({ sport: "Desconocido", score: null, market: "Ganador", pick: "N. Djokovic", participants: ["Novak Djokovic", "Alex De Miñaur"] })] }))).toBe("Tenis");
    expect(sportOf(bet({ sport: "Desconocido", legs: [leg({ sport: "Desconocido", score: null, market: "Ganador", pick: "Equipo X", participants: ["Equipo X", "Equipo Y"] })] }))).toBe("Desconocido");
  });
});

describe("rachas y resumen", () => {
  it("racha de fallos esperable por azar", () => {
    expect(expectedLongestLosingStreak(300, 0.33)).toBe(11);
    expect(expectedLongestLosingStreak(5, 0.33)).toBeNull();
  });

  it("menciona con números la diferencia grande entre con y sin promoción", () => {
    const rows = settled([
      ...Array.from({ length: 5 }, () => bet({ promotions: ["La Gran Supercuota"] })),
      ...Array.from({ length: 6 }, () => lost()),
      ...Array.from({ length: 4 }, () => bet()),
    ]);
    const [first] = insights(rows);
    expect(first).toMatch(/^Con promoción llevas \+50,00\s€ \(ROI \+100%\) en 5 apuestas; sin promoción, -20,00\s€ \(ROI -20%\) en 10\.$/);
  });
});
