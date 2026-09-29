import type { MatchResult, TeamMatchStats } from "../api/types";

/** Un partido visto desde uno de los dos equipos: todos los mercados se
 * evaluan desde esta perspectiva (el "gana" de un mercado es del equipo de
 * la tarjeta, no del local). */
export interface TeamMatchView {
  match: MatchResult;
  venue: "home" | "away";
  goalsFor: number;
  goalsAgainst: number;
  htFor: number | null;
  htAgainst: number | null;
  statsFor: TeamMatchStats | null;
  statsAgainst: TeamMatchStats | null;
}

export interface MarketOption {
  key: string;
  label: string;
  /** Texto del boton cuando la fila ya dice "Más de"/"Menos de" (ej. "2.5"). */
  short?: string;
  /** Fila de botones: over y under van en filas separadas. */
  row?: "over" | "under";
  /** null = no hay datos para decidirlo (ej. partido sin corners): no
   * cuenta ni como acierto ni como fallo. */
  hit: (v: TeamMatchView) => boolean | null;
}

export type MarketGroup = "Goles" | "Resultado" | "Estadísticas";

/** Cifra de cada fila, local - visitante, con las rojas de cada equipo
 * aparte para poder marcarlas. */
export interface DetailValue {
  home: string;
  away: string;
  homeRed?: number;
  awayRed?: number;
}

export interface MarketDef {
  slug: string;
  group: MarketGroup;
  /** Texto del enlace en el sidebar (para una familia, el de la familia). */
  label: string;
  title: string;
  description: string;
  options: MarketOption[];
  defaultOption: string;
  /** El resultado no depende de desde que equipo se mire (ambos marcan,
   * goles totales, corners del partido...): tiene sentido dar la media de
   * la liga por partido y usarlo en la pagina de arbitros. */
  matchLevel: boolean;
  /** Variantes de una misma estadistica (del partido, del equipo, del
   * rival, cada equipo...): una sola entrada en el sidebar y un selector en
   * la pagina. */
  family?: { key: string; label: string; variant: string };
  /** Cifra propia del mercado que se muestra en cada fila, junto al
   * marcador (ej. corners "7 - 5"). null si el partido no tiene ese dato. */
  detail?: { label: string; value: (m: MatchResult) => DetailValue | null };
  /** Media por partido que se muestra en la cabecera de cada tarjeta. */
  average?: { label: string; value: (v: TeamMatchView) => number | null };
  note?: string;
}

// --- Helpers -----------------------------------------------------------

type Value = (v: TeamMatchView) => number | null;

const btts = (v: TeamMatchView) => v.goalsFor > 0 && v.goalsAgainst > 0;
const wins = (v: TeamMatchView) => v.goalsFor > v.goalsAgainst;
const draws = (v: TeamMatchView) => v.goalsFor === v.goalsAgainst;
const loses = (v: TeamMatchView) => v.goalsFor < v.goalsAgainst;

const add = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b);
const gt = (value: number | null, line: number) => (value === null ? null : value > line);

function stat(stats: TeamMatchStats | null, key: keyof TeamMatchStats): number | null {
  return stats?.[key] ?? null;
}

/** Tarjetas = amarillas + rojas. */
export function cards(stats: TeamMatchStats | null): number | null {
  return add(stat(stats, "yellow_cards"), stat(stats, "red_cards"));
}

/** Puntos de tarjeta: amarilla 10, roja 25. Aproximado: el CSV no distingue
 * una roja directa de una segunda amarilla (que en las casas cuenta 10+25). */
export function bookingPoints(stats: TeamMatchStats | null): number | null {
  const yellow = stat(stats, "yellow_cards");
  const red = stat(stats, "red_cards");
  return yellow === null || red === null ? null : yellow * 10 + red * 25;
}

const htTotal = (v: TeamMatchView) => add(v.htFor, v.htAgainst);
const secondHalfFor = (v: TeamMatchView) => (v.htFor === null ? null : v.goalsFor - v.htFor);
const secondHalfAgainst = (v: TeamMatchView) => (v.htAgainst === null ? null : v.goalsAgainst - v.htAgainst);
const secondHalfTotal = (v: TeamMatchView) => add(secondHalfFor(v), secondHalfAgainst(v));

