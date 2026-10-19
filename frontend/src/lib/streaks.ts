/** Rachas activas: partidos seguidos, desde el mas reciente hacia atras, en los
 * que un equipo (o un arbitro) cumple una opcion de las paginas de Mercados.
 * Los tipos de racha salen del registro de markets.ts (un mercado nuevo entra
 * solo) y se cuentan con su `streak`. Funciones puras. */

import type { MarketOdds, MatchResult, UpcomingMatch } from "../api/types";
import { parseApiDate } from "./format";
import { CHAMPIONS_LEAGUE_CODE } from "./leagues";
import {
  MARKETS,
  hitRate,
  streak,
  viewFrom,
  type HitRate,
  type MarketDef,
  type MarketOption,
  type TeamMatchView,
} from "./markets";
import { teamViews } from "./patterns";

// --- Umbrales -------------------------------------------------------------

/** Solo rachas que por puro azar (frecuencia de la liga ^ longitud) saldrian
 * como mucho el 5 % de las veces. */
export const MAX_CHANCE = 0.05;
/** Longitud minima; si con ella la tabla queda corta, se baja a la de reserva. */
export const MIN_LENGTH = 5;
export const FALLBACK_MIN_LENGTH = 4;
/** "Corta": menos filas que esto. */
export const SHORT_TABLE = 10;
/** Rachas por equipo (o arbitro) y dia, las mas raras. */
export const MAX_PER_ENTITY = 3;
/** Partidos sin dato (ej. sin córners) dentro de la racha: no la cortan, como
 * en Mercados, pero con mas de estos ya no se puede decir "sus últimos N". */
export const MAX_SKIPPED = 2;
/** Frecuencia de la liga con menos partidos que esto: poco fiable, sin racha. */
export const MIN_BASE_SAMPLE = 40;
/** Hoy y los 6 dias siguientes. */
export const DAYS_AHEAD = 7;

// --- Tipos de racha (del registro de Mercados) ---------------------------------

export type StreakContext = "all" | "home" | "away";
type Venue = "home" | "away" | "all";

export interface StreakType {
  index: number;
  market: MarketDef;
  option: MarketOption;
  category: string;
}

/** Condiciones que piden las rachas y no estan como boton en Mercados. */
const EXTRA_OPTIONS: Record<string, MarketOption[]> = {
  resultado: [{ key: "sin-ganar", label: "No gana", hit: (v) => v.goalsFor <= v.goalsAgainst }],
};

/** Chip de cada mercado: el de su familia (Goles, Córners...) o el suyo. */
const CATEGORY_ALIAS: Record<string, string> = { "ambos-marcan-resultado": "Ambos marcan" };

export function categoryOf(market: MarketDef): string {
  return CATEGORY_ALIAS[market.slug] ?? market.family?.label ?? market.label;
}

export const STREAK_TYPES: StreakType[] = MARKETS.flatMap((market) =>
  [...market.options, ...(EXTRA_OPTIONS[market.slug] ?? [])].map((option) => ({
    market,
    option,
    category: categoryOf(market),
  })),
).map((type, index) => ({ ...type, index }));

/** Por arbitro, los mercados de partido: los mismos que la pagina de Árbitros. */
const REFEREE_TYPES = STREAK_TYPES.filter((t) => t.market.matchLevel);

export const REFEREE_CHIP = "Árbitros";
export const BAD_RUN_CHIP = "Mala racha";
const BAD_RUN_OPTIONS = new Set(["resultado|pierde", "resultado|sin-ganar"]);
const FIRST_CATEGORIES = ["Resultado", "Goles", "Ambos marcan", "Goles por parte", "Descanso / Final", "Portería a cero"];

/** Chips de mercado, en el orden de la seccion y luego el del registro. */
export const CATEGORIES: string[] = [
  ...new Set([
    ...FIRST_CATEGORIES.filter((c) => STREAK_TYPES.some((t) => t.category === c)),
    ...STREAK_TYPES.map((t) => t.category),
  ]),
];

// --- Textos ---------------------------------------------------------------------
// Cada frase dice de quien es la cifra (del equipo, de su rival o de los dos
// sumados) y, en las de linea, que se cumplio en cada partido, no en la suma.

const num = (x: number) => x.toLocaleString("es-ES");

function lineOf(option: MarketOption): { dir: "over" | "under"; line: number } | null {
  const m = option.key.match(/^(over|under)-(\d+(?:\.\d+)?)$/);
  return m ? { dir: m[1] as "over" | "under", line: Number(m[2]) } : null;
}

