import type { MatchResult, TeamMatchStats } from "../api/types";
import { t } from "../i18n";
import { formatLine } from "./format";

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

export type MarketGroup = "goals" | "result" | "stats";

export function marketGroupLabel(group: MarketGroup): string {
  return t(`markets:group.${group}`);
}

/** Cifra de cada fila, local - visitante, con las rojas de cada equipo
 * aparte para poder marcarlas. */
export interface DetailValue {
  home: string;
  away: string;
  homeRed?: number;
  awayRed?: number;
}

/** Los textos (label, title, description, note...) son getters: salen del
 * idioma actual cada vez que se leen. */
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
  detail?: { label: string; inlineLabel: string; value: (m: MatchResult) => DetailValue | null };
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
const OUTCOME_KEY: Record<Outcome, string> = { G: "win", E: "draw", P: "lose" };

/** Una fila de botones "Más de" y otra de "Menos de" con las mismas lineas. */
function overUnderOptions(hitOver: (line: number) => MarketOption["hit"], hitUnder: (line: number) => MarketOption["hit"], lines: number[]): MarketOption[] {
  return [
    ...lines.map((line) => ({
      key: `over-${line}`,
      get label() {
        return t("markets:option.over", { line: formatLine(line) });
      },
      get short() {
        return formatLine(line);
      },
      row: "over" as const,
      hit: hitOver(line),
    })),
    ...lines.map((line) => ({
      key: `under-${line}`,
      get label() {
        return t("markets:option.under", { line: formatLine(line) });
      },
      get short() {
        return formatLine(line);
      },
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
  get label() {
    return t("markets:halfTime");
  },
  /** En mitad de una frase ("La columna de la derecha es: descanso"). */
  get inlineLabel() {
    return t("markets:halfTimeInline");
  },
  value: (m) =>
    m.home_ht_goals === null || m.away_ht_goals === null
      ? null
      : { home: String(m.home_ht_goals), away: String(m.away_ht_goals) },
};

/** Una estadistica con sus variantes: del partido, del equipo, del rival,
 * cada equipo y (opcional) handicap. Sus textos, en markets:stat.<textKey>. */
interface StatSpec {
  key: string;
  textKey: string;
  group: MarketGroup;
  forValue: Value;
  againstValue: Value;
  lines: { match: number[]; team: number[]; each: number[] };
  handicap?: number[];
  /** Cifra de cada fila (su rotulo es markets:stat.<textKey>.detail). */
  detail?: NonNullable<MarketDef["detail"]>["value"];
  /** Tiene nota (markets:stat.<textKey>.note). */
  note?: boolean;
}

function defaultLine(lines: number[]): string {
  return `over-${lines[Math.floor((lines.length - 1) / 2)]}`;
}

type Variant = "match" | "team" | "rival" | "each" | "handicap";

function statFamily(spec: StatSpec): MarketDef[] {
  const key = (path: string) => `markets:stat.${spec.textKey}.${path}`;
  const detail = spec.detail;
  /** Textos comunes de una variante: el de la familia y los suyos. */
  const variantTexts = (variant: Variant, averageKey: string) => ({
    get label() {
      return t(key("label"));
    },
    family: {
      key: spec.key,
      get label() {
        return t(key("label"));
      },
      get variant() {
        return t(`markets:variant.${variant}.label`);
      },
    },
    get title() {
      return t(key(`title.${variant}`));
    },
    get description() {
      return t(`markets:variant.${variant}.description`, { base: t(key("description")) });
    },
    detail: detail
      ? {
          get label() {
            return t(key("detail"));
          },
          get inlineLabel() {
            return t(key("detailInline"));
          },
          value: detail,
        }
      : undefined,
    get note() {
      return spec.note ? t(key("note")) : undefined;
    },
    averageLabel: () => t(key(`average.${averageKey}`)),
  });
  const matchValue: Value = (v) => add(spec.forValue(v), spec.againstValue(v));

  const make = (
    variant: Variant,
    averageKey: string,
    rest: Omit<MarketDef, "label" | "title" | "description" | "family" | "detail" | "note" | "group" | "average"> & {
      average: Value;
    },
  ): MarketDef => {
    const texts = variantTexts(variant, averageKey);
    const market: MarketDef = {
      ...rest,
      group: spec.group,
      family: texts.family,
      detail: texts.detail,
      average: {
        get label() {
          return texts.averageLabel();
        },
        value: rest.average,
      },
      get label() {
        return texts.label;
      },
      get title() {
        return texts.title;
      },
      get description() {
        return texts.description;
      },
      get note() {
        return texts.note;
      },
    };
    return market;
  };

  const markets: MarketDef[] = [
    make("match", "match", {
      slug: spec.key,
      options: valueOverUnder(matchValue, spec.lines.match),
      defaultOption: defaultLine(spec.lines.match),
      matchLevel: true,
      average: matchValue,
    }),
    make("team", "team", {
      slug: `${spec.key}-equipo`,
      options: valueOverUnder(spec.forValue, spec.lines.team),
      defaultOption: defaultLine(spec.lines.team),
      matchLevel: false,
      average: spec.forValue,
    }),
    make("rival", "rival", {
      slug: `${spec.key}-rival`,
      options: valueOverUnder(spec.againstValue, spec.lines.team),
      defaultOption: defaultLine(spec.lines.team),
      matchLevel: false,
      average: spec.againstValue,
    }),
    make("each", "match", {
      slug: `${spec.key}-cada-equipo`,
      options: eachTeamOverUnder(spec.forValue, spec.againstValue, spec.lines.each),
      defaultOption: defaultLine(spec.lines.each),
      matchLevel: true,
      average: matchValue,
    }),
  ];

  if (spec.handicap) {
    markets.push(
      make("handicap", "handicap", {
        slug: `${spec.key}-handicap`,
        options: spec.handicap.map((line) => ({
          key: `h${line}`,
          get label() {
            return `${line > 0 ? "+" : ""}${formatLine(line)}`;
          },
          hit: (v: TeamMatchView) => {
            const x = spec.forValue(v);
            const y = spec.againstValue(v);
            return x === null || y === null ? null : x + line > y;
          },
        })),
        defaultOption: `h${spec.handicap[Math.floor(spec.handicap.length / 2)]}`,
        matchLevel: false,
        average: (v) => {
          const x = spec.forValue(v);
          const y = spec.againstValue(v);
          return x === null || y === null ? null : x - y;
        },
      }),
    );
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

/** Textos de un mercado suelto: markets:market.<textKey>.{label,title,description}. */
function marketTexts(textKey: string) {
  const key = (path: string) => `markets:market.${textKey}.${path}`;
  return {
    get label() {
      return t(key("label"));
    },
    get title() {
      return t(key("title"));
    },
    get description() {
      return t(key("description"));
    },
  };
}

/** Opcion de un mercado suelto con su texto en markets:market.<textKey>.option.<optionKey>. */
function option(textKey: string, key: string, optionKey: string, hit: MarketOption["hit"]): MarketOption {
  return {
    key,
    get label() {
      return t(`markets:market.${textKey}.option.${optionKey}`);
    },
    hit,
  };
}

/** Un mercado suelto: los textos de marketTexts como getters del objeto. */
function single(textKey: string, def: Omit<MarketDef, "label" | "title" | "description">): MarketDef {
  const texts = marketTexts(textKey);
  return {
    ...def,
    get label() {
      return texts.label;
    },
    get title() {
      return texts.title;
    },
    get description() {
      return texts.description;
    },
  };
}

// --- Mercados ------------------------------------------------------------

export const MARKETS: MarketDef[] = [
  single("btts", {
    slug: "ambos-marcan",
    group: "goals",
    options: [option("btts", "si", "yes", btts), option("btts", "no", "no", (v) => !btts(v))],
    defaultOption: "si",
    matchLevel: true,
  }),
  single("bttsResult", {
    slug: "ambos-marcan-resultado",
    group: "goals",
    options: [
      option("bttsResult", "gana", "win", (v) => btts(v) && wins(v)),
      option("bttsResult", "empata", "draw", (v) => btts(v) && draws(v)),
      option("bttsResult", "pierde", "lose", (v) => btts(v) && loses(v)),
    ],
    defaultOption: "gana",
    matchLevel: false,
  }),
  ...statFamily({
    key: "goles",
    textKey: "goals",
    group: "goals",
    forValue: (v) => v.goalsFor,
    againstValue: (v) => v.goalsAgainst,
    lines: { match: range(0.5, 6.5), team: range(0.5, 4.5), each: range(0.5, 2.5) },
  }),
  single("goalsByHalf", {
    slug: "goles-por-parte",
    group: "goals",
    options: [
      option("goalsByHalf", "gol-1p", "goalFirstHalf", (v) => gt(htTotal(v), 0.5)),
      option("goalsByHalf", "over-1.5-1p", "over15FirstHalf", (v) => gt(htTotal(v), 1.5)),
      option("goalsByHalf", "gol-2p", "goalSecondHalf", (v) => gt(secondHalfTotal(v), 0.5)),
      option("goalsByHalf", "over-1.5-2p", "over15SecondHalf", (v) => gt(secondHalfTotal(v), 1.5)),
      option("goalsByHalf", "mas-2p", "moreInSecondHalf", (v) => {
        const first = htTotal(v);
        const second = secondHalfTotal(v);
        return first === null || second === null ? null : second > first;
      }),
      option("goalsByHalf", "marca-ambas", "teamScoresBothHalves", (v) => {
        const second = secondHalfFor(v);
        return v.htFor === null || second === null ? null : v.htFor > 0 && second > 0;
      }),
    ],
    defaultOption: "gol-1p",
    matchLevel: false,
    detail: HALF_TIME_DETAIL,
  }),
  single("result", {
    slug: "resultado",
    group: "result",
    options: [
      option("result", "gana", "win", wins),
      option("result", "empata", "draw", draws),
      option("result", "pierde", "lose", loses),
      option("result", "no-pierde", "winOrDraw", (v) => !loses(v)),
    ],
    defaultOption: "gana",
    matchLevel: false,
  }),
  single("htFt", {
    slug: "descanso-final",
    group: "result",
    options: (["G", "E", "P"] as Outcome[]).flatMap((ht) =>
      (["G", "E", "P"] as Outcome[]).map((ft) => ({
        key: `${ht}${ft}`.toLowerCase(),
        get label() {
          return t("markets:market.htFt.optionLabel", {
            ht: t(`markets:outcome.${OUTCOME_KEY[ht]}`),
            ft: t(`markets:outcome.${OUTCOME_KEY[ft]}`),
          });
        },
        hit: (v: TeamMatchView) =>
          v.htFor === null || v.htAgainst === null
            ? null
            : outcome(v.htFor, v.htAgainst) === ht && outcome(v.goalsFor, v.goalsAgainst) === ft,
      })),
    ),
    defaultOption: "gg",
    matchLevel: false,
    detail: HALF_TIME_DETAIL,
  }),
  single("cleanSheet", {
    slug: "porteria-a-cero",
    group: "result",
    options: [
      option("cleanSheet", "si", "yes", (v) => v.goalsAgainst === 0),
      option("cleanSheet", "no", "no", (v) => v.goalsAgainst > 0),
    ],
    defaultOption: "si",
    matchLevel: false,
  }),
  ...statFamily({
    key: "corners",
    textKey: "corners",
    group: "stats",
    forValue: cornersOf("for"),
    againstValue: cornersOf("against"),
    lines: { match: range(6.5, 13.5), team: range(1.5, 8.5), each: range(1.5, 5.5) },
    handicap: [-3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5],
    detail: statDetail((s) => stat(s, "corners")),
  }),
  ...statFamily({
    key: "tarjetas",
    textKey: "cards",
    group: "stats",
    forValue: cardsOf("for"),
    againstValue: cardsOf("against"),
    lines: { match: range(0.5, 9.5), team: range(0.5, 5.5), each: range(0.5, 3.5) },
    detail: statDetail(cards, true),
  }),
  ...statFamily({
    key: "puntos-tarjeta",
    textKey: "bookingPoints",
    group: "stats",
    forValue: pointsOf("for"),
    againstValue: pointsOf("against"),
    lines: { match: range(10.5, 90.5, 10), team: range(5.5, 55.5, 10), each: range(5.5, 35.5, 10) },
    detail: statDetail(bookingPoints, true),
    note: true,
  }),
  ...statFamily({
    key: "tiros",
    textKey: "shots",
    group: "stats",
    forValue: shotsOf("for"),
    againstValue: shotsOf("against"),
    lines: { match: range(16.5, 30.5), team: range(6.5, 18.5), each: range(6.5, 14.5) },
    detail: statDetail((s) => stat(s, "shots")),
  }),
  ...statFamily({
    key: "tiros-puerta",
    textKey: "shotsOnTarget",
    group: "stats",
    forValue: onTargetOf("for"),
    againstValue: onTargetOf("against"),
    lines: { match: range(4.5, 12.5), team: range(1.5, 7.5), each: range(1.5, 5.5) },
    detail: statDetail((s) => stat(s, "shots_on_target")),
  }),
  ...statFamily({
    key: "faltas",
    textKey: "fouls",
    group: "stats",
    forValue: foulsOf("for"),
    againstValue: foulsOf("against"),
    lines: { match: range(18.5, 28.5), team: range(8.5, 15.5), each: range(8.5, 13.5) },
    detail: statDetail((s) => stat(s, "fouls")),
  }),
];

export const MARKET_GROUPS: MarketGroup[] = ["goals", "result", "stats"];

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