type Outcome = "G" | "E" | "P";
const outcome = (goalsFor: number, goalsAgainst: number): Outcome =>
  goalsFor > goalsAgainst ? "G" : goalsFor === goalsAgainst ? "E" : "P";
const OUTCOME_LABEL: Record<Outcome, string> = { G: "Gana", E: "Empata", P: "Pierde" };

/** Una fila de botones "Más de" y otra de "Menos de" con las mismas lineas. */
function overUnderOptions(hitOver: (line: number) => MarketOption["hit"], hitUnder: (line: number) => MarketOption["hit"], lines: number[]): MarketOption[] {
  return [
    ...lines.map((line) => ({
      key: `over-${line}`,
      label: `Más de ${line}`,
      short: String(line),
      row: "over" as const,
      hit: hitOver(line),
    })),
    ...lines.map((line) => ({
      key: `under-${line}`,
      label: `Menos de ${line}`,
      short: String(line),
      row: "under" as const,
      hit: hitUnder(line),
    })),
  ];
}

function valueOverUnder(value: Value, lines: number[]): MarketOption[] {
  return overUnderOptions(
    (line) => (v) => gt(value(v), line),
    (line) => (v) => {
      const x = value(v);
      return x === null ? null : x < line;
    },
    lines,
  );
}

/** "Cada equipo": los dos equipos por encima (over) o por debajo (under). */
function eachTeamOverUnder(forValue: Value, againstValue: Value, lines: number[]): MarketOption[] {
  const both = (test: (x: number) => boolean) => (v: TeamMatchView) => {
    const x = forValue(v);
    const y = againstValue(v);
    return x === null || y === null ? null : test(x) && test(y);
  };
  return overUnderOptions(
    (line) => both((x) => x > line),
    (line) => both((x) => x < line),
    lines,
  );
}

const statDetail =
  (pick: (stats: TeamMatchStats | null) => number | null, withReds = false) =>
  (m: MatchResult): DetailValue | null => {
    const home = pick(m.home_stats);
    const away = pick(m.away_stats);
    if (home === null || away === null) return null;
    return {
      home: String(home),
      away: String(away),
      ...(withReds
        ? { homeRed: stat(m.home_stats, "red_cards") ?? 0, awayRed: stat(m.away_stats, "red_cards") ?? 0 }
        : {}),
    };
  };

const HALF_TIME_DETAIL: MarketDef["detail"] = {
  label: "Descanso",
  value: (m) =>
    m.home_ht_goals === null || m.away_ht_goals === null
      ? null
      : { home: String(m.home_ht_goals), away: String(m.away_ht_goals) },
};

/** Una estadistica con sus variantes: del partido, del equipo, del rival,
 * cada equipo y (opcional) handicap. */
interface StatSpec {
  key: string;
  label: string;
  group: MarketGroup;
  /** En minusculas, para textos: "córners", "tarjetas"... */
  noun: string;
  forValue: Value;
  againstValue: Value;
  lines: { match: number[]; team: number[]; each: number[] };
  handicap?: number[];
  detail?: MarketDef["detail"];
  note?: string;
  /** Descripcion general; se completa con la de cada variante. */
  description: string;
}

function defaultLine(lines: number[]): string {
  return `over-${lines[Math.floor((lines.length - 1) / 2)]}`;
}