const nounOf = (market: MarketDef) => (market.family?.label ?? market.label).toLowerCase();

/** "más de 8,5 córners" (null si la opcion no es de linea). */
function lineText(market: MarketDef, option: MarketOption): string | null {
  const info = lineOf(option);
  return info ? `${info.dir === "over" ? "más" : "menos"} de ${num(info.line)} ${nounOf(market)}` : null;
}

type Variant = "match" | "team" | "rival" | "each" | "handicap" | null;

function variantOf(market: MarketDef): Variant {
  const key = market.family?.key;
  if (!key) return null;
  if (market.slug === key) return "match";
  const suffix = market.slug.slice(key.length + 1);
  return ({ equipo: "team", rival: "rival", "cada-equipo": "each", handicap: "handicap" } as const)[suffix] ?? null;
}

/** Participio de lo que hace un equipo con cada estadistica ("ha sacado"). */
const VERBS: Record<string, string> = {
  goles: "marcado",
  corners: "sacado",
  tarjetas: "recibido",
  "puntos-tarjeta": "sumado",
  tiros: "hecho",
  "tiros-puerta": "hecho",
  faltas: "cometido",
};
/** Las del rival que se dicen "ha concedido" (córners y tiros). */
const CONCEDED = new Set(["corners", "tiros", "tiros-puerta"]);

const HALF_TEXT: Record<string, string> = {
  "gol-1p": "Ha habido gol en la primera parte",
  "over-1.5-1p": "Ha habido más de 1,5 goles en la primera parte",
  "gol-2p": "Ha habido gol en la segunda parte",
  "over-1.5-2p": "Ha habido más de 1,5 goles en la segunda parte",
  "mas-2p": "Se han marcado más goles en la segunda parte que en la primera",
};
const RESULT_TEXT: Record<string, [string, boolean]> = {
  gana: ["ha ganado", false],
  empata: ["ha empatado", false],
  pierde: ["ha perdido", false],
  "no-pierde": ["no ha perdido", true],
  "sin-ganar": ["no ha ganado", true],
};
const HT_TEXT: Record<string, string> = { g: "ganando", e: "empatando", p: "perdiendo" };
const FT_TEXT: Record<string, string> = { g: "ganado", e: "empatado", p: "perdido" };

/** Hándicap: "al menos 2 córners más que su rival", "como mucho 1 córner menos...". */
function handicapText(line: number, noun: string): string {
  if (line < 0) {
    const k = -line + 0.5;
    return k === 1 ? `más ${noun} que su rival` : `al menos ${k} ${noun} más que su rival`;
  }
  const k = line - 0.5;
  if (k === 0) return `al menos tantos ${noun} como su rival`;
  return `como mucho ${k} ${k === 1 ? noun.replace(/s$/, "") : noun} menos que su rival`;
}

export interface StreakSubject {
  kind: "team" | "referee";
  name: string;
}

