import { describe, expect, it } from "vitest";
import type { League } from "../api/types";
import { STAT_CATEGORIES } from "./landing";
import { LEGACY_ROUTES, legacyNeedsLeagues, legacyTarget } from "./legacyRoutes";
import { MARKETS } from "./markets";
import {
  MARKET_URL_SLUGS,
  ROUTES,
  SPORTS,
  marketFromUrl,
  matchPath,
  refereePath,
  sportRoutes,
  statPath,
  withQuery,
} from "./routes";

const LEAGUES: League[] = [
  { id: 1, code: "ENG-Premier League", name: "ENG-Premier League", country: null, validated: true, high_probability: true },
  { id: 2, code: "ESP-La Liga", name: "ESP-La Liga", country: null, validated: true, high_probability: true },
];

/** Slug de URL: minúsculas, números y guiones, sin tildes. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe("rutas", () => {
  it("todo lo de fútbol cuelga de /football, con slugs en inglés", () => {
    const { home, football, ...pages } = ROUTES;
    expect(home).toBe("/");
    for (const path of Object.values(pages)) {
      expect(path.startsWith(`${football}/`)).toBe(true);
      expect(path.split("/").filter(Boolean).every((part) => SLUG.test(part))).toBe(true);
    }
  });

  it("cada mercado tiene un slug de URL propio, que se lee de vuelta", () => {
    const urls = MARKETS.map((m) => MARKET_URL_SLUGS.get(m.slug)!);
    expect(new Set(urls).size).toBe(MARKETS.length);
    for (const [i, market] of MARKETS.entries()) {
      expect(urls[i]).toMatch(SLUG);
      expect(marketFromUrl(urls[i])).toBe(market.slug);
    }
    expect(marketFromUrl("corners-equipo")).toBeUndefined();
    // /football/stats/referees es la página de árbitros, no un mercado.
    expect(urls).not.toContain("referees");
  });

  it("estadísticas en /<deporte>/stats/:stat, sección común a todos los deportes", () => {
    expect(ROUTES.stats).toBe("/football/stats");
    expect(ROUTES.referees).toBe("/football/stats/referees");
    expect(SPORTS.football.stat("corners")).toBe("/football/stats/corners");
    expect(sportRoutes("tennis").stat("aces")).toBe("/tennis/stats/aces");
    expect(sportRoutes("tennis").statPattern).toBe("/tennis/stats/:stat");
  });

  it("los slugs de los mercados van en inglés", () => {
    expect(statPath("tiros-puerta")).toBe(`${ROUTES.stats}/shots-on-target`);
    expect(statPath("corners-cada-equipo")).toBe(`${ROUTES.stats}/corners-each-team`);
    expect(statPath("tarjetas-rival")).toBe(`${ROUTES.stats}/cards-opponent`);
    expect(statPath("ambos-marcan")).toBe(`${ROUTES.stats}/both-teams-to-score`);
    expect(MARKET_URL_SLUGS.get("corners-handicap")).toBe("corners-handicap");
  });

  it("las tarjetas de la portada apuntan a rutas nuevas", () => {
    for (const category of STAT_CATEGORIES) expect(category.to.startsWith(`${ROUTES.football}/`)).toBe(true);
  });

  it("parámetros: sin los vacíos y con el valor codificado", () => {
    expect(matchPath(42)).toBe(`${ROUTES.matches}/42`);
    expect(withQuery(ROUTES.matches, { league: "laliga", season: null })).toBe(`${ROUTES.matches}?league=laliga`);
    expect(refereePath("Gil Manzano")).toBe(`${ROUTES.referees}?referee=Gil+Manzano`);
  });
});

describe("rutas antiguas", () => {
  const go = (url: string, leagues = LEAGUES) => {
    const { pathname, search, hash } = new URL(url, "http://x");
    return legacyTarget(pathname, search, hash, leagues);
  };

  it("cada una lleva a la nueva", () => {
    for (const [old, now] of Object.entries(LEGACY_ROUTES)) expect(go(old)).toBe(now);
    expect(go("/recommendations")).toBe(ROUTES.highProbability);
    expect(go("/glosario/")).toBe(ROUTES.glossary);
    expect(go("/matches/123#arbitro")).toBe(`${ROUTES.matches}/123#arbitro`);
    expect(go("/mercados/goles-equipo")).toBe(`${ROUTES.stats}/goals-team`);
    expect(go("/markets/corners")).toBe(`${ROUTES.stats}/corners`);
    expect(go("/markets/tiros-puerta")).toBe(`${ROUTES.stats}/shots-on-target`);
    expect(go("/football/markets/fouls")).toBe(`${ROUTES.stats}/fouls`);
    expect(go("/football/markets")).toBe(ROUTES.stats);
    expect(go("/football/referees?referee=Gil")).toBe(`${ROUTES.referees}?referee=Gil`);
  });

  it("traduce los parámetros y los ids de liga", () => {
    expect(go("/partidos?liga=2")).toBe(`${ROUTES.matches}?league=laliga`);
    expect(go("/partidos?liga=todas")).toBe(`${ROUTES.matches}?league=all`);
    expect(go("/stats?league=1")).toBe(`${ROUTES.standings}?league=premier-league`);
    expect(go("/rachas?liga=1&utm_source=x")).toBe(`${ROUTES.streaks}?league=premier-league&utm_source=x`);
    expect(go("/arbitros?arbitro=Gil%20Manzano")).toBe(`${ROUTES.referees}?referee=Gil+Manzano`);
    expect(go("/picks-probables?liga=2&temporada=todas&vista=equipos&jornada=7&fuerza=alta&dia=2026-10-24")).toBe(
      `${ROUTES.probablePicks}?league=laliga&season=all&view=teams&matchday=7&strength=high&day=2026-10-24`,
    );
  });

  it("lo que no se puede traducir con seguridad va a la ruta base", () => {
    expect(go("/partidos?liga=99")).toBe(ROUTES.matches);
    expect(go("/partidos?liga=2", [])).toBe(ROUTES.matches);
    expect(go("/picks-probables?vista=otra")).toBe(ROUTES.probablePicks);
    expect(go("/picks-probables?fuerza=maxima")).toBe(ROUTES.probablePicks);
    expect(go("/mercados/no-existe")).toBe(ROUTES.stats);
    expect(go("/markets/goals/extra")).toBe(ROUTES.stats);
    expect(go("/matches/abc")).toBe(ROUTES.matches);
  });

  it("solo espera a las ligas si hay un id que traducir", () => {
    expect(legacyNeedsLeagues("?liga=2")).toBe(true);
    expect(legacyNeedsLeagues("?league=2")).toBe(true);
    expect(legacyNeedsLeagues("?liga=todas")).toBe(false);
    expect(legacyNeedsLeagues("?vista=equipos")).toBe(false);
  });
});