function statFamily(spec: StatSpec): MarketDef[] {
  const family = (variant: string) => ({ key: spec.key, label: spec.label, variant });
  const base = {
    group: spec.group,
    label: spec.label,
    detail: spec.detail,
    note: spec.note,
  };
  const matchValue: Value = (v) => add(spec.forValue(v), spec.againstValue(v));

  const markets: MarketDef[] = [
    {
      ...base,
      slug: spec.key,
      family: family("Total del partido"),
      title: `${spec.label} del partido`,
      description: `${spec.description} Total del partido: suma de los dos equipos.`,
      options: valueOverUnder(matchValue, spec.lines.match),
      defaultOption: defaultLine(spec.lines.match),
      matchLevel: true,
      average: { label: `${spec.noun} por partido`, value: matchValue },
    },
    {
      ...base,
      slug: `${spec.key}-equipo`,
      family: family("Del equipo"),
      title: `${spec.label} del equipo`,
      description: `${spec.description} Del equipo: solo los del equipo de cada tarjeta.`,
      options: valueOverUnder(spec.forValue, spec.lines.team),
      defaultOption: defaultLine(spec.lines.team),
      matchLevel: false,
      average: { label: `${spec.noun} a favor por partido`, value: spec.forValue },
    },
    {
      ...base,
      slug: `${spec.key}-rival`,
      family: family("Del rival"),
      title: `${spec.label} del rival`,
      description: `${spec.description} Del rival: los del equipo contrario en cada partido.`,
      options: valueOverUnder(spec.againstValue, spec.lines.team),
      defaultOption: defaultLine(spec.lines.team),
      matchLevel: false,
      average: { label: `${spec.noun} en contra por partido`, value: spec.againstValue },
    },
    {
      ...base,
      slug: `${spec.key}-cada-equipo`,
      family: family("Cada equipo"),
      title: `${spec.label}: cada equipo`,
      description: `${spec.description} Cada equipo: los dos equipos por encima de la línea (o, en «Menos de», los dos por debajo).`,
      options: eachTeamOverUnder(spec.forValue, spec.againstValue, spec.lines.each),
      defaultOption: defaultLine(spec.lines.each),
      matchLevel: true,
      average: { label: `${spec.noun} por partido`, value: matchValue },
    },
  ];

  if (spec.handicap) {
    markets.push({
      ...base,
      slug: `${spec.key}-handicap`,
      family: family("Hándicap"),
      title: `Hándicap de ${spec.noun}`,
      description: `${spec.description} Hándicap: se suma la línea a los del equipo y se compara con los del rival. «-1.5» = el equipo saca al menos 2 más que el rival; «+1.5» = el equipo no queda 2 o más por debajo del rival.`,
      options: spec.handicap.map((line) => ({
        key: `h${line}`,
        label: `${line > 0 ? "+" : ""}${line}`,
        hit: (v: TeamMatchView) => {
          const x = spec.forValue(v);
          const y = spec.againstValue(v);
          return x === null || y === null ? null : x + line > y;
        },
      })),
      defaultOption: `h${spec.handicap[Math.floor(spec.handicap.length / 2)]}`,
      matchLevel: false,
      average: {
        label: `${spec.noun} de diferencia por partido`,
        value: (v) => {
          const x = spec.forValue(v);
          const y = spec.againstValue(v);
          return x === null || y === null ? null : x - y;
        },
      },
    });
  }

  return markets;
}

const teamStatValue =
  (pick: (stats: TeamMatchStats | null) => number | null) =>
  (side: "for" | "against"): Value =>
  (v) =>
    pick(side === "for" ? v.statsFor : v.statsAgainst);

const cornersOf = teamStatValue((s) => stat(s, "corners"));
const cardsOf = teamStatValue(cards);
const pointsOf = teamStatValue(bookingPoints);
const shotsOf = teamStatValue((s) => stat(s, "shots"));
const onTargetOf = teamStatValue((s) => stat(s, "shots_on_target"));
const foulsOf = teamStatValue((s) => stat(s, "fouls"));

const range = (from: number, to: number, step = 1) =>
  Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);

// --- Mercados ------------------------------------------------------------

