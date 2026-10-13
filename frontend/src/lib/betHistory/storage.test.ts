import { describe, expect, it } from "vitest";
import { describeUpdate, mergeBets } from "./storage";
import type { ParsedBet } from "./types";

const b = (id: string, status: ParsedBet["status"], placedAt: string, warnings: string[] = []) =>
  ({ id, status, placedAt, warnings, stake: 10, returned: null, odds: 2 }) as unknown as ParsedBet;

describe("mergeBets", () => {
  it("separa nuevas, actualizadas y repetidas sin cambios", () => {
    const { bets, added, updated, unchanged } = mergeBets(
      [b("1", "pending", "2026-10-01T10:00"), b("2", "won", "2026-10-02T10:00")],
      [b("1", "lost", "2026-10-01T10:00"), b("2", "won", "2026-10-02T10:00"), b("3", "won", "2026-10-03T10:00")],
    );
    expect(added.map((x) => x.id)).toEqual(["3"]);
    expect(updated.map((u) => u.after.id)).toEqual(["1"]);
    expect(unchanged.map((x) => x.id)).toEqual(["2"]);
    expect(bets.map((x) => `${x.id}:${x.status}`)).toEqual(["3:won", "2:won", "1:lost"]);
  });

  it("la misma apuesta repetida dentro del mismo HTML cuenta una vez", () => {
    const { added, bets } = mergeBets([], [b("1", "won", "2026-10-01T10:00"), b("1", "won", "2026-10-01T10:00")]);
    expect(added).toHaveLength(1);
    expect(bets).toHaveLength(1);
  });
});

describe("describeUpdate", () => {
  it("explica qué ha cambiado", () => {
    expect(describeUpdate({ before: b("1", "pending", "x"), after: b("1", "won", "x") })).toBe("En curso → Ganada");
    expect(describeUpdate({ before: b("1", "void", "x", ["No se encontró el importe."]), after: b("1", "void", "x") })).toBe(
      "Ahora se lee completa",
    );
  });
});

describe("copia de seguridad", () => {
  it("se exporta y se vuelve a leer igual", async () => {
    const { exportBackup, parseBackup, backupFileName } = await import("./storage");
    const bets = [
      { ...b("1", "won", "2026-10-01T10:00"), bookmaker: "winamax", promotions: ["Supercuota"], legs: [] },
      { ...b("2", "lost", "2026-10-02T10:00"), bookmaker: "bet365", promotions: [], legs: [] },
    ] as ParsedBet[];
    expect(parseBackup(exportBackup(bets))).toEqual({ bets, realMoney: null });
    const y2026 = { opening: 12.6, deposited: 30, withdrawn: 0, closing: 7.25, updatedAt: "2026-03-01T10:00" };
    const y2025 = { opening: 0, deposited: 40, withdrawn: 0, closing: 12.6, updatedAt: "2026-03-01T10:00" };
    const empty = { opening: null, deposited: null, withdrawn: null, closing: null, updatedAt: null };
    // Cada casa y cada año con lo suyo; lo que no tiene datos no se guarda.
    expect(
      parseBackup(exportBackup(bets, { bet365: { "2026": y2026, "2025": y2025 }, winamax: { "2026": empty } })).realMoney,
    ).toEqual({ bet365: { "2026": y2026, "2025": y2025 } });
    expect(backupFileName(new Date(2026, 9, 7))).toBe("mis-apuestas-2026-10-07.json");
  });

  it("rechaza archivos que no son una copia", async () => {
    const { parseBackup } = await import("./storage");
    expect(() => parseBackup("<html></html>")).toThrow("no es JSON");
    expect(() => parseBackup('{"hola": 1}')).toThrow("no es una copia");
    expect(() => parseBackup('{"kind": "statistics4bets/mis-apuestas", "bets": []}')).toThrow("no contiene apuestas");
  });

  it("el dinero real de antes (un bloque sin año) pasa a «toda la cuenta» de Winamax", async () => {
    const { parseBackup, realResult, WHOLE_ACCOUNT } = await import("./storage");
    const money = { deposited: 150, withdrawn: 75, balance: 40.5, updatedAt: "2026-03-01T10:25" };
    const v2 = { kind: "statistics4bets/mis-apuestas", version: 2, bets: [b("1", "won", "x")], realMoney: money };
    const whole = parseBackup(JSON.stringify(v2)).realMoney?.winamax?.[WHOLE_ACCOUNT];
    expect(whole).toEqual({ opening: 0, deposited: 150, withdrawn: 75, closing: 40.5, updatedAt: "2026-03-01T10:25" });
    // El mismo resultado que daba antes: retirado + saldo - ingresado.
    expect(realResult(whole!)).toBe(-34.5);
  });

  it("completa campos que faltan en copias antiguas", async () => {
    const { parseBackup } = await import("./storage");
    const {
      bets: [old],
      realMoney,
    } = parseBackup(JSON.stringify({ kind: "statistics4bets/mis-apuestas", bets: [{ id: "9", status: "won" }] }));
    expect(old).toMatchObject({ id: "9", bookmaker: "winamax", promotions: [], warnings: [], legs: [] });
    expect(realMoney).toBeNull();
  });

  it("resultado real del año = saldo final - saldo inicial - ingresado + retirado", async () => {
    const { realResult } = await import("./storage");
    // Un extracto de ejemplo: 7,25 - 12,60 - 30 + 0.
    expect(realResult({ opening: 12.6, deposited: 30, withdrawn: 0, closing: 7.25, updatedAt: null })).toBe(-35.35);
    expect(realResult({ opening: 12.6, deposited: 30, withdrawn: null, closing: 7.25, updatedAt: null })).toBeNull();
  });
});
