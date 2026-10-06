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
      { ...b("1", "won", "2026-10-01T10:00"), promotions: ["Supercuota"], legs: [] },
      { ...b("2", "lost", "2026-10-02T10:00"), promotions: [], legs: [] },
    ] as ParsedBet[];
    expect(parseBackup(exportBackup(bets))).toEqual({ bets, realMoney: null });
    const money = { deposited: 300, withdrawn: 50, balance: 120.5, updatedAt: "2026-10-07T10:00" };
    expect(parseBackup(exportBackup(bets, money)).realMoney).toEqual(money);
    expect(backupFileName(new Date(2026, 9, 7))).toBe("mis-apuestas-2026-10-07.json");
  });

  it("rechaza archivos que no son una copia", async () => {
    const { parseBackup } = await import("./storage");
    expect(() => parseBackup("<html></html>")).toThrow("no es JSON");
    expect(() => parseBackup('{"hola": 1}')).toThrow("no es una copia");
    expect(() => parseBackup('{"kind": "statistics4bets/mis-apuestas", "bets": []}')).toThrow("no contiene apuestas");
  });

  it("completa campos que faltan en copias antiguas", async () => {
    const { parseBackup } = await import("./storage");
    const {
      bets: [old],
      realMoney,
    } = parseBackup(JSON.stringify({ kind: "statistics4bets/mis-apuestas", bets: [{ id: "9", status: "won" }] }));
    expect(old).toMatchObject({ id: "9", promotions: [], warnings: [], legs: [] });
    expect(realMoney).toBeNull();
  });

  it("resultado real = retirado + saldo - ingresado", async () => {
    const { realResult } = await import("./storage");
    expect(realResult({ deposited: 300, withdrawn: 50, balance: 120.5, updatedAt: null })).toBe(-129.5);
    expect(realResult({ deposited: 300, withdrawn: null, balance: 120.5, updatedAt: null })).toBeNull();
  });
});
