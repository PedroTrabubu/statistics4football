import { useSyncExternalStore } from "react";
import type { League } from "../api/types";

/** LaLiga siempre primero y seleccionada por defecto. */
export const DEFAULT_LEAGUE_CODE = "ESP-La Liga";

const DISPLAY: Record<string, { name: string; country: string }> = {
  "ESP-La Liga": { name: "LaLiga", country: "España" },
  "ENG-Premier League": { name: "Premier League", country: "Inglaterra" },
};

export function leagueName(code: string): string {
  return DISPLAY[code]?.name ?? code;
}

export function leagueCountry(code: string): string | null {
  return DISPLAY[code]?.country ?? null;
}

/** LaLiga primero; el resto por nombre. */
export function orderLeagues(leagues: League[]): League[] {
  return [...leagues].sort(
    (a, b) =>
      Number(b.code === DEFAULT_LEAGUE_CODE) - Number(a.code === DEFAULT_LEAGUE_CODE) ||
      leagueName(a.code).localeCompare(leagueName(b.code), "es"),
  );
}

// Liga elegida, compartida entre paginas mientras dura la sesion (al
// recargar vuelve a LaLiga). null = todas las ligas (solo donde se ofrece).
let selectedCode: string | null = DEFAULT_LEAGUE_CODE;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSelectedLeagueCode(code: string | null): void {
  selectedCode = code;
  listeners.forEach((listener) => listener());
}

export function useSelectedLeagueCode(): [string | null, (code: string | null) => void] {
  const code = useSyncExternalStore(subscribe, () => selectedCode);
  return [code, setSelectedLeagueCode];
}
