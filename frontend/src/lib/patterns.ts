/** Patrones de alta frecuencia: "en N de M partidos pasó X", por equipo y por
 * arbitro-equipo, con las mismas lineas y la misma forma de contar que las
 * paginas de Mercados (markets.ts). Funciones puras: todo sale de los
 * partidos que se les pasan y solo cuentan los anteriores al partido. */

import type { Match, MatchResult } from "../api/types";
import { cornerDuelForecast, type DuelForecast } from "./cornerDuel";
import { formatSeason } from "./format";
import {
  average,
  findMarket,
  hitRate,
  viewFrom,
  type HitRate,
  type MarketDef,
  type MarketOption,
  type TeamMatchView,
} from "./markets";

// --- Umbrales -------------------------------------------------------------

/** Solo patrones que se cumplen al menos en el 80 % de los partidos. */
export const MIN_RATE = 0.8;
/** Muestra minima de un patron de equipo: 5 partidos si se cumplio siempre,
 * 8 si se cumplio entre el 80 y el 99 %. */
export const MIN_N_PERFECT = 5;
export const MIN_N_HIGH = 8;
/** Arbitro-equipo: desde 3 partidos; con 3 o 4, "muestra pequeña". */
export const MIN_N_REFEREE = 3;
export const SMALL_REFEREE_SAMPLE = 5;
/** Trivial: si en toda la liga ya pasa al menos en el 80 % de los casos (el
 * mismo umbral que un patron), no es un patron de estos equipos. Ej. "más de
 * 0.5 tarjetas en el partido" o "encaja menos de 2.5 goles". */
export const TRIVIAL_LEAGUE_RATE = MIN_RATE;
/** Ventanas del modelo de patrones del backend (pattern_model.py): ultimos 10
 * partidos en el mismo campo y ultimos 20 en cualquiera. */
export const VENUE_WINDOW = 10;
export const ALL_WINDOW = 20;
/** Contraste con el rival: "parcial" si lo cumple al menos la mitad de las
 * veces; por debajo, el rival lo contradice. Con menos de 3 partidos no hay
 * contraste. */
export const PARTIAL_RIVAL_RATE = 0.5;
export const MIN_N_RIVAL = 3;
/** Fuerza de un pick: limite inferior de Wilson (95 %) de los dos historiales
 * juntos (equipo + rival). */
export const STRONG_SCORE = 0.75;
export const MEDIUM_SCORE = 0.6;
export const MAX_PICKS = 6;
export const MAX_REFEREE_FACTS = 6;

/** Limite inferior del intervalo de Wilson al 95 %: el porcentaje "minimo
 * creible" con esa muestra. 5 de 5 -> 0.57; 20 de 20 -> 0.84. */
export function wilsonLower(hits: number, n: number, z = 1.96): number {
  if (n === 0) return 0;
  const p = hits / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return (centre - margin) / (1 + z2 / n);
}

// --- Catalogo ---------------------------------------------------------------

/** De quien es la cifra: del equipo, la que le hacen (en contra) o del partido. */
type Side = "for" | "against" | "match";

interface FamilySpec {
  slug: string;
  side: Side;
  /** Hay metrica complementaria sensata en el rival. Tarjetas y faltas de un
   * equipo dependen de el (y del arbitro), no de lo que provoca el rival. */
  crossable: boolean;
  /** Texto de una opcion, desde el equipo; `mirror`: el mismo suceso visto
   * desde el rival (lo que el rival tiene que conceder o cumplir). */
  text: (option: OptionInfo, mirror: boolean) => string;
}

interface OptionInfo {
  key: string;
  dir: "over" | "under" | null;
  line: number | null;
}

const fmt = (line: number) => String(line);

/** "Más de 2.5 X" / "Menos de 2.5 X". */
const overUnder = (noun: string) => (o: OptionInfo) =>
  `${o.dir === "over" ? "Más" : "Menos"} de ${fmt(o.line!)} ${noun}`;

/** Cifra propia del equipo: "Saca más de 4.5 córners"; desde el rival,
 * "Concede más de 4.5 córners". */
const ownStat = (verb: string, mirrorVerb: string | null, noun: string) => (o: OptionInfo, mirror: boolean) =>
  `${mirror && mirrorVerb ? mirrorVerb : verb} ${o.dir === "over" ? "más" : "menos"} de ${fmt(o.line!)} ${noun}`;

function goalsText(scoring: boolean, o: OptionInfo): string {
  const [yes, no, verb] = scoring ? ["Marca", "No marca", "Marca"] : ["Encaja", "No encaja", "Encaja"];
  if (o.line === 0.5) return o.dir === "over" ? yes : no;
  return `${verb} ${o.dir === "over" ? "más" : "menos"} de ${fmt(o.line!)} goles`;
}

const RESULT_TEXT: Record<string, [string, string]> = {
  gana: ["Gana", "Pierde"],
  empata: ["Empata", "Empata"],
  pierde: ["Pierde", "Gana"],
  "no-pierde": ["No pierde", "No gana"],
};

