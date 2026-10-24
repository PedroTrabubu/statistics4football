// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY, applyTheme, parsePreference, readPreference, resolveTheme } from "./theme";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("parsePreference", () => {
  it("solo acepta claro u oscuro; lo demás es el tema del sistema", () => {
    expect(parsePreference("light")).toBe("light");
    expect(parsePreference("dark")).toBe("dark");
    expect(parsePreference("system")).toBe("system");
    expect(parsePreference(null)).toBe("system");
    expect(parsePreference("azul")).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("Sistema sigue al sistema; Claro y Oscuro mandan sobre él", () => {
    expect(resolveTheme("system", "dark")).toBe("dark");
    expect(resolveTheme("system", "light")).toBe("light");
    expect(resolveTheme("light", "dark")).toBe("light");
    expect(resolveTheme("dark", "light")).toBe("dark");
  });
});

describe("readPreference", () => {
  it("lee la preferencia guardada", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(readPreference()).toBe("dark");
  });

  it("sin acceso al almacenamiento, el tema del sistema", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    expect(readPreference()).toBe("system");
  });
});

describe("applyTheme", () => {
  it("pone el tema en <html> y el color de la barra del navegador", () => {
    document.head.innerHTML = '<meta name="theme-color" content="#ffffff" />';
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#08090b");
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#ffffff");
  });
});
