import { useSyncExternalStore } from "react";
import type { League } from "../api/types";

/** LaLiga siempre primero y seleccionada por defecto. */
export const DEFAULT_LEAGUE_CODE = "ESP-La Liga";

/** `short`: el nombre en los botones de liga en movil, donde no cabe el entero. */
const DISPLAY: Record<string, { name: string; short: string; country: string }> = {
  "ESP-La Liga": { name: "LaLiga", short: "LaLiga", country: "España" },
  "ENG-Premier League": { name: "Premier League", short: "Premier", country: "Inglaterra" },
  "ESP-La Liga 2": { name: "LaLiga Hypermotion", short: "Hypermotion", country: "España" },
  "FRA-Ligue 1": { name: "Ligue 1", short: "Ligue 1", country: "Francia" },
};

export function leagueName(code: string): string {
  return DISPLAY[code]?.name ?? code;
}

export function leagueShortName(code: string): string {
  return DISPLAY[code]?.short ?? leagueName(code);
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

/** Picks y Recomendaciones solo se ofrecen en ligas validadas. Si la liga
 * elegida en otra pagina no lo esta, se ven todas en vez de una pagina vacia. */
export function onlyValidated(
  leagues: League[] | null,
  code: string | null,
): { leagues: League[] | null; code: string | null; pending: string | null } {
  if (!leagues) return { leagues: null, code, pending: null };
  const validated = leagues.filter((l) => l.validated);
  const pending = orderLeagues(leagues.filter((l) => !l.validated)).map((l) => leagueName(l.code));
  return {
    leagues: validated,
    code: code === null || validated.some((l) => l.code === code) ? code : null,
    pending: pending.length ? `Aún sin validar: ${pending.join(", ")}.` : null,
  };
}

/** ?liga= de /partidos: el id de la liga, el mismo que ya usa /stats?league=,
 * o "todas" para ver todas las ligas a la vez. */
export const ALL_LEAGUES_PARAM = "todas";

export function leagueParam(league: Pick<League, "id"> | null): string {
  return league === null ? ALL_LEAGUES_PARAM : String(league.id);
}

/** Liga de un ?liga=: su codigo, null para "todas" y undefined si falta o
 * no es valido (la pagina sigue entonces con la liga elegida en la web). */
export function parseLeagueParam(value: string | null, leagues: League[]): string | null | undefined {
  if (value === null) return undefined;
  const clean = value.trim().toLowerCase();
  if (clean === ALL_LEAGUES_PARAM) return null;
  return leagues.find((l) => String(l.id) === clean)?.code;
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