/** La frase de una racha de `n` partidos. `ctx`: "partidos de liga", "partidos en casa"... */
export function streakText(who: StreakSubject, type: StreakType, n: number, ctx: string): string {
  const { market, option } = type;
  const key = option.key;
  const name = who.name;
  // "los últimos 6 partidos de liga de Barcelona" / "... del árbitro X"
  const last = `los últimos ${n} ${ctx} ${who.kind === "team" ? `de ${name}` : `del árbitro ${name}`}`;
  const own = `sus últimos ${n} ${ctx}`;
  const familyKey = market.family?.key ?? "";
  const info = lineOf(option);
  const amount = lineText(market, option);
  const verb = VERBS[familyKey] ?? "tenido";
  const variant = variantOf(market);

  // Lo que pasa en el partido: vale para equipos y arbitros.
  if (market.slug === "ambos-marcan") {
    return key === "si"
      ? `Han marcado los dos equipos en cada uno de ${last}`
      : `Al menos un equipo se ha quedado sin marcar en cada uno de ${last}`;
  }
  if (market.slug === "goles-por-parte" && HALF_TEXT[key]) return `${HALF_TEXT[key]} en cada uno de ${last}`;
  if (who.kind === "referee" && variant === "match" && familyKey === "tarjetas" && amount) {
    return `El árbitro ${name} ha sacado ${amount} en cada uno de ${own}`;
  }
  if (variant === "match" && amount) return `En cada uno de ${last} ha habido ${amount} entre los dos equipos`;
  if (variant === "each" && amount) return `En cada uno de ${last}, los dos equipos han ${verb} ${amount}`;
  if (who.kind === "referee") return `En cada uno de ${last} se ha cumplido «${market.title}: ${option.label}»`;

  // Lo que hace el equipo (o su rival).
  switch (market.slug) {
    case "ambos-marcan-resultado":
      if (RESULT_TEXT[key]) return `${name} ${RESULT_TEXT[key][0]} ${own} y en todos han marcado los dos equipos`;
      break;
    case "goles-por-parte":
      if (key === "marca-ambas") return `${name} ha marcado en las dos partes en cada uno de ${own}`;
      break;
    case "resultado":
      if (RESULT_TEXT[key]) return `${name} ${RESULT_TEXT[key][0]} ${RESULT_TEXT[key][1] ? "en " : ""}${own}`;
      break;
    case "descanso-final":
      if (HT_TEXT[key[0]] && FT_TEXT[key[1]]) {
        return `${name} ha ido ${HT_TEXT[key[0]]} al descanso y ha ${FT_TEXT[key[1]]} al final en ${own}`;
      }
      break;
    case "porteria-a-cero":
      return key === "si" ? `${name} ha dejado la portería a cero en ${own}` : `${name} ha encajado gol en ${own}`;
  }
  if (variant === "team" && info && amount) {
    if (familyKey === "goles" && info.line === 0.5) return `${name} ${info.dir === "over" ? "ha" : "no ha"} marcado en ${own}`;
    return `${name} ha ${verb} ${amount} en cada uno de ${own}`;
  }
  if (variant === "rival" && info && amount) {
    if (familyKey === "goles") {
      if (info.line === 0.5) return `${name} ${info.dir === "over" ? "ha" : "no ha"} encajado gol en ${own}`;
      return `${name} ha encajado ${amount} en cada uno de ${own}`;
    }
    if (CONCEDED.has(familyKey)) return `${name} ha concedido ${amount} en cada uno de ${own}`;
    return `Los rivales de ${name} han ${verb} ${amount} en cada uno de los últimos ${n} ${ctx}`;
  }
  if (variant === "handicap" && /^h-?\d/.test(key)) {
    return `${name} ha ${verb} ${handicapText(Number(key.slice(1)), nounOf(market))} en cada uno de ${own}`;
  }
  return `${name} ha cumplido «${market.title}: ${option.label}» en ${own}`;
}

function competitionOf(leagueCode: string): string {
  return leagueCode === CHAMPIONS_LEAGUE_CODE ? "de Champions" : "de liga";
}

/** "partidos de liga", "partidos en casa", "partidos fuera de casa". */
export function contextNoun(context: StreakContext, leagueCode: string): string {
  if (context === "home") return "partidos en casa";
  if (context === "away") return "partidos fuera de casa";
  return `partidos ${competitionOf(leagueCode)}`;
}

// --- Rachas activas -----------------------------------------------------------

export interface StreakRow {
  id: string;
  kind: "team" | "referee";
  leagueCode: string;
  match: UpcomingMatch;
  /** Dia local del partido, "2026-10-17". */
  day: string;
  /** Campo del equipo en el proximo partido; null en las de arbitro. */
  side: "home" | "away" | null;
  entityKey: string;
  entity: string;
  type: StreakType;
  context: StreakContext;
  length: number;
  /** Frecuencia del suceso en la liga, en ese contexto, y con cuantos casos. */
  baseRate: number;
  baseSample: number;
  /** baseRate ^ length: probabilidad por azar si los partidos fueran independientes. */
  chance: number;
  /** Partidos sin dato dentro de la racha (no la cortan). */
  skipped: number;
  /** Fecha del partido mas antiguo de la racha. */
  since: string;
  text: string;
  /** Cuota media para que siga, solo si es exactamente ese mercado y linea. */
  odds: MarketOdds | null;
}

const toTime = (iso: string) => parseApiDate(iso).getTime();

/** "2026-10-17" en hora local. */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Los dias de las pestañas: hoy y los siguientes. */
export function upcomingDays(now = new Date()): string[] {
  return Array.from({ length: DAYS_AHEAD }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    return dayKey(d);
  });
}