const DUEL_TEXT: Record<string, [string, string]> = {
  gana: ["Gana el duelo de córners", "Pierde el duelo de córners"],
  empata: ["Empata el duelo de córners", "Empata el duelo de córners"],
  "no-pierde": ["No pierde el duelo de córners", "No gana el duelo de córners"],
};

/** Córners del equipo menos los del rival en ese partido; null sin el dato. */
function cornerDiff(v: TeamMatchView): number | null {
  const own = v.statsFor?.corners ?? null;
  const rival = v.statsAgainst?.corners ?? null;
  return own === null || rival === null ? null : own - rival;
}

const duel = (test: (diff: number) => boolean) => (v: TeamMatchView) => {
  const diff = cornerDiff(v);
  return diff === null ? null : test(diff);
};

/** Duelo de córners: solo para los picks probables (no es una página de
 * Mercados). El empate es una opción más: sale solo si es un patrón. */
const CORNER_DUEL: MarketDef = {
  slug: "duelo-corners",
  group: "Estadísticas",
  label: "Duelo de córners",
  title: "Duelo de córners",
  description: "Si el equipo saca más córners que su rival en el partido.",
  options: [
    { key: "gana", label: "Saca más córners", hit: duel((d) => d > 0) },
    { key: "empata", label: "Los mismos córners", hit: duel((d) => d === 0) },
    { key: "no-pierde", label: "Al menos los mismos córners", hit: duel((d) => d >= 0) },
  ],
  defaultOption: "gana",
  matchLevel: false,
};

const PICK_ONLY_MARKETS: Record<string, MarketDef> = { [CORNER_DUEL.slug]: CORNER_DUEL };

function marketFor(slug: string): MarketDef | undefined {
  return PICK_ONLY_MARKETS[slug] ?? findMarket(slug);
}

const FAMILIES: FamilySpec[] = [
  { slug: "goles-equipo", side: "for", crossable: true, text: (o, m) => goalsText(!m, o) },
  { slug: "goles-rival", side: "against", crossable: true, text: (o, m) => goalsText(m, o) },
  { slug: "goles", side: "match", crossable: true, text: (o) => `${overUnder("goles")(o)} en el partido` },
  {
    slug: "ambos-marcan",
    side: "match",
    crossable: true,
    text: (o) => (o.key === "si" ? "Marcan los dos equipos" : "No marcan los dos equipos"),
  },
  { slug: "resultado", side: "for", crossable: true, text: (o, m) => RESULT_TEXT[o.key][m ? 1 : 0] },
  { slug: "corners", side: "match", crossable: true, text: (o) => `${overUnder("córners")(o)} en el partido` },
  { slug: "corners-equipo", side: "for", crossable: true, text: ownStat("Saca", "Concede", "córners") },
  { slug: "tarjetas", side: "match", crossable: true, text: (o) => `${overUnder("tarjetas")(o)} en el partido` },
  { slug: "tarjetas-equipo", side: "for", crossable: false, text: ownStat("Recibe", null, "tarjetas") },
  { slug: "faltas", side: "match", crossable: true, text: (o) => `${overUnder("faltas")(o)} en el partido` },
  { slug: "faltas-equipo", side: "for", crossable: false, text: ownStat("Comete", null, "faltas") },
  { slug: "tiros", side: "match", crossable: true, text: (o) => `${overUnder("tiros")(o)} en el partido` },
  { slug: "tiros-equipo", side: "for", crossable: true, text: ownStat("Hace", "Concede", "tiros") },
  {
    slug: "tiros-puerta",
    side: "match",
    crossable: true,
    text: (o) => `${overUnder("tiros a puerta")(o)} en el partido`,
  },
  { slug: "tiros-puerta-equipo", side: "for", crossable: true, text: ownStat("Hace", "Concede", "tiros a puerta") },
];

/** Duelo de córners (nuevo): mismas reglas que el resto, pero aparte. No
 * compite por el tope de picks del partido ni entra en sus cifras de acierto,
 * para que las anteriores sigan siendo comparables. */
export const DUEL_FAMILY = "duelo-corners";
const DUEL_FAMILIES: FamilySpec[] = [
  { slug: DUEL_FAMILY, side: "for", crossable: true, text: (o, m) => DUEL_TEXT[o.key][m ? 1 : 0] },
];
const ALL_FAMILIES = [...FAMILIES, ...DUEL_FAMILIES];

/** Arbitro-equipo: lo que mas depende del arbitro. */
const REFEREE_FAMILIES = ["tarjetas-equipo", "tarjetas", "faltas-equipo", "faltas"];

function optionInfo(option: MarketOption): OptionInfo {
  const match = option.key.match(/^(over|under)-(\d+(?:\.\d+)?)$/);
  return match
    ? { key: option.key, dir: match[1] as "over" | "under", line: Number(match[2]) }
    : { key: option.key, dir: null, line: null };
}