export const MARKETS: MarketDef[] = [
  {
    slug: "ambos-marcan",
    group: "Goles",
    label: "Ambos marcan",
    title: "Ambos equipos marcan",
    description: "Partidos en los que marcaron los dos equipos (o, con «No», en los que al menos uno se quedó sin marcar).",
    options: [
      { key: "si", label: "Sí", hit: btts },
      { key: "no", label: "No", hit: (v) => !btts(v) },
    ],
    defaultOption: "si",
    matchLevel: true,
  },
  {
    slug: "ambos-marcan-resultado",
    group: "Goles",
    label: "Ambos marcan y resultado",
    title: "Ambos marcan y resultado",
    description: "Partidos en los que marcaron los dos equipos y, además, el equipo ganó, empató o perdió.",
    options: [
      { key: "gana", label: "Y gana", hit: (v) => btts(v) && wins(v) },
      { key: "empata", label: "Y empata", hit: (v) => btts(v) && draws(v) },
      { key: "pierde", label: "Y pierde", hit: (v) => btts(v) && loses(v) },
    ],
    defaultOption: "gana",
    matchLevel: false,
  },
  ...statFamily({
    key: "goles",
    label: "Goles",
    group: "Goles",
    noun: "goles",
    forValue: (v) => v.goalsFor,
    againstValue: (v) => v.goalsAgainst,
    lines: { match: range(0.5, 6.5), team: range(0.5, 4.5), each: range(0.5, 2.5) },
    description: "Goles marcados.",
  }),
  {
    slug: "goles-por-parte",
    group: "Goles",
    label: "Goles por parte",
    title: "Goles por parte",
    description: "Goles de la primera y la segunda parte por separado. La columna extra es el marcador al descanso.",
    options: [
      { key: "gol-1p", label: "Gol en la 1ª parte", hit: (v) => gt(htTotal(v), 0.5) },
      { key: "over-1.5-1p", label: "Más de 1.5 en la 1ª", hit: (v) => gt(htTotal(v), 1.5) },
      { key: "gol-2p", label: "Gol en la 2ª parte", hit: (v) => gt(secondHalfTotal(v), 0.5) },
      { key: "over-1.5-2p", label: "Más de 1.5 en la 2ª", hit: (v) => gt(secondHalfTotal(v), 1.5) },
      {
        key: "mas-2p",
        label: "Más goles en la 2ª",
        hit: (v) => {
          const first = htTotal(v);
          const second = secondHalfTotal(v);
          return first === null || second === null ? null : second > first;
        },
      },
      {
        key: "marca-ambas",
        label: "El equipo marca en ambas partes",
        hit: (v) => {
          const second = secondHalfFor(v);
          return v.htFor === null || second === null ? null : v.htFor > 0 && second > 0;
        },
      },
    ],
    defaultOption: "gol-1p",
    matchLevel: false,
    detail: HALF_TIME_DETAIL,
  },
  {
    slug: "resultado",
    group: "Resultado",
    label: "Resultado",
    title: "Resultado",
    description: "Resultado final del partido desde el punto de vista del equipo.",
    options: [
      { key: "gana", label: "Gana", hit: wins },
      { key: "empata", label: "Empata", hit: draws },
      { key: "pierde", label: "Pierde", hit: loses },
      { key: "no-pierde", label: "Gana o empata", hit: (v) => !loses(v) },
    ],
    defaultOption: "gana",
    matchLevel: false,
  },
  {
    slug: "descanso-final",
    group: "Resultado",
    label: "Descanso / Final",
    title: "Descanso / Final",
    description:
      "Resultado al descanso y al final del partido desde el punto de vista del equipo. «Empata / Gana» = empataba al descanso y acabó ganando.",
    options: (["G", "E", "P"] as Outcome[]).flatMap((ht) =>
      (["G", "E", "P"] as Outcome[]).map((ft) => ({
        key: `${ht}${ft}`.toLowerCase(),
        label: `${OUTCOME_LABEL[ht]} / ${OUTCOME_LABEL[ft]}`,
        hit: (v: TeamMatchView) =>
          v.htFor === null || v.htAgainst === null
            ? null
            : outcome(v.htFor, v.htAgainst) === ht && outcome(v.goalsFor, v.goalsAgainst) === ft,
      })),
    ),
    defaultOption: "gg",
    matchLevel: false,
    detail: HALF_TIME_DETAIL,
  },
  {
    slug: "porteria-a-cero",
    group: "Resultado",
    label: "Portería a cero",
    title: "Portería a cero",
    description: "Partidos en los que el equipo no encajó ningún gol (o, con «No», en los que encajó al menos uno).",
    options: [
      { key: "si", label: "Sí", hit: (v) => v.goalsAgainst === 0 },
      { key: "no", label: "No", hit: (v) => v.goalsAgainst > 0 },
    ],
    defaultOption: "si",
    matchLevel: false,
  },
  ...statFamily({
    key: "corners",
    label: "Córners",
    group: "Estadísticas",
    noun: "córners",
    forValue: cornersOf("for"),
    againstValue: cornersOf("against"),
    lines: { match: range(6.5, 13.5), team: range(1.5, 8.5), each: range(1.5, 5.5) },
    handicap: [-3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5],
    detail: { label: "Córners", value: statDetail((s) => stat(s, "corners")) },
    description: "Córners lanzados.",
  }),
  ...statFamily({
    key: "tarjetas",
    label: "Tarjetas",
    group: "Estadísticas",
    noun: "tarjetas",
    forValue: cardsOf("for"),
    againstValue: cardsOf("against"),
    lines: { match: range(0.5, 9.5), team: range(0.5, 5.5), each: range(0.5, 3.5) },
    detail: { label: "Tarjetas", value: statDetail(cards, true) },
    description: "Tarjetas recibidas (amarillas + rojas); el cuadrado rojo junto a la cifra indica una expulsión.",
  }),
  ...statFamily({
    key: "puntos-tarjeta",
    label: "Puntos de tarjeta",
    group: "Estadísticas",
    noun: "puntos",
    forValue: pointsOf("for"),
    againstValue: pointsOf("against"),
    lines: { match: range(10.5, 90.5, 10), team: range(5.5, 55.5, 10), each: range(5.5, 35.5, 10) },
    detail: { label: "Puntos", value: statDetail(bookingPoints, true) },
    note: "Aproximado: la fuente no distingue una roja directa de una segunda amarilla, así que cada roja cuenta 25 y no 35.",
    description: "Puntos de tarjeta: amarilla = 10, roja = 25.",
  }),
  ...statFamily({
    key: "tiros",
    label: "Tiros",
    group: "Estadísticas",
    noun: "tiros",
    forValue: shotsOf("for"),
    againstValue: shotsOf("against"),
    lines: { match: range(16.5, 30.5, 2), team: range(6.5, 18.5, 2), each: range(6.5, 14.5, 2) },
    detail: { label: "Tiros", value: statDetail((s) => stat(s, "shots")) },
    description: "Tiros totales, a puerta o no.",
  }),
  ...statFamily({
    key: "tiros-puerta",
    label: "Tiros a puerta",
    group: "Estadísticas",
    noun: "tiros a puerta",
    forValue: onTargetOf("for"),
    againstValue: onTargetOf("against"),
    lines: { match: range(4.5, 12.5), team: range(1.5, 7.5), each: range(1.5, 5.5) },
    detail: { label: "Tiros a puerta", value: statDetail((s) => stat(s, "shots_on_target")) },
    description: "Tiros a puerta.",
  }),
  ...statFamily({
    key: "faltas",
    label: "Faltas",
    group: "Estadísticas",
    noun: "faltas",
    forValue: foulsOf("for"),
    againstValue: foulsOf("against"),
    lines: { match: range(18.5, 28.5, 2), team: range(8.5, 15.5), each: range(8.5, 13.5) },
    detail: { label: "Faltas", value: statDetail((s) => stat(s, "fouls")) },
    description: "Faltas cometidas.",
  }),
];

