import { useSyncExternalStore } from "react";
import type { League } from "../api/types";
import { t } from "../i18n";

/** LaLiga siempre primero y seleccionada por defecto. */
export const DEFAULT_LEAGUE_CODE = "ESP-La Liga";

/** Equipos de ligas distintas, fase de liga y eliminatorias, y sin cuotas de
 * mercado (ver backend/app/ingestion/champions.py). */
export const CHAMPIONS_LEAGUE_CODE = "INT-Champions League";

/** `short`: el nombre en los botones de liga en movil, donde no cabe el entero.
 * Los nombres son propios y no se traducen, salvo los que tienen `key` (sus
 * textos en common:league.<key>); el pais es una clave de common:country. */
const DISPLAY: Record<string, { name: string; short: string; country: string; key?: string }> = {
  "ESP-La Liga": { name: "LaLiga", short: "LaLiga", country: "spain" },
  "ENG-Premier League": { name: "Premier League", short: "Premier", country: "england" },
  "ESP-La Liga 2": { name: "LaLiga Hypermotion", short: "Hypermotion", country: "spain" },
  "FRA-Ligue 1": { name: "Ligue 1", short: "Ligue 1", country: "france" },
  "GER-Bundesliga": { name: "Bundesliga", short: "Bundesliga", country: "germany" },
  "ITA-Serie A": { name: "Serie A", short: "Serie A", country: "italy" },
  "INT-Champions League": { name: "Champions League", short: "Champions", country: "europe", key: "championsLeague" },
  // De contexto: solo aparecen en el historial de los equipos de Champions.
  "POR-Primeira Liga": { name: "Primeira Liga", short: "Primeira", country: "portugal" },
  "NED-Eredivisie": { name: "Eredivisie", short: "Eredivisie", country: "netherlands" },
  "BEL-Pro League": { name: "Pro League", short: "Pro League", country: "belgium" },
  "TUR-Super Lig": { name: "Süper Lig", short: "Süper Lig", country: "turkey" },
  "GRE-Super League": { name: "Super League", short: "Super League", country: "greece" },
};

export function leagueName(code: string): string {
  const display = DISPLAY[code];
  if (!display) return code;
  return display.key ? t(`common:league.${display.key}.name`) : display.name;
}

export function leagueShortName(code: string): string {
  const display = DISPLAY[code];
  if (!display) return leagueName(code);
  return display.key ? t(`common:league.${display.key}.short`) : display.short;
}

export function leagueCountry(code: string): string | null {
  const country = DISPLAY[code]?.country;
  return country ? t(`common:country.${country}`) : null;
}

/** Orden de las ligas en toda la web. Una que no esté aquí va al final, por nombre. */
export const LEAGUE_ORDER = [
  "ESP-La Liga",
  "ESP-La Liga 2",
  "ENG-Premier League",
  "FRA-Ligue 1",
  "GER-Bundesliga",
  "ITA-Serie A",
  CHAMPIONS_LEAGUE_CODE,
];

function leagueRank(code: string): number {
  const i = LEAGUE_ORDER.indexOf(code);
  return i === -1 ? LEAGUE_ORDER.length : i;
}

export function orderLeagues(leagues: League[]): League[] {
  return [...leagues].sort(
    (a, b) => leagueRank(a.code) - leagueRank(b.code) || leagueName(a.code).localeCompare(leagueName(b.code), "es"),
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
    pending: pending.length ? t("common:league.pendingValidation", { leagues: pending.join(", ") }) : null,
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
