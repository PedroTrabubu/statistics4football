import type { CSSProperties } from "react";
import { type MarketGroup, findMarket } from "./markets";

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
  { code: "INT-Champions League", glow: "86, 132, 255" },
];

export interface StatCategory {
  to: string;
  label: string;
  group: MarketGroup;
  blurb: string;
}

const MARKET_BLURBS: [slug: string, blurb: string][] = [
  ["goles", "Más y menos goles del partido, del equipo o del rival."],
  ["goles-por-parte", "Goles de la primera y de la segunda parte por separado."],
  ["resultado", "Cuántas veces gana, empata o pierde cada equipo."],
  ["descanso-final", "El resultado al descanso cruzado con el final."],
  ["porteria-a-cero", "Partidos en los que el equipo no encajó ningún gol."],
  ["corners", "Córners del partido, de cada equipo y hándicap."],
  ["tarjetas", "Amarillas y rojas del partido y de cada equipo."],
  ["puntos-tarjeta", "Amarilla, 10 puntos; roja, 25: el total por partido."],
  ["tiros", "Tiros totales, a puerta o no, del partido y de cada equipo."],
  ["tiros-puerta", "Solo los tiros a puerta, del partido y de cada equipo."],
  ["faltas", "Faltas cometidas en el partido y por cada equipo."],
];

/** Estadisticas de la seccion "Qué puedes analizar": nombre, grupo y ruta
 * salen de markets.ts, asi que siempre apuntan a paginas que existen. */
export const STAT_CATEGORIES: StatCategory[] = [
  ...MARKET_BLURBS.flatMap(([slug, blurb]) => {
    const market = findMarket(slug);
    return market ? [{ to: `/mercados/${slug}`, label: market.label, group: market.group, blurb }] : [];
  }),
  {
    to: "/arbitros",
    label: "Árbitros",
    group: "Estadísticas",
    blurb: "Tarjetas, puntos de tarjeta, córners y goles según el árbitro.",
  },
];