export const MARKET_GROUPS: MarketGroup[] = ["Goles", "Resultado", "Estadísticas"];

/** Una entrada por mercado suelto o por familia (su primera variante). */
export const SIDEBAR_MARKETS: MarketDef[] = MARKETS.filter(
  (m, i) => !m.family || MARKETS.findIndex((x) => x.family?.key === m.family!.key) === i,
);

export function familyVariants(market: MarketDef): MarketDef[] {
  return market.family ? MARKETS.filter((m) => m.family?.key === market.family!.key) : [market];
}

export function findMarket(slug: string | undefined): MarketDef | undefined {
  return MARKETS.find((m) => m.slug === slug);
}

// --- Agrupacion y porcentajes --------------------------------------------

export interface MatchGroup {
  key: string;
  name: string;
  /** Solo en grupos por equipo: su fila se resalta en negrita. */
  teamId: number | null;
  /** Mas recientes primero, igual que los devuelve la API. */
  home: TeamMatchView[];
  away: TeamMatchView[];
  all: TeamMatchView[];
}

export function viewFrom(match: MatchResult, venue: "home" | "away"): TeamMatchView | null {
  if (match.home_goals === null || match.away_goals === null) return null;
  const home = venue === "home";
  return {
    match,
    venue,
    goalsFor: home ? match.home_goals : match.away_goals,
    goalsAgainst: home ? match.away_goals : match.home_goals,
    htFor: home ? match.home_ht_goals : match.away_ht_goals,
    htAgainst: home ? match.away_ht_goals : match.home_ht_goals,
    statsFor: home ? match.home_stats : match.away_stats,
    statsAgainst: home ? match.away_stats : match.home_stats,
  };
}