/** Frecuencia de cada tipo en la liga, por campo (con cache). */
function baseRates(history: MatchResult[]) {
  const home = history.map((m) => viewFrom(m, "home")).filter((v): v is TeamMatchView => v !== null);
  const away = history.map((m) => viewFrom(m, "away")).filter((v): v is TeamMatchView => v !== null);
  const views: Record<Venue, TeamMatchView[]> = { home, away, all: [...home, ...away] };
  const cache = new Map<string, HitRate>();
  return (type: StreakType, venue: Venue): HitRate => {
    const key = `${type.index}|${venue}`;
    let rate = cache.get(key);
    if (!rate) {
      rate = hitRate(views[venue], type.option);
      cache.set(key, rate);
    }
    return rate;
  };
}

/** Partidos sin dato y el mas antiguo de una racha de `n` (la cuenta es la de `streak`). */
function streakSpan(views: TeamMatchView[], hit: MarketOption["hit"], n: number) {
  let counted = 0;
  let skipped = 0;
  let oldest: TeamMatchView | null = null;
  for (const view of views) {
    if (counted === n) break;
    const result = hit(view);
    if (result === null) {
      skipped += 1;
      continue;
    }
    counted += 1;
    oldest = view;
  }
  return { skipped, oldest };
}

/** Cuota media para que la racha siga: solo Resultado (gana, empata, pierde) y
 * más/menos de 2,5 goles del partido, los mercados con "Market Average". */
function oddsFor(match: UpcomingMatch, type: StreakType, side: "home" | "away"): MarketOdds | null {
  const find = (market: string, selection: string) =>
    match.odds.find((o) => o.market === market && o.selection === selection) ?? null;
  const key = type.option.key;
  if (type.market.slug === "resultado") {
    if (key === "gana") return find("1x2", side);
    if (key === "empata") return find("1x2", "draw");
    if (key === "pierde") return find("1x2", side === "home" ? "away" : "home");
  }
  if (type.market.slug === "goles" && (key === "over-2.5" || key === "under-2.5")) {
    return find("over_under_2.5", key === "over-2.5" ? "over" : "under");
  }
  return null;
}

/** Rachas activas de los equipos (y arbitros designados) de los proximos
 * partidos de una liga, con su partido siguiente. `played`: los partidos
 * jugados de la temporada y la anterior (la racha sigue hacia atras). Solo las
 * de `FALLBACK_MIN_LENGTH` partidos o mas y poco probables por azar. */
export function activeStreaks(leagueCode: string, played: MatchResult[], upcoming: UpcomingMatch[]): StreakRow[] {
  const history = played.filter((m) => m.status === "historical").sort((a, b) => toTime(b.date) - toTime(a.date));
  const rates = baseRates(history);
  const rows: StreakRow[] = [];
  const seen = new Set<string>();

  const add = (
    base: Omit<StreakRow, "id" | "type" | "context" | "length" | "baseRate" | "baseSample" | "chance" | "skipped" | "since" | "text" | "odds">,
    views: TeamMatchView[],
    type: StreakType,
    context: StreakContext,
    text: (n: number) => string,
  ) => {
    const length = streak(views, type.option.hit);
    if (length < FALLBACK_MIN_LENGTH) return;
    const rate = rates(type, base.kind === "referee" ? "home" : context);
    if (rate.pct === null || rate.total < MIN_BASE_SAMPLE) return;
    const chance = rate.pct ** length;
    if (chance > MAX_CHANCE) return;
    const { skipped, oldest } = streakSpan(views, type.option.hit, length);
    if (skipped > MAX_SKIPPED || !oldest) return;
    rows.push({
      ...base,
      id: `${base.entityKey}|${base.match.id}|${type.index}|${context}`,
      type,
      context,
      length,
      baseRate: rate.pct,
      baseSample: rate.total,
      chance,
      skipped,
      since: oldest.match.date,
      text: text(length),
      odds: base.side ? oddsFor(base.match, type, base.side) : null,
    });
  };

  for (const match of [...upcoming].sort((a, b) => toTime(a.date) - toTime(b.date))) {
    const day = dayKey(parseApiDate(match.date));
    // Cada equipo, con su proximo partido de la liga.
    for (const side of ["home", "away"] as const) {
      const teamId = side === "home" ? match.home_team_id : match.away_team_id;
      const team = side === "home" ? match.home_team : match.away_team;
      if (seen.has(`t${teamId}`)) continue;
      seen.add(`t${teamId}`);
      const views = teamViews(history, teamId);
      const atVenue = views.filter((v) => v.venue === side);
      const base = { kind: "team" as const, leagueCode, match, day, side, entityKey: `t${teamId}`, entity: team };
      const who: StreakSubject = { kind: "team", name: team };
      for (const type of STREAK_TYPES) {
        add(base, views, type, "all", (n) => streakText(who, type, n, contextNoun("all", leagueCode)));
        add(base, atVenue, type, side, (n) => streakText(who, type, n, contextNoun(side, leagueCode)));
      }
    }
    // El arbitro, solo si ya esta designado en nuestros datos.
    const referee = match.referee;
    if (referee && !seen.has(`r${referee}`)) {
      seen.add(`r${referee}`);
      const views = history
        .filter((m) => m.referee === referee)
        .map((m) => viewFrom(m, "home"))
        .filter((v): v is TeamMatchView => v !== null);
      const base = { kind: "referee" as const, leagueCode, match, day, side: null, entityKey: `r${referee}`, entity: referee };
      const who: StreakSubject = { kind: "referee", name: referee };
      for (const type of REFEREE_TYPES) {
        add(base, views, type, "all", (n) => streakText(who, type, n, contextNoun("all", leagueCode)));
      }
    }
  }
  return rows;
}

