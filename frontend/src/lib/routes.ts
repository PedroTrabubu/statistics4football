import { MARKETS } from "./markets";

/** Rutas de la web. La portada es "/" y cada deporte cuelga de su slug en
 * inglés (/football). Menú, enlaces y redirecciones salen de aquí, no de
 * cadenas sueltas (las antiguas, en legacyRoutes.ts). */

/** Secciones comunes a todos los deportes. */
export const SHARED_SECTIONS = { stats: "stats" } as const;

/** Base de un deporte y sus secciones comunes: /<deporte>/stats/:stat. */
export function sportRoutes(sport: string) {
  const base = `/${sport}`;
  const stats = `${base}/${SHARED_SECTIONS.stats}`;
  return { base, stats, statPattern: `${stats}/:stat`, stat: (slug: string) => `${stats}/${slug}` };
}

/** Registro por deporte. Hoy solo el fútbol; el tenis, al llegar, entra aquí
 * y hereda la sección de estadísticas (/tennis/stats/aces). */
export const SPORTS = {
  football: sportRoutes("football"),
} as const;

const FOOTBALL = SPORTS.football;

export const ROUTES = {
  home: "/",
  football: FOOTBALL.base,
  matches: `${FOOTBALL.base}/matches`,
  standings: `${FOOTBALL.base}/standings`,
  stats: FOOTBALL.stats,
  referees: FOOTBALL.stat("referees"),
  picks: `${FOOTBALL.base}/picks`,
  probablePicks: `${FOOTBALL.base}/probable-picks`,
  streaks: `${FOOTBALL.base}/streaks`,
  highProbability: `${FOOTBALL.base}/high-probability`,
  myBets: `${FOOTBALL.base}/my-bets`,
  glossary: `${FOOTBALL.base}/glossary`,
} as const;

/** Rutas con parámetro, para el router y para reconocerlas en una URL.
 * /football/stats/referees es una ruta propia: gana a :stat. */
export const ROUTE_PATTERNS = {
  match: `${ROUTES.matches}/:matchId`,
  stat: FOOTBALL.statPattern,
} as const;

/** Nombres de los parámetros de la URL. */
export const QUERY = {
  league: "league",
  season: "season",
  view: "view",
  matchday: "matchday",
  strength: "strength",
  day: "day",
  referee: "referee",
} as const;

/** ?league=all (todas las ligas) y ?season=all (todas las temporadas). */
export const ALL_PARAM = "all";

/** ?view= de Picks probables: vista interna -> valor en la URL. */
export const PROBABLE_PICKS_VIEW_PARAMS = {
  proxima: "next",
  jornadas: "played",
  resumen: "summary",
  equipos: "teams",
} as const;

/** ?strength= de Picks probables: fuerza interna -> valor en la URL. */
export const STRENGTH_PARAMS = { alta: "high", media: "medium", baja: "low" } as const;

/** La clave interna de un valor de la URL (undefined si no es ninguno). */
export function fromParam<K extends string>(params: Record<K, string>, value: string | null): K | undefined {
  return (Object.keys(params) as K[]).find((key) => params[key] === value);
}

/** Slug en inglés de cada mercado en la URL. El de markets.ts no cambia: lo
 * usan rachas, patrones y picks. Las variantes de una familia llevan el
 * sufijo traducido (corners-equipo -> corners-team). */
const MARKET_URL_BASES: Record<string, string> = {
  "ambos-marcan": "both-teams-to-score",
  "ambos-marcan-resultado": "both-teams-to-score-and-result",
  goles: "goals",
  "goles-por-parte": "goals-by-half",
  resultado: "result",
  "descanso-final": "half-time-full-time",
  "porteria-a-cero": "clean-sheet",
  corners: "corners",
  tarjetas: "cards",
  "puntos-tarjeta": "booking-points",
  expulsiones: "red-cards",
  tiros: "shots",
  "tiros-puerta": "shots-on-target",
  faltas: "fouls",
};
const MARKET_URL_SUFFIXES: [string, string][] = [
  ["-cada-equipo", "-each-team"],
  ["-equipo", "-team"],
  ["-rival", "-opponent"],
  ["-handicap", "-handicap"],
];

function toMarketUrlSlug(slug: string): string {
  if (MARKET_URL_BASES[slug]) return MARKET_URL_BASES[slug];
  for (const [suffix, english] of MARKET_URL_SUFFIXES) {
    const base = slug.endsWith(suffix) ? MARKET_URL_BASES[slug.slice(0, -suffix.length)] : undefined;
    if (base) return `${base}${english}`;
  }
  return slug;
}

/** Slug interno -> slug de la URL, de todos los mercados. */
export const MARKET_URL_SLUGS: ReadonlyMap<string, string> = new Map(MARKETS.map((m) => [m.slug, toMarketUrlSlug(m.slug)]));

/** Slug interno del mercado de un :stat de la URL. */
export function marketFromUrl(urlSlug: string | undefined): string | undefined {
  for (const [slug, url] of MARKET_URL_SLUGS) if (url === urlSlug) return slug;
  return undefined;
}

export const matchPath = (matchId: number | string) => `${ROUTES.matches}/${matchId}`;

/** /football/stats/<slug en inglés> de un mercado (slug interno). */
export const statPath = (slug: string) => FOOTBALL.stat(MARKET_URL_SLUGS.get(slug) ?? slug);

/** La ruta con sus parámetros; los null o vacíos no se ponen. */
export function withQuery(path: string, params: Partial<Record<string, string | null | undefined>>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

/** Árbitros, ya filtrado por uno (enlace desde la ficha de un partido). */
export const refereePath = (name: string) => withQuery(ROUTES.referees, { [QUERY.referee]: name });