/** Agrupa los partidos jugados de una temporada por equipo. */
export function groupByTeam(matches: MatchResult[]): MatchGroup[] {
  const byTeam = new Map<number, MatchGroup>();
  const entry = (id: number, name: string) => {
    let group = byTeam.get(id);
    if (!group) {
      group = { key: String(id), name, teamId: id, home: [], away: [], all: [] };
      byTeam.set(id, group);
    }
    return group;
  };

  for (const match of matches) {
    const home = viewFrom(match, "home");
    const away = viewFrom(match, "away");
    if (!home || !away) continue;

    const homeTeam = entry(match.home_team_id, match.home_team);
    homeTeam.home.push(home);
    homeTeam.all.push(home);

    const awayTeam = entry(match.away_team_id, match.away_team);
    awayTeam.away.push(away);
    awayTeam.all.push(away);
  }

  return [...byTeam.values()];
}

/** Agrupa por arbitro. Solo para mercados de partido (matchLevel), que dan
 * lo mismo mirados desde el local: cada partido entra una vez, visto desde
 * el local. */
export function groupByReferee(matches: MatchResult[]): MatchGroup[] {
  const byReferee = new Map<string, MatchGroup>();
  for (const match of matches) {
    if (!match.referee) continue;
    const view = viewFrom(match, "home");
    if (!view) continue;
    let group = byReferee.get(match.referee);
    if (!group) {
      group = { key: match.referee, name: match.referee, teamId: null, home: [], away: [], all: [] };
      byReferee.set(match.referee, group);
    }
    group.all.push(view);
  }
  return [...byReferee.values()];
}

export interface HitRate {
  hits: number;
  /** Partidos con datos para decidir el mercado. */
  total: number;
  /** Partidos sin datos (ej. sin corners): no cuentan en el porcentaje. */
  missing: number;
  /** null sin partidos con datos: no hay porcentaje, no un 0%. */
  pct: number | null;
}

export function hitRate(views: TeamMatchView[], option: Pick<MarketOption, "hit">): HitRate {
  let hits = 0;
  let decided = 0;
  for (const view of views) {
    const hit = option.hit(view);
    if (hit === null) continue;
    decided += 1;
    if (hit) hits += 1;
  }
  return { hits, total: decided, missing: views.length - decided, pct: decided > 0 ? hits / decided : null };
}

export function average(views: TeamMatchView[], value: (v: TeamMatchView) => number | null): number | null {
  const values = views.map(value).filter((x): x is number => x !== null);
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Aciertos seguidos contando desde el partido mas reciente (los partidos
 * sin datos se saltan, no cortan la racha). */
export function streak(views: TeamMatchView[], hit: (v: TeamMatchView) => boolean | null): number {
  let count = 0;
  for (const view of views) {
    const result = hit(view);
    if (result === null) continue;
    if (!result) break;
    count += 1;
  }
  return count;
}
