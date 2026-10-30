import type { League } from "../api/types";
import { leagueParam } from "./leagues";
import { findMarket } from "./markets";
import {
  ALL_PARAM,
  PROBABLE_PICKS_VIEW_PARAMS,
  QUERY,
  ROUTES,
  STRENGTH_PARAMS,
  marketFromUrl,
  matchPath,
  statPath,
} from "./routes";

/** Rutas antiguas (en español y sin /football, o de "markets") -> nuevas.
 * Los enlaces viejos siguen valiendo: redirigen aquí, con sus parámetros
 * traducidos. Ojo: /stats era la clasificación, no /football/stats. */
export const LEGACY_ROUTES: Record<string, string> = {
  "/partidos": ROUTES.matches,
  "/stats": ROUTES.standings,
  "/mercados": ROUTES.stats,
  "/markets": ROUTES.stats,
  "/football/markets": ROUTES.stats,
  "/arbitros": ROUTES.referees,
  "/football/referees": ROUTES.referees,
  "/picks": ROUTES.picks,
  "/picks-probables": ROUTES.probablePicks,
  "/rachas": ROUTES.streaks,
  "/alta-probabilidad": ROUTES.highProbability,
  // Antes de Alta probabilidad se llamaba Recomendaciones.
  "/recommendations": ROUTES.highProbability,
  "/mis-apuestas": ROUTES.myBets,
  "/glosario": ROUTES.glossary,
};

/** Un mercado de una ruta antigua: su slug interno (/mercados/goles-equipo)
 * o el de la URL (/markets/goals-team). */
const oldStat = (slug: string): string | null => {
  const market = marketFromUrl(slug) ?? (findMarket(slug) ? slug : undefined);
  return market ? statPath(market) : null;
};

/** Las antiguas con un segmento tras el prefijo: ruta base y cómo se traduce
 * el segmento (null: no se puede). */
const LEGACY_PREFIXES: [prefix: string, base: string, translate: (segment: string) => string | null][] = [
  ["/matches", ROUTES.matches, (id) => (/^\d+$/.test(id) ? matchPath(id) : null)],
  ["/mercados", ROUTES.stats, oldStat],
  ["/markets", ROUTES.stats, oldStat],
  ["/football/markets", ROUTES.stats, oldStat],
];

/** Para el router. */
export const LEGACY_PATTERNS = LEGACY_PREFIXES.map(([prefix]) => `${prefix}/:segment`);

const OLD_ALL = "todas";

/** Valor antiguo -> nuevo; null si no se puede traducir con seguridad. */
type Translate = (value: string, leagues: League[]) => string | null;

const same: Translate = (value) => value;

/** ?liga= (y ?league= de /stats) llevaban el id numérico de la liga. */
const oldLeague: Translate = (value, leagues) => {
  const clean = value.trim().toLowerCase();
  if (clean === OLD_ALL) return ALL_PARAM;
  const league = leagues.find((l) => String(l.id) === clean);
  return league ? leagueParam(league) : null;
};

const fromMap =
  (map: Record<string, string>): Translate =>
  (value) =>
    map[value] ?? null;

const LEGACY_PARAMS: Record<string, [name: string, translate: Translate]> = {
  liga: [QUERY.league, oldLeague],
  league: [QUERY.league, oldLeague],
  temporada: [QUERY.season, (value) => (value === OLD_ALL ? ALL_PARAM : value)],
  vista: [QUERY.view, fromMap(PROBABLE_PICKS_VIEW_PARAMS)],
  jornada: [QUERY.matchday, same],
  fuerza: [QUERY.strength, fromMap(STRENGTH_PARAMS)],
  dia: [QUERY.day, same],
  arbitro: [QUERY.referee, same],
};

/** Hace falta la lista de ligas para traducir un id numérico de ?liga=. */
export function legacyNeedsLeagues(search: string): boolean {
  const params = new URLSearchParams(search);
  return ["liga", "league"].some((key) => {
    const value = params.get(key);
    return value !== null && value.trim().toLowerCase() !== OLD_ALL;
  });
}

/** La URL nueva de una antigua. Si algo no se puede traducir con seguridad
 * (un mercado, una liga o una vista que no existen), la ruta base. Los
 * parámetros que no son de la web (utm...) se mantienen. */
export function legacyTarget(pathname: string, search: string, hash: string, leagues: League[]): string {
  const path = pathname.replace(/\/+$/, "");
  const prefixed = LEGACY_PREFIXES.find(([prefix]) => path.startsWith(`${prefix}/`));

  let base: string;
  let target: string | null;
  if (prefixed) {
    const [prefix, prefixBase, translate] = prefixed;
    const segment = path.slice(prefix.length + 1);
    base = prefixBase;
    target = segment.includes("/") ? null : translate(segment);
  } else {
    base = LEGACY_ROUTES[path] ?? ROUTES.home;
    target = base;
  }
  if (target === null) return base;

  const next = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(search)) {
    const rule = LEGACY_PARAMS[key];
    if (!rule) {
      next.append(key, value);
      continue;
    }
    const translated = rule[1](value, leagues);
    if (translated === null) return base;
    next.set(rule[0], translated);
  }
  const query = next.toString();
  return `${target}${query ? `?${query}` : ""}${hash}`;
}