/** Grupos de opciones en las que solo vale la mas informativa: las "más de"
 * de una cifra (de menor a mayor exigencia), las "menos de" (de menor a mayor
 * exigencia: la linea mas baja es la mas exigente) y cada opcion suelta. */
function ladders(market: MarketDef): MarketOption[][] {
  const over = market.options.filter((o) => optionInfo(o).dir === "over");
  const under = market.options.filter((o) => optionInfo(o).dir === "under");
  const lineOf = (o: MarketOption) => optionInfo(o).line!;
  const groups: MarketOption[][] = [];
  if (over.length) groups.push([...over].sort((a, b) => lineOf(a) - lineOf(b)));
  if (under.length) groups.push([...under].sort((a, b) => lineOf(b) - lineOf(a)));
  for (const o of market.options) if (optionInfo(o).dir === null) groups.push([o]);
  return groups;
}

// --- Partidos y contextos -----------------------------------------------------

/** Solo partidos jugados antes que `match` (ni el propio ni posteriores), los
 * mas recientes primero. La API ya los filtra; esto lo garantiza aqui tambien. */
export function priorMatches(match: Pick<Match, "id" | "date">, matches: MatchResult[]): MatchResult[] {
  const cutoff = Date.parse(match.date);
  return matches
    .filter((m) => m.id !== match.id && m.status === "historical" && Date.parse(m.date) < cutoff)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

/** Los partidos de un equipo vistos desde el. */
export function teamViews(matches: MatchResult[], teamId: number): TeamMatchView[] {
  return matches
    .filter((m) => m.home_team_id === teamId || m.away_team_id === teamId)
    .map((m) => viewFrom(m, m.home_team_id === teamId ? "home" : "away"))
    .filter((v): v is TeamMatchView => v !== null);
}

/** El mismo partido visto desde el rival: lo que el equipo hizo, se lo
 * hicieron. Sirve para medir en el rival el suceso complementario. */
export function flipView(v: TeamMatchView): TeamMatchView {
  return {
    match: v.match,
    venue: v.venue === "home" ? "away" : "home",
    goalsFor: v.goalsAgainst,
    goalsAgainst: v.goalsFor,
    htFor: v.htAgainst,
    htAgainst: v.htFor,
    statsFor: v.statsAgainst,
    statsAgainst: v.statsFor,
  };
}

export type ContextKind = "season-venue" | "recent-venue" | "season-all" | "recent-all";

export interface PatternContext {
  kind: ContextKind;
  venue: "home" | "away";
  views: TeamMatchView[];
  /** Temporadas de esos partidos, ej. "25/26 y 26/27". */
  seasons: string;
}

function seasonsLabel(views: TeamMatchView[]): string {
  const seasons = [...new Set(views.map((v) => v.match.season))].sort();
  return seasons.map(formatSeason).join(" y ");
}

/** Contextos de un equipo: en su campo de este partido y en todos, esta
 * temporada y en las ventanas del modelo de patrones (que pueden incluir la
 * temporada anterior). Los cuatro, aunque coincidan: el rival se mide en el
 * mismo tipo de contexto que el patron (ver distinctContexts). */
export function teamContexts(
  prior: MatchResult[],
  teamId: number,
  venue: "home" | "away",
  season: string,
): PatternContext[] {
  const views = teamViews(prior, teamId);
  const atVenue = views.filter((v) => v.venue === venue);
  const candidates: Omit<PatternContext, "seasons">[] = [
    { kind: "season-venue", venue, views: atVenue.filter((v) => v.match.season === season) },
    { kind: "recent-venue", venue, views: atVenue.slice(0, VENUE_WINDOW) },
    { kind: "season-all", venue, views: views.filter((v) => v.match.season === season) },
    { kind: "recent-all", venue, views: views.slice(0, ALL_WINDOW) },
  ];
  return candidates.filter((c) => c.views.length > 0).map((c) => ({ ...c, seasons: seasonsLabel(c.views) }));
}

/** Sin repetir contextos con los mismos partidos (se queda el primero: "esta
 * temporada" antes que "últimos N"), para no contar dos veces lo mismo. */
export function distinctContexts(contexts: PatternContext[]): PatternContext[] {
  const seen = new Set<string>();
  return contexts.filter((c) => {
    const key = c.views.map((v) => v.match.id).join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** "fuera de casa esta temporada (26/27)", "sus últimos 10 partidos en casa (25/26 y 26/27)". */
export function contextLabel(context: PatternContext, total: number): string {
  const place = context.venue === "home" ? "en casa" : "fuera de casa";
  switch (context.kind) {
    case "season-venue":
      return `partidos ${place} esta temporada (${context.seasons})`;
    case "season-all":
      return `partidos esta temporada (${context.seasons})`;
    case "recent-venue":
      return `sus últimos ${total} partidos ${place} (${context.seasons})`;
    case "recent-all":
      return `sus últimos ${total} partidos (${context.seasons})`;
  }
}

/** "En 7 de 7 partidos fuera de casa esta temporada (26/27)", "En 9 de sus
 * últimos 10 partidos en casa (25/26 y 26/27)". */
export function evidenceText(hits: number, total: number, context: PatternContext): string {
  const label = contextLabel(context, total);
  return context.kind.startsWith("recent") ? `En ${hits} de ${label}` : `En ${hits} de ${total} ${label}`;
}

// --- Patrones de equipo -------------------------------------------------------

/** Cumple frecuencia y muestra minimas de un patron de equipo. */
export function passesTeamRule(rate: HitRate): boolean {
  if (rate.pct === null) return false;
  if (rate.pct === 1) return rate.total >= MIN_N_PERFECT;
  return rate.pct >= MIN_RATE && rate.total >= MIN_N_HIGH;
}

export function passesRefereeRule(rate: HitRate): boolean {
  return rate.pct !== null && rate.pct >= MIN_RATE && rate.total >= MIN_N_REFEREE;
}

/** Frecuencia de cada suceso en la liga, por campo: lo "normal". */
export function leagueRates(prior: MatchResult[]) {
  const home = prior.map((m) => viewFrom(m, "home")).filter((v): v is TeamMatchView => v !== null);
  const away = prior.map((m) => viewFrom(m, "away")).filter((v): v is TeamMatchView => v !== null);
  const byVenue = { home, away, all: [...home, ...away] };
  const cache = new Map<string, number | null>();
  return (option: MarketOption, family: string, venue: "home" | "away" | "all"): number | null => {
    const key = `${family}|${option.key}|${venue}`;
    if (!cache.has(key)) cache.set(key, hitRate(byVenue[venue], option).pct);
    return cache.get(key)!;
  };
}

/** Frecuencia en la liga de una opcion, en un campo o en los dos. */
export type LeagueRates = (option: MarketOption, family: string, venue: "home" | "away" | "all") => number | null;

export interface TeamPattern {
  side: "home" | "away";
  teamId: number;
  team: string;
  family: string;
  option: MarketOption;
  info: OptionInfo;
  /** Del partido (goles, tarjetas... totales) o del equipo. */
  matchLevel: boolean;
  text: string;
  rate: HitRate;
  context: PatternContext;
  leagueRate: number | null;
  score: number;
}

function isTrivial(leagueRate: number | null): boolean {
  return leagueRate !== null && leagueRate >= TRIVIAL_LEAGUE_RATE;
}

function contextVenue(context: PatternContext): "home" | "away" | "all" {
  return context.kind.endsWith("venue") ? context.venue : "all";
}

/** Patrones de un equipo: por cada estadistica y sentido, solo la linea mas
 * exigente que se cumple (en el contexto con mejor limite de Wilson), si no
 * es algo que en la liga pasa casi siempre. */
export function findTeamPatterns(
  contexts: PatternContext[],
  team: { side: "home" | "away"; id: number; name: string },
  rates: LeagueRates | null,
  families: FamilySpec[] = FAMILIES,
): TeamPattern[] {
  const found: TeamPattern[] = [];
  const distinct = distinctContexts(contexts);
  for (const spec of families) {
    const market = marketFor(spec.slug);
    if (!market) continue;
    for (const ladder of ladders(market)) {
      // De la linea mas exigente a la menos: la primera que se cumple es la
      // que vale, en el contexto con mejor limite de Wilson.
      let best: { option: MarketOption; context: PatternContext; rate: HitRate; score: number } | null = null;
      for (const option of [...ladder].reverse()) {
        for (const context of distinct) {
          const rate = hitRate(context.views, option);
          if (!passesTeamRule(rate)) continue;
          const score = wilsonLower(rate.hits, rate.total);
          if (best === null || score > best.score) best = { option, context, rate, score };
        }
        if (best) break;
      }
      if (!best) continue;
      const leagueRate = rates ? rates(best.option, spec.slug, contextVenue(best.context)) : null;
      if (isTrivial(leagueRate)) continue;
      const info = optionInfo(best.option);
      found.push({
        side: team.side,
        teamId: team.id,
        team: team.name,
        family: spec.slug,
        option: best.option,
        info,
        matchLevel: spec.side === "match",
        text: spec.text(info, false),
        rate: best.rate,
        context: best.context,
        leagueRate,
        score: best.score,
      });
    }
  }
  return dropImplied(found);
}

/** Quita lo que ya dice otro patron mas fuerte del mismo equipo: "gana" hace
 * sobrar "no pierde"; "marcan los dos" hace sobrar "marca" y "encaja"; "no
 * marca" o "no encaja" hacen sobrar "no marcan los dos". */
function dropImplied(patterns: TeamPattern[]): TeamPattern[] {
  const has = (family: string, key: string) => patterns.some((p) => p.family === family && p.option.key === key);
  return patterns.filter((p) => {
    if (p.family === "resultado" && p.option.key === "no-pierde") return !has("resultado", "gana");
    if (p.family === "duelo-corners" && p.option.key === "no-pierde") return !has("duelo-corners", "gana");
    if ((p.family === "goles-equipo" || p.family === "goles-rival") && p.option.key === "over-0.5") {
      return !has("ambos-marcan", "si");
    }
    if (p.family === "ambos-marcan" && p.option.key === "no") {
      return !has("goles-equipo", "under-0.5") && !has("goles-rival", "under-0.5");
    }
    return true;
  });
}

// --- Contraste con el rival ---------------------------------------------------

export type RivalState = "backed" | "partial" | "against" | "none";

export const RIVAL_STATE_LABEL: Record<RivalState, string> = {
  backed: "Respaldado por el rival",
  partial: "Parcialmente respaldado",
  against: "No respaldado",
  none: "Sin contraste con el rival",
};

export interface RivalCheck {
  state: RivalState;
  /** Hay una estadistica del rival que complementa el patron. */
  crossable: boolean;
  team: string;
  /** Lo que tiene que cumplir el rival: "Encaja", "Más de 2.5 goles en el partido". */
  text: string;
  rate: HitRate | null;
  context: PatternContext | null;
}

/** Estado del contraste a partir de lo que hizo el rival. */
export function rivalState(rate: HitRate | null): RivalState {
  if (rate === null || rate.pct === null || rate.total < MIN_N_RIVAL) return "none";
  if (passesTeamRule(rate)) return "backed";
  if (rate.pct >= PARTIAL_RIVAL_RATE) return "partial";
  return "against";
}

/** Mide en el rival el suceso complementario, en su campo de este partido y
 * con el mismo tipo de contexto: "X marca fuera" -> "el rival encaja en casa". */
export function checkRival(
  pattern: TeamPattern,
  rivalContexts: PatternContext[],
  rival: { name: string },
): RivalCheck {
  const spec = ALL_FAMILIES.find((f) => f.slug === pattern.family)!;
  const text = spec.text(pattern.info, true);
  if (!spec.crossable) return { state: "none", crossable: false, team: rival.name, text, rate: null, context: null };
  const context = rivalContexts.find((c) => c.kind === pattern.context.kind) ?? null;
  const rate = context ? hitRate(context.views.map(flipView), pattern.option) : null;
  return { state: rivalState(rate), crossable: true, team: rival.name, text, rate, context };
}

// --- Picks muy probables ------------------------------------------------------

export type Strength = "alta" | "media" | "baja";

export interface ProbablePick extends TeamPattern {
  rival: RivalCheck;
  /** Limite inferior de Wilson con los dos historiales juntos. */
  strengthScore: number;
  strength: Strength;
}

/** Fuerza: Alta si el rival lo respalda y, con los dos historiales juntos, el
 * limite inferior de Wilson es al menos 0.75; Media si es al menos 0.60 y el
 * rival no lo contradice; Baja en el resto. */
export function pickStrength(pattern: TeamPattern, rival: RivalCheck): { score: number; strength: Strength } {
  const crossed = rival.state !== "none" && rival.rate !== null;
  const hits = pattern.rate.hits + (crossed ? rival.rate!.hits : 0);
  const total = pattern.rate.total + (crossed ? rival.rate!.total : 0);
  const score = wilsonLower(hits, total);
  if (rival.state === "backed" && score >= STRONG_SCORE) return { score, strength: "alta" };
  if (rival.state !== "against" && score >= MEDIUM_SCORE) return { score, strength: "media" };
  return { score, strength: "baja" };
}

const STRENGTH_ORDER: Record<Strength, number> = { alta: 0, media: 1, baja: 2 };

/** Picks del partido: patrones de los dos equipos, contrastados con el rival,
 * de mas fuerte a mas debil. Un suceso del partido (goles, tarjetas...) que
 * sale en los dos equipos se queda una vez, con el mejor de los dos. */
export function probablePicks(
  match: Match,
  history: MatchResult[],
  max = MAX_PICKS,
  context: MatchResult[] = [],
): ProbablePick[] {
  const prior = priorMatches(match, history);
  return picksFromPrior(match, prior, leagueRates(prior), max, teamPrior(match, prior, context));
}

/** Partidos con los que se buscan los patrones de cada equipo. `context`: sus
 * partidos de otras competiciones (en la Champions, los de su liga). Solo
 * amplían los patrones de los equipos; la frecuencia en la competición sigue
 * saliendo de `prior`. */
function teamPrior(match: Match, prior: MatchResult[], context: MatchResult[]): MatchResult[] {
  return context.length ? priorMatches(match, [...prior, ...context]) : prior;
}

/** Los patrones de esas familias de los dos equipos, contrastados con el rival. */
function teamPicks(
  match: Match,
  prior: MatchResult[],
  rates: LeagueRates,
  families: FamilySpec[],
  forTeams: MatchResult[] = prior,
): ProbablePick[] {
  const sides = [
    { side: "home" as const, id: match.home_team_id, name: match.home_team },
    { side: "away" as const, id: match.away_team_id, name: match.away_team },
  ];
  const contexts = {
    home: teamContexts(forTeams, match.home_team_id, "home", match.season),
    away: teamContexts(forTeams, match.away_team_id, "away", match.season),
  };
  const picks: ProbablePick[] = [];
  for (const team of sides) {
    const rivalSide = team.side === "home" ? "away" : "home";
    const rival = sides.find((s) => s.side === rivalSide)!;
    for (const pattern of findTeamPatterns(contexts[team.side], team, rates, families)) {
      const check = checkRival(pattern, contexts[rivalSide], rival);
      const { score, strength } = pickStrength(pattern, check);
      picks.push({ ...pattern, rival: check, strengthScore: score, strength });
    }
  }
  return picks.sort(
    (a, b) => STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength] || b.strengthScore - a.strengthScore,
  );
}

/** Picks del duelo de córners (nuevos, aparte de los demás): los que ya
 * cumplen el umbral del motor, con su fuerza y el cruce con el rival. */
export function cornerDuelPicks(match: Match, history: MatchResult[], context: MatchResult[] = []): ProbablePick[] {
  const prior = priorMatches(match, history);
  return teamPicks(match, prior, leagueRates(prior), DUEL_FAMILIES, teamPrior(match, prior, context));
}

/** Picks de un partido a partir de sus partidos anteriores (ya filtrados, los
 * mas recientes primero) y de las frecuencias de la liga en esos partidos. */
function picksFromPrior(
  match: Match,
  prior: MatchResult[],
  rates: LeagueRates,
  max: number,
  forTeams: MatchResult[] = prior,
): ProbablePick[] {
  const ranked = teamPicks(match, prior, rates, FAMILIES, forTeams);
  const seen = new Set<string>();
  return ranked
    .filter((p) => {
      if (!p.matchLevel) return true;
      const key = `${p.family}|${p.option.key}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}

/** El pick habla de un mercado del bloque de probabilidades (1X2, más/menos
 * 2.5 goles, ambos marcan). */
export function isModelMarket(pick: Pick<TeamPattern, "family" | "option">): boolean {
  if (pick.family === "resultado") return pick.option.key !== "no-pierde";
  if (pick.family === "goles") return pick.option.key === "over-2.5" || pick.option.key === "under-2.5";
  return pick.family === "ambos-marcan";
}

// --- Arbitro-equipo -----------------------------------------------------------

export interface RefereeFact {
  side: "home" | "away";
  team: string;
  family: string;
  option: MarketOption;
  info: OptionInfo;
  matchLevel: boolean;
  rate: HitRate;
  score: number;
  smallSample: boolean;
  /** Media del arbitro en todos sus partidos, en sucesos del partido. */
  refereeAverage: { value: number; label: string; matches: number } | null;
}

/** Hechos arbitro-equipo: en los partidos de cada equipo con este arbitro, la
 * linea mas exigente de tarjetas y faltas que se ha cumplido al menos en el
 * 80 % (desde 3 partidos). `venueOnly`: solo los partidos en el campo de hoy. */
export function refereeFacts(
  match: Match,
  refereeMatches: MatchResult[],
  options: { venueOnly: boolean; history?: MatchResult[] | null },
  max = MAX_REFEREE_FACTS,
): RefereeFact[] {
  const prior = priorMatches(match, refereeMatches);
  const rates = options.history ? leagueRates(priorMatches(match, options.history)) : null;
  const allViews = prior.map((m) => viewFrom(m, "home")).filter((v): v is TeamMatchView => v !== null);
  const sides = [
    { side: "home" as const, id: match.home_team_id, name: match.home_team },
    { side: "away" as const, id: match.away_team_id, name: match.away_team },
  ];

  const facts: RefereeFact[] = [];
  for (const team of sides) {
    const views = teamViews(prior, team.id).filter((v) => !options.venueOnly || v.venue === team.side);
    for (const slug of REFEREE_FAMILIES) {
      const market = findMarket(slug);
      if (!market) continue;
      const matchLevel = FAMILIES.find((f) => f.slug === slug)!.side === "match";
      for (const ladder of ladders(market)) {
        let best: RefereeFact | null = null;
        for (const option of ladder) {
          const rate = hitRate(views, option);
          if (!passesRefereeRule(rate)) continue;
          const venue = options.venueOnly ? team.side : "all";
          if (isTrivial(rates ? rates(option, slug, venue) : null)) continue;
          const avg = matchLevel && market.average ? average(allViews, market.average.value) : null;
          best = {
            side: team.side,
            team: team.name,
            family: slug,
            option,
            info: optionInfo(option),
            matchLevel,
            rate,
            score: wilsonLower(rate.hits, rate.total),
            smallSample: rate.total < SMALL_REFEREE_SAMPLE,
            refereeAverage:
              avg !== null && market.average ? { value: avg, label: market.average.label, matches: allViews.length } : null,
          };
        }
        if (best) facts.push(best);
      }
    }
  }
  return facts.sort((a, b) => b.score - a.score).slice(0, max);
}

const STAT_NOUN: Record<string, string> = {
  "tarjetas-equipo": "tarjetas",
  tarjetas: "tarjetas",
  "faltas-equipo": "faltas",
  faltas: "faltas",
};
const TEAM_VERB: Record<string, [string, string]> = {
  "tarjetas-equipo": ["ha recibido", "siempre ha recibido"],
  "faltas-equipo": ["ha cometido", "siempre ha cometido"],
};

/** "Con este árbitro, Espanol siempre ha recibido más de 1.5 tarjetas (4 de 4
 * partidos)." / "...en 4 de 5 partidos." */
export function refereeFactText(fact: Pick<RefereeFact, "team" | "family" | "info" | "matchLevel" | "rate">): string {
  const { hits, total } = fact.rate;
  const always = hits === total;
  const noun = STAT_NOUN[fact.family];
  const amount = `${fact.info.dir === "over" ? "más" : "menos"} de ${fmt(fact.info.line!)} ${noun}`;
  const count = `${hits} de ${total} ${total === 1 ? "partido" : "partidos"}`;
  if (fact.matchLevel) {
    return always
      ? `Con este árbitro, siempre ha habido ${amount} en los partidos de ${fact.team} (${count}).`
      : `Con este árbitro, ha habido ${amount} en ${count} de ${fact.team}.`;
  }
  const [verb, alwaysVerb] = TEAM_VERB[fact.family];
  return always
    ? `Con este árbitro, ${fact.team} ${alwaysVerb} ${amount} (${count}).`
    : `Con este árbitro, ${fact.team} ${verb} ${amount} en ${count}.`;
}

// --- Comprobacion: ¿se cumplieron? ------------------------------------------

/** El pick, en el partido ya jugado: true si se cumplio, false si no y null
 * si al partido le falta el dato (ej. sin faltas registradas). */
export function pickOutcome(pick: Pick<TeamPattern, "side" | "option">, played: MatchResult): boolean | null {
  const view = viewFrom(played, pick.side);
  return view ? pick.option.hit(view) : null;
}

export interface PickResult {
  pick: ProbablePick;
  hit: boolean | null;
}

export interface MatchPicksResult {
  match: MatchResult;
  picks: PickResult[];
  /** Nuevo: picks del duelo de córners y su pronóstico, aparte de los demás. */
  duelPicks: PickResult[];
  duel: DuelForecast | null;
}

/** Frecuencias de la liga que crecen partido a partido: dan lo mismo que
 * leagueRates(anteriores), pero cada partido se cuenta una sola vez por suceso
 * en lugar de recontar toda la liga para cada partido. */
function growingLeagueRates() {
  const views = { home: [] as TeamMatchView[], away: [] as TeamMatchView[] };
  const counts = new Map<string, { hits: number; total: number; seen: { home: number; away: number } }>();
  const rates: LeagueRates = (option, family, venue) => {
    const key = `${family}|${option.key}|${venue}`;
    let count = counts.get(key);
    if (!count) counts.set(key, (count = { hits: 0, total: 0, seen: { home: 0, away: 0 } }));
    for (const side of venue === "all" ? (["home", "away"] as const) : [venue]) {
      const list = views[side];
      for (let i = count.seen[side]; i < list.length; i++) {
        const hit = option.hit(list[i]);
        if (hit === null) continue;
        count.total += 1;
        if (hit) count.hits += 1;
      }
      count.seen[side] = list.length;
    }
    return count.total ? count.hits / count.total : null;
  };
  const add = (m: MatchResult) => {
    const home = viewFrom(m, "home");
    const away = viewFrom(m, "away");
    if (home) views.home.push(home);
    if (away) views.away.push(away);
  };
  return { rates, add };
}

/** Los picks que la web habria mostrado antes de cada partido jugado y si se
 * cumplieron, uno a uno y en orden de fecha. Cada partido solo ve los
 * anteriores (fecha estrictamente menor), como en su ficha. `history`:
 * partidos de la liga de los que sacar los patrones (los jugados incluidos). */
export function* checkPlayedPicksSteps(played: MatchResult[], history: MatchResult[]): Generator<MatchPicksResult> {
  const targets = played.filter((m) => m.status === "historical");
  for (const { match, picks, duelPicks, duel } of picksInOrder(targets, history)) {
    const outcome = (pick: ProbablePick) => ({ pick, hit: pickOutcome(pick, match) });
    yield { match, picks: picks.map(outcome), duelPicks: duelPicks.map(outcome), duel };
  }
}

/** Picks de varios partidos en orden de fecha: cada uno solo ve los partidos
 * jugados con fecha estrictamente anterior (como en su ficha) y las
 * frecuencias de la liga se acumulan en lugar de recontarse. */
interface InOrder<T> {
  match: T;
  picks: ProbablePick[];
  duelPicks: ProbablePick[];
  duel: DuelForecast | null;
}

function* picksInOrder<T extends Match>(targets: T[], history: MatchResult[]): Generator<InOrder<T>> {
  const time = (m: Match) => Date.parse(m.date);
  const pool = history.filter((m) => m.status === "historical").sort((a, b) => time(a) - time(b));
  const league = growingLeagueRates();
  let next = 0;
  for (const match of [...targets].sort((a, b) => time(a) - time(b))) {
    const cutoff = time(match);
    while (next < pool.length && time(pool[next]) < cutoff) league.add(pool[next++]);
    const prior = pool.slice(0, next).reverse();
    yield {
      match,
      picks: picksFromPrior(match, prior, league.rates, MAX_PICKS),
      duelPicks: teamPicks(match, prior, league.rates, DUEL_FAMILIES),
      duel: cornerDuelForecast(match, prior),
    };
  }
}

/** Picks de los partidos aun por jugar (los de su ficha), en orden de fecha. */
export function upcomingPicks<T extends Match>(matches: T[], history: MatchResult[]): InOrder<T>[] {
  return [...picksInOrder(matches.filter((m) => m.status === "scheduled"), history)];
}

export function checkPlayedPicks(played: MatchResult[], history: MatchResult[]): MatchPicksResult[] {
  return [...checkPlayedPicksSteps(played, history)];
}

export interface PicksSummary {
  /** Picks con dato para decidir si se cumplieron. */
  total: number;
  hits: number;
  /** Sin dato en el partido: no cuentan. */
  undecided: number;
  rate: number | null;
  /** Intervalo de Wilson al 95 % del acierto. */
  low: number | null;
  high: number | null;
  /** Lo esperable si estos equipos no tuvieran nada especial: la media de la
   * frecuencia en la liga de esos mismos sucesos. */
  expected: number | null;
}

/** Limite superior de Wilson al 95 %. */
function wilsonUpper(hits: number, n: number, z = 1.96): number {
  return n === 0 ? 0 : 1 - wilsonLower(n - hits, n, z);
}

/** Acierto de un conjunto de picks, contra lo habitual en la liga. */
export function summarizePicks(results: PickResult[]): PicksSummary {
  const decided = results.filter((r) => r.hit !== null);
  const hits = decided.filter((r) => r.hit).length;
  const withLeague = decided.filter((r) => r.pick.leagueRate !== null);
  const total = decided.length;
  return {
    total,
    hits,
    undecided: results.length - total,
    rate: total ? hits / total : null,
    low: total ? wilsonLower(hits, total) : null,
    high: total ? wilsonUpper(hits, total) : null,
    expected: withLeague.length
      ? withLeague.reduce((sum, r) => sum + (r.pick.leagueRate ?? 0), 0) / withLeague.length
      : null,
  };
}

/** Resumen total y por nivel de fuerza. */
export function summarizeByStrength(matches: MatchPicksResult[]): Record<Strength | "total", PicksSummary> {
  const all = matches.flatMap((m) => m.picks);
  return {
    total: summarizePicks(all),
    alta: summarizePicks(all.filter((r) => r.pick.strength === "alta")),
    media: summarizePicks(all.filter((r) => r.pick.strength === "media")),
    baja: summarizePicks(all.filter((r) => r.pick.strength === "baja")),
  };
}

// --- Acierto por equipo ---------------------------------------------------------

/** Con menos picks que esto en la columna elegida, un equipo va al final de la
 * clasificacion: un "2 de 2" no dice nada. */
export const MIN_TEAM_PICKS = 10;

export interface TeamPicksRecord {
  teamId: number;
  team: string;
  alta: PicksSummary;
  media: PicksSummary;
  /** Alta y media juntas. */
  top: PicksSummary;
}

/** Acierto de los picks de cada equipo: los que salen de su propio historial
 * (los del rival en sus partidos cuentan para el rival). */
export function summarizeByTeam(matches: MatchPicksResult[]): TeamPicksRecord[] {
  const byTeam = new Map<number, { team: string; picks: PickResult[] }>();
  for (const { picks } of matches) {
    for (const result of picks) {
      const entry = byTeam.get(result.pick.teamId) ?? { team: result.pick.team, picks: [] };
      entry.picks.push(result);
      byTeam.set(result.pick.teamId, entry);
    }
  }
  return [...byTeam.entries()].map(([teamId, { team, picks }]) => ({
    teamId,
    team,
    alta: summarizePicks(picks.filter((r) => r.pick.strength === "alta")),
    media: summarizePicks(picks.filter((r) => r.pick.strength === "media")),
    top: summarizePicks(picks.filter((r) => r.pick.strength !== "baja")),
  }));
}

export type TeamRankKey = "top" | "alta" | "media";

/** De mas a menos acierto en la columna elegida; los que no llegan a
 * MIN_TEAM_PICKS en esa columna, al final (entre ellos, tambien por acierto). */
export function rankTeams(records: TeamPicksRecord[], key: TeamRankKey): TeamPicksRecord[] {
  const enough = (r: TeamPicksRecord) => (r[key].total >= MIN_TEAM_PICKS ? 1 : 0);
  return [...records].sort(
    (a, b) =>
      enough(b) - enough(a) ||
      (b[key].rate ?? -1) - (a[key].rate ?? -1) ||
      b[key].total - a[key].total ||
      a.team.localeCompare(b.team, "es"),
  );
}
