import type { CSSProperties } from "react";
import { t } from "../i18n";
import { type MarketGroup, findMarket } from "./markets";
import { ROUTES, statPath } from "./routes";

/** Una tarjeta de la galeria de ligas de la portada. Nombre y pais salen de
 * leagues.ts y el logo de src/assets/logos/leagues/, asi que para anadir una
 * liga (Serie A, Bundesliga...) basta con otra entrada aqui. */
export interface LandingLeague {
  code: string;
  /** Halo detras del logo, en "r, g, b". */
  glow: string;
  /** Ajuste del logo sobre el fondo oscuro (ej. invertir uno negro). */
  logoStyle?: CSSProperties;
}

/** Mismo orden que el resto de la web (LEAGUE_ORDER de leagues.ts). */
export const LANDING_LEAGUES: LandingLeague[] = [
  { code: "ESP-La Liga", glow: "255, 75, 68" },
  { code: "ESP-La Liga 2", glow: "0, 212, 214" },
  { code: "ENG-Premier League", glow: "176, 124, 255" },
  // El logo de Ligue 1 es negro: en blanco se lee sobre el fondo oscuro.
  { code: "FRA-Ligue 1", glow: "226, 232, 222", logoStyle: { filter: "invert(1)" } },
  { code: "GER-Bundesliga", glow: "255, 196, 0" },
  { code: "ITA-Serie A", glow: "0, 160, 90" },
  { code: "INT-Champions League", glow: "86, 132, 255" },
];

/** `label` y `blurb` salen del idioma actual al leerlos. */
export interface StatCategory {
  to: string;
  label: string;
  group: MarketGroup;
  blurb: string;
}

/** Mercado y clave de su resumen en landing:stats.blurb. */
const MARKET_BLURBS: [slug: string, blurbKey: string][] = [
  ["goles", "goals"],
  ["goles-por-parte", "goalsByHalf"],
  ["resultado", "result"],
  ["descanso-final", "htFt"],
  ["porteria-a-cero", "cleanSheet"],
  ["corners", "corners"],
  ["tarjetas", "cards"],
  ["puntos-tarjeta", "bookingPoints"],
  ["tiros", "shots"],
  ["tiros-puerta", "shotsOnTarget"],
  ["faltas", "fouls"],
];

/** Estadisticas de la seccion "Qué puedes analizar": nombre, grupo y ruta
 * salen de markets.ts, asi que siempre apuntan a paginas que existen. */
export const STAT_CATEGORIES: StatCategory[] = [
  ...MARKET_BLURBS.flatMap(([slug, blurbKey]): StatCategory[] => {
    const market = findMarket(slug);
    return market
      ? [
          {
            to: statPath(slug),
            get label() {
              return market.label;
            },
            group: market.group,
            get blurb() {
              return t(`landing:stats.blurb.${blurbKey}`);
            },
          },
        ]
      : [];
  }),
  {
    to: ROUTES.referees,
    get label() {
      return t("nav:referees");
    },
    group: "stats",
    get blurb() {
      return t("landing:stats.blurb.referees");
    },
  },
];
