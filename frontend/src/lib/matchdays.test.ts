import { describe, expect, it } from "vitest";
import type { LeagueMatchdays, MatchdayInfo } from "../api/types";
import { nextPendingMatchday } from "./matchdays";

const NOW = Date.parse("2026-10-23T12:00:00Z");

function md(matchday: number, end: string, played: number, total = 10): MatchdayInfo {
  return { matchday, start: end, end, played, total };
}

function info(current: number | null, matchdays: MatchdayInfo[]): LeagueMatchdays {
  return { seasons: ["2627"], season: "2627", current, estimated: false, matchdays };
}

describe("nextPendingMatchday", () => {
  it("devuelve la primera jornada desde la actual con partidos por jugar", () => {
    const data = info(8, [md(7, "2026-10-12T18:00:00", 10), md(8, "2026-10-19T18:00:00", 10), md(9, "2026-10-26T18:00:00", 2)]);
    expect(nextPendingMatchday(data, NOW)).toBe(9);
  });

  it("salta una jornada con pendientes que ya tenían que haberse jugado", () => {
    const data = info(8, [md(8, "2026-10-19T18:00:00", 9), md(9, "2026-10-26T18:00:00", 0)]);
    expect(nextPendingMatchday(data, NOW)).toBe(9);
  });

  it("cuenta una jornada que acaba de terminar hace menos de 3 horas", () => {
    const data = info(9, [md(9, "2026-10-23T10:00:00", 9), md(10, "2026-10-30T18:00:00", 0)]);
    expect(nextPendingMatchday(data, NOW)).toBe(9);
  });

  it("sin jornadas pendientes, la de por defecto (o ninguna)", () => {
    expect(nextPendingMatchday(info(38, [md(38, "2026-05-24T18:00:00", 10)]), NOW)).toBe(38);
    expect(nextPendingMatchday(info(null, []), NOW)).toBeNull();
  });
});
