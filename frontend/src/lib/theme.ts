import { useCallback, useEffect, useState } from "react";

/** Tema de la web. La preferencia (Sistema / Claro / Oscuro) se guarda en este
 * navegador; el tema resuelto va en <html data-theme> y en la meta
 * theme-color. El script de index.html hace lo mismo antes del primer pintado
 * (mismas claves y colores): aquí se mantiene al día al cambiar la
 * preferencia o el tema del sistema. */
export type ThemePreference = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "s4b-theme";

/** Barra del navegador en el móvil: el lienzo de cada tema (tokens.css). */
export const THEME_COLORS: Record<Theme, string> = { light: "#ffffff", dark: "#08090b" };

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Si el navegador no deja guardar (modo privado, almacenamiento bloqueado),
 * la preferencia vale al menos mientras dure la página. */
let unsaved: ThemePreference | null = null;

export function parsePreference(value: string | null | undefined): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function readPreference(): ThemePreference {
  try {
    return parsePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return unsaved ?? "system";
  }
}

function savePreference(preference: ThemePreference) {
  unsaved = preference;
  try {
    if (preference === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Sin almacenamiento: queda en `unsaved`.
  }
}

export function systemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference, system: Theme): Theme {
  return preference === "system" ? system : preference;
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}

/** Preferencia, tema resuelto y cómo cambiarla. Sigue al sistema mientras la
 * preferencia es "system" y a otras pestañas abiertas de la web. */
export function useTheme() {
  const [preference, setPreferenceState] = useState(readPreference);
  const [system, setSystem] = useState(systemTheme);

  useEffect(() => {
    const query = window.matchMedia?.(DARK_QUERY);
    if (!query) return;
    const onChange = () => setSystem(query.matches ? "dark" : "light");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) setPreferenceState(parsePreference(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const theme = resolveTheme(preference, system);
  useEffect(() => applyTheme(theme), [theme]);

  const setPreference = useCallback((next: ThemePreference) => {
    savePreference(next);
    setPreferenceState(next);
  }, []);

  return { preference, theme, setPreference };
}