// --- Seleccion: sin rachas triviales ni repetidas ------------------------------

export type StreakSort = "rarity" | "length";

const byRarity = (a: StreakRow, b: StreakRow) =>
  a.chance - b.chance ||
  // El mismo suceso con dos nombres (portería a cero = no encaja): primero el
  // mercado suelto, que es el mas concreto.
  Number(a.type.market.family !== undefined) - Number(b.type.market.family !== undefined) ||
  a.type.index - b.type.index;

const byLength = (a: StreakRow, b: StreakRow) => b.length - a.length || byRarity(a, b);

function select(pool: StreakRow[], minLength: number): StreakRow[] {
  const sameEvent = new Set<string>();
  const perMarket = new Set<string>();
  const perEntity = new Map<string, number>();
  const out: StreakRow[] = [];
  for (const row of pool.filter((r) => r.length >= minLength).sort(byRarity)) {
    const who = `${row.entityKey}|${row.match.id}`;
    const event = `${who}|${row.context}|${row.length}|${row.baseRate.toFixed(6)}|${row.since}`;
    // Mismo equipo y mercado: solo la mas rara, que es la de la linea mas
    // exigente que se cumple en toda la racha.
    const market = `${who}|${row.type.market.slug}`;
    const entity = `${row.entityKey}|${row.day}`;
    if (sameEvent.has(event) || perMarket.has(market)) continue;
    if ((perEntity.get(entity) ?? 0) >= MAX_PER_ENTITY) continue;
    sameEvent.add(event);
    perMarket.add(market);
    perEntity.set(entity, (perEntity.get(entity) ?? 0) + 1);
    out.push(row);
  }
  return out;
}

/** Las filas de la tabla: longitud minima (o la de reserva si queda corta),
 * una por equipo y mercado, como mucho MAX_PER_ENTITY por equipo y dia. */
export function selectStreaks(pool: StreakRow[], sort: StreakSort = "rarity"): { rows: StreakRow[]; minLength: number } {
  let minLength = MIN_LENGTH;
  let rows = select(pool, minLength);
  if (rows.length < SHORT_TABLE) {
    minLength = FALLBACK_MIN_LENGTH;
    rows = select(pool, minLength);
  }
  return { rows: rows.sort(sort === "length" ? byLength : byRarity), minLength };
}

export function isBadRun(row: StreakRow): boolean {
  return row.kind === "team" && BAD_RUN_OPTIONS.has(`${row.type.market.slug}|${row.type.option.key}`);
}

/** Chip de una fila: su mercado, "Árbitros" o "Mala racha". */
export function matchesChip(row: StreakRow, chip: string): boolean {
  if (chip === REFEREE_CHIP) return row.kind === "referee";
  if (chip === BAD_RUN_CHIP) return isBadRun(row);
  return row.type.category === chip;
}

