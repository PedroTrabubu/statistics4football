import { useSyncExternalStore } from "react";
import type { League } from "../api/types";
import { type Language, currentLanguage, i18n, t } from "../i18n";
import { ALL_PARAM } from "./routes";

/** LaLiga siempre primero; es la liga por defecto en español y la de reserva. */
export const DEFAULT_LEAGUE_CODE = "ESP-La Liga";

/** Liga por defecto de cada idioma de la web: la de su país. */
const LANGUAGE_LEAGUES: Record<Language, string> = {
  es: DEFAULT_LEAGUE_CODE,
  en: "ENG-Premier League",
  fr: "FRA-Ligue 1",
};

/** La liga que se ve mientras no se elige otra: la del idioma de la web. */
export function defaultLeagueCode(language: Language = currentLanguage()): string {
  return LANGUAGE_LEAGUES[language] ?? DEFAULT_LEAGUE_CODE;
}

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

/** Picks y Alta probabilidad solo se ofrecen en ligas validadas (`flag`: la
 * marca de cada uno). Si la liga elegida en otra pagina no lo esta, se ven
 * todas en vez de una pagina vacia. */
export function onlyValidated(
  leagues: League[] | null,
  code: string | null,
  flag: "validated" | "high_probability" = "validated",
): { leagues: League[] | null; code: string | null; pending: string | null } {
  if (!leagues) return { leagues: null, code, pending: null };
  const validated = leagues.filter((l) => l[flag]);
  const pending = orderLeagues(leagues.filter((l) => !l[flag])).map((l) => leagueName(l.code));
  return {
    leagues: validated,
    code: code === null || validated.some((l) => l.code === code) ? code : null,
    pending: pending.length ? t("common:league.pendingValidation", { leagues: pending.join(", ") }) : null,
  };
}

/** Identificador de cada liga en la URL (?league=). Una que no esté aquí
 * lleva su código en minúsculas y con guiones. */
const LEAGUE_SLUGS: Record<string, string> = {
  "ESP-La Liga": "laliga",
  "ESP-La Liga 2": "laliga-hypermotion",
  "ENG-Premier League": "premier-league",
  "FRA-Ligue 1": "ligue-1",
  "GER-Bundesliga": "bundesliga",
  "ITA-Serie A": "serie-a",
  [CHAMPIONS_LEAGUE_CODE]: "champions-league",
};

export function leagueSlug(code: string): string {
  return (
    LEAGUE_SLUGS[code] ??
    code
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
  );
}

/** ?league= de Partidos, Rachas, Picks probables y Clasificación: el slug de
 * la liga, o "all" para ver todas las ligas a la vez. */
export function leagueParam(league: Pick<League, "code"> | null): string {
  return league === null ? ALL_PARAM : leagueSlug(league.code);
}

/** Liga de un ?league=: su codigo, null para "all" y undefined si falta o
 * no es valido (la pagina sigue entonces con la liga elegida en la web). */
export function parseLeagueParam(value: string | null, leagues: League[]): string | null | undefined {
  if (value === null) return undefined;
  const clean = value.trim().toLowerCase();
  if (clean === ALL_PARAM) return null;
  return leagues.find((l) => leagueSlug(l.code) === clean)?.code;
}

// Liga elegida, compartida entre paginas mientras dura la sesion. Hasta que
// se elige una (o llega en un ?league=) es la del idioma, y cambia con el; la
// elegida se queda aunque cambie el idioma. Al recargar se vuelve a la del
// idioma. null = todas las ligas (solo donde se ofrece).
let chosenCode: string | null | undefined = undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

i18n.on("languageChanged", () => {
  if (chosenCode === undefined) notify();
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSelectedLeagueCode(): string | null {
  return chosenCode === undefined ? defaultLeagueCode() : chosenCode;
}

export function setSelectedLeagueCode(code: string | null): void {
  chosenCode = code;
  notify();
}

export function useSelectedLeagueCode(): [string | null, (code: string | null) => void] {
  const code = useSyncExternalStore(subscribe, getSelectedLeagueCode);
  return [code, setSelectedLeagueCode];
}