/** "Populares": las categorias con mas rachas raras activas (las 3 primeras). */
export function popularCategories(pool: StreakRow[], top = 3): string[] {
  const counts = new Map<string, number>();
  for (const row of selectStreaks(pool).rows) counts.set(row.type.category, (counts.get(row.type.category) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([category]) => category);
}

// --- ¿Se prolongan? -------------------------------------------------------------

export interface StudyEvent {
  category: string;
  length: number;
  hit: boolean;
  /** Frecuencia de la liga antes de ese partido. */
  base: number;
  match: number;
}

interface Run {
  len: Int32Array;
  skip: Int32Array;
}

function newRun(size: number): Run {
  return { len: new Int32Array(size), skip: new Int32Array(size) };
}

function advance(run: Run, i: number, hit: boolean | null) {
  if (hit === null) {
    if (run.len[i] > 0) run.skip[i] += 1;
  } else if (hit) {
    run.len[i] += 1;
  } else {
    run.len[i] = 0;
    run.skip[i] = 0;
  }
}

/** Cada racha que habria salido en la tabla antes de un partido jugado (con
 * MIN_LENGTH, solo con partidos anteriores) y si siguio en ese partido. Los
 * partidos, en orden; la frecuencia de la liga, tambien solo con los
 * anteriores. Un paso por partido, para calcularlo por trozos. */
export function* studyEventsSteps(played: MatchResult[]): Generator<StudyEvent[]> {
  const matches = played.filter((m) => m.status === "historical").sort((a, b) => toTime(a.date) - toTime(b.date));
  const T = STREAK_TYPES.length;
  // Liga: aciertos y casos por tipo y campo (0 local, 1 visitante).
  const hits = new Float64Array(T * 2);
  const decided = new Float64Array(T * 2);
  // Equipo: racha por tipo y contexto (0 todos, 1 en casa, 2 fuera).
  const teams = new Map<number, Run>();
  const referees = new Map<string, Run>();

  const rate = (t: number, venue: Venue): number | null => {
    const h = venue === "away" ? hits[t * 2 + 1] : venue === "home" ? hits[t * 2] : hits[t * 2] + hits[t * 2 + 1];
    const d =
      venue === "away" ? decided[t * 2 + 1] : venue === "home" ? decided[t * 2] : decided[t * 2] + decided[t * 2 + 1];
    return d >= MIN_BASE_SAMPLE ? h / d : null;
  };

  type Best = { type: StreakType; len: number; p: number; chance: number };
  /** La mas rara por mercado de las que pasan los umbrales. */
  const consider = (best: Map<string, Best>, type: StreakType, run: Run, i: number, venue: Venue) => {
    const len = run.len[i];
    if (len < MIN_LENGTH || run.skip[i] > MAX_SKIPPED) return;
    const p = rate(type.index, venue);
    if (p === null) return;
    const chance = p ** len;
    if (chance > MAX_CHANCE) return;
    const now = best.get(type.market.slug);
    if (!now || chance < now.chance) best.set(type.market.slug, { type, len, p, chance });
  };

  for (const match of matches) {
    const home = viewFrom(match, "home");
    const away = viewFrom(match, "away");
    if (!home || !away) continue;
    const sides = [
      { id: match.home_team_id, view: home, ctx: 1, venue: "home" as const },
      { id: match.away_team_id, view: away, ctx: 2, venue: "away" as const },
    ];
    const events: StudyEvent[] = [];

    // 1) Rachas antes del partido y si siguieron.
    for (const side of sides) {
      const run = teams.get(side.id);
      if (!run) continue;
      const best = new Map<string, Best>();
      for (const type of STREAK_TYPES) {
        consider(best, type, run, type.index * 3, "all");
        consider(best, type, run, type.index * 3 + side.ctx, side.venue);
      }
      for (const b of best.values()) {
        const hit = b.type.option.hit(side.view);
        if (hit !== null) events.push({ category: b.type.category, length: b.len, hit, base: b.p, match: match.id });
      }
    }
    const referee = match.referee;
    const refRun = referee ? referees.get(referee) : undefined;
    if (refRun) {
      const best = new Map<string, Best>();
      for (const type of REFEREE_TYPES) consider(best, type, refRun, type.index, "home");
      for (const b of best.values()) {
        const hit = b.type.option.hit(home);
        if (hit !== null) events.push({ category: REFEREE_CHIP, length: b.len, hit, base: b.p, match: match.id });
      }
    }

    // 2) El partido entra en las rachas y en la frecuencia de la liga.
    for (const side of sides) {
      let run = teams.get(side.id);
      if (!run) teams.set(side.id, (run = newRun(T * 3)));
      const v = side.venue === "home" ? 0 : 1;
      for (const type of STREAK_TYPES) {
        const hit = type.option.hit(side.view);
        advance(run, type.index * 3, hit);
        advance(run, type.index * 3 + side.ctx, hit);
        if (hit !== null) {
          decided[type.index * 2 + v] += 1;
          if (hit) hits[type.index * 2 + v] += 1;
        }
      }
    }
    if (referee) {
      let run = referees.get(referee);
      if (!run) referees.set(referee, (run = newRun(T)));
      for (const type of REFEREE_TYPES) advance(run, type.index, type.option.hit(home));
    }
    yield events;
  }
}

export function studyEvents(played: MatchResult[]): StudyEvent[] {
  return [...studyEventsSteps(played)].flat();
}

export type LengthBucket = "5" | "6" | "7+";
export const LENGTH_BUCKETS: LengthBucket[] = ["5", "6", "7+"];
const bucketOf = (length: number): LengthBucket => (length >= 7 ? "7+" : length === 6 ? "6" : "5");

export interface StudyCell {
  events: number;
  matches: number;
  /** Veces que la racha siguio en el partido siguiente. */
  rate: number;
  /** Lo habitual en la liga para esos mismos sucesos. */
  expected: number;
  diff: number;
  /** Intervalo del 95 % de `diff`, remuestreando partidos. */
  low: number;
  high: number;
}

/** Menos casos que esto: la celda no se muestra. */
export const MIN_CELL_EVENTS = 30;
export const BOOTSTRAP_SAMPLES = 500;
export const BOOTSTRAP_SEED = 20261014;

/** Generador pseudoaleatorio con semilla (mulberry32): mismo resultado siempre. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cell(events: StudyEvent[], random: () => number): StudyCell | null {
  if (events.length < MIN_CELL_EVENTS) return null;
  // Remuestreo por partidos: las rachas de un mismo partido no son independientes.
  const byMatch = new Map<number, { hits: number; base: number; n: number }>();
  for (const e of events) {
    const g = byMatch.get(e.match) ?? { hits: 0, base: 0, n: 0 };
    g.hits += e.hit ? 1 : 0;
    g.base += e.base;
    g.n += 1;
    byMatch.set(e.match, g);
  }
  const groups = [...byMatch.values()];
  const total = groups.reduce((acc, g) => ({ hits: acc.hits + g.hits, base: acc.base + g.base, n: acc.n + g.n }), {
    hits: 0,
    base: 0,
    n: 0,
  });
  const diffs: number[] = [];
  for (let s = 0; s < BOOTSTRAP_SAMPLES; s++) {
    let h = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[Math.floor(random() * groups.length)];
      h += g.hits;
      b += g.base;
      n += g.n;
    }
    diffs.push((h - b) / n);
  }
  diffs.sort((x, y) => x - y);
  return {
    events: total.n,
    matches: groups.length,
    rate: total.hits / total.n,
    expected: total.base / total.n,
    diff: (total.hits - total.base) / total.n,
    low: diffs[Math.floor(0.025 * (BOOTSTRAP_SAMPLES - 1))],
    high: diffs[Math.ceil(0.975 * (BOOTSTRAP_SAMPLES - 1))],
  };
}

export interface StudyRow {
  category: string;
  cells: Record<LengthBucket, StudyCell | null>;
}

/** Por mercado y longitud: cuantas veces siguio la racha frente a lo habitual,
 * con su intervalo. La primera fila, todas juntas. Un paso por celda. */
export function* summarizeStudySteps(events: StudyEvent[]): Generator<void, StudyRow[]> {
  const random = seeded(BOOTSTRAP_SEED);
  const rows: StudyRow[] = [];
  for (const category of ["Todas", ...CATEGORIES, REFEREE_CHIP]) {
    const own = category === "Todas" ? events : events.filter((e) => e.category === category);
    const cells = {} as Record<LengthBucket, StudyCell | null>;
    for (const bucket of LENGTH_BUCKETS) {
      cells[bucket] = cell(
        own.filter((e) => bucketOf(e.length) === bucket),
        random,
      );
      yield;
    }
    if (LENGTH_BUCKETS.some((b) => cells[b] !== null)) rows.push({ category, cells });
  }
  return rows;
}

export function summarizeStudy(events: StudyEvent[]): StudyRow[] {
  const steps = summarizeStudySteps(events);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/** Diferencia clara: el intervalo no incluye el cero. */
export function isClear(c: StudyCell): boolean {
  return c.low > 0 || c.high < 0;
}
