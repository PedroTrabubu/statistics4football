/** Ampliación 2 de docs/PREDICTOR_ESTADISTICAS_PROTOCOLO.md: buscar un modelo
 * mejor que el publicado, con el código de la web (src/lib/statsPredictor.ts).
 *
 * Validación (elige un candidato por estadística y lo guarda en `--out`):
 *   npm run backtest:search -- --mode validation --out ../data/reports/predictor_elegido.json
 * Test (una sola vez, con lo elegido):
 *   npm run backtest:search -- --mode test --chosen ../data/reports/predictor_elegido.json
 *
 * Cada partido solo ve los partidos de la liga anteriores a su fecha, de su
 * temporada y la anterior. Todos los candidatos, con las mismas observaciones.
 */

import { readFileSync, writeFileSync } from "node:fs";
import type { League, MatchResult } from "../src/api/types";
import {
  CARD_KEYS,
  cardsForecastWith,
  PUBLISHED,
  refereeFactor,
  statForecastWith,
  statValue,
  STAT_KEYS,
  type CardKey,
  type CardSettings,
  type ModelSettings,
  type StatForecast,
  type StatKey,
} from "../src/lib/statsPredictor";
import {
  arg,
  baselines,
  BOOTSTRAP_SEED,
  bootstrap,
  ci,
  fmt,
  get,
  LEAGUES,
  previousSeason,
  score,
  seeded,
  type MatchErrors,
} from "./backtest-shared";

const XG_LEAGUES = new Set(["ENG-Premier League", "ESP-La Liga", "FRA-Ligue 1", "GER-Bundesliga", "ITA-Serie A"]);
const LABEL: Record<StatKey, string> = {
  xg: "xG",
  shots: "Tiros",
  shots_on_target: "Tiros a puerta",
  corners: "Córners",
  fouls: "Faltas",
  yellow_cards: "Amarillas",
  red_cards: "Rojas",
};
const isCard = (key: StatKey): key is CardKey => (CARD_KEYS as StatKey[]).includes(key);

/** Las 36 configuraciones del modelo de equipos. */
const CONFIGS: ModelSettings[] = (["venue", "pooled", "blend"] as const).flatMap((structure) =>
  [0.0009, 0.0018, 0.0036].flatMap((decay) => [2, 5, 10, 20].map((shrink) => ({ structure, decay, shrink }))),
);
const REFEREE_K = [5, 10, 20];

/** Candidato: una configuración (y, en tarjetas, el árbitro) con su nombre. */
interface Candidate {
  id: string;
  settings: CardSettings;
}
const configId = (c: ModelSettings) => `${c.structure}|${c.decay}|${c.shrink}`;
const PUBLISHED_ID = configId(PUBLISHED);

function candidatesFor(key: StatKey): Candidate[] {
  const plain = CONFIGS.map((c) => ({ id: configId(c), settings: { base: c, referee: null } }));
  if (!isCard(key)) return plain;
  return [
    ...plain,
    ...CONFIGS.flatMap((c) =>
      REFEREE_K.map((k) => ({ id: `${configId(c)}|R2:${k}`, settings: { base: c, referee: { method: "adjusted", shrink: k } } })),
    ),
    ...REFEREE_K.map((k) => ({ id: `league|R1:${k}`, settings: { base: "league", referee: { method: "raw", shrink: k } } })),
  ] as Candidate[];
}

interface Season {
  league: League;
  season: string;
  current: MatchResult[];
  window: MatchResult[];
}

async function load(seasons: string[]): Promise<Season[]> {
  // Primero todos los datos: el cálculo tarda tanto que el backend cerraría la
  // conexión entre una petición y la siguiente.
  const leagues = (await get<League[]>("/leagues")).filter((l) => LEAGUES.includes(l.code));
  const out: Season[] = [];
  for (const league of leagues) {
    for (const season of seasons) {
      const [current, previous] = await Promise.all([
        get<MatchResult[]>(`/leagues/${league.id}/results?season=${season}`),
        get<MatchResult[]>(`/leagues/${league.id}/results?season=${previousSeason(season)}`),
      ]);
      out.push({ league, season, current, window: [...current, ...previous] });
    }
  }
  return out;
}

type Pair = { home: number; away: number };

/** Lo que estima cada candidato para un partido (null si alguno no puede: el
 * partido no entra para esa estadística). En tarjetas, base × factor, que es lo
 * que hace cardsForecastWith (ver su test). */
function forecasts(match: MatchResult, window: MatchResult[], key: StatKey, candidates: Candidate[]): Map<string, Pair> | null {
  const base = new Map<string, StatForecast | null>(CONFIGS.map((c) => [configId(c), statForecastWith(match, window, key, c)]));
  const out = new Map<string, Pair>();
  const factors = new Map<string, number | null>();
  const factor = (method: "raw" | "adjusted", shrink: number) => {
    const id = `${method}:${shrink}`;
    if (!factors.has(id)) factors.set(id, refereeFactor(match, window, key as CardKey, { method, shrink })?.factor ?? null);
    return factors.get(id)!;
  };
  for (const c of candidates) {
    const { base: b, referee } = c.settings;
    if (b === "league") {
      const f = cardsForecastWith(match, window, key as CardKey, c.settings);
      if (!f) return null;
      out.set(c.id, f);
      continue;
    }
    const plain = base.get(configId(b));
    if (!plain) return null;
    const k = referee ? factor(referee.method, referee.shrink) : 1;
    if (k === null) return null;
    out.set(c.id, { home: plain.home * k, away: plain.away * k });
  }
  return out;
}

function parseId(id: string): CardSettings {
  const parts = id.split("|");
  if (parts[0] === "league") {
    const [, ref] = parts;
    return { base: "league", referee: { method: "raw", shrink: Number(ref.split(":")[1]) } };
  }
  const [structure, decay, shrink, ref] = parts;
  return {
    base: { structure: structure as ModelSettings["structure"], decay: Number(decay), shrink: Number(shrink) },
    referee: ref ? { method: "adjusted", shrink: Number(ref.split(":")[1]) } : null,
  };
}

async function validation() {
  const seasons = (arg("seasons") ?? "2223,2324,2425").split(",");
  const data = await load(seasons);
  const sums = new Map<StatKey, Map<string, { abs: number; n: number }>>(STAT_KEYS.map((k) => [k, new Map()]));
  const league = new Map<StatKey, { abs: number; n: number }>(STAT_KEYS.map((k) => [k, { abs: 0, n: 0 }]));
  let matchCount = 0;

  for (const { league: l, current, window } of data) {
    for (const match of current) {
      matchCount += 1;
      const at = Date.parse(match.date);
      for (const key of STAT_KEYS) {
        if (key === "xg" && !XG_LEAGUES.has(l.code)) continue;
        const candidates = candidatesFor(key);
        const f = forecasts(match, window, key, candidates);
        if (!f) continue;
        const base = baselines(window, key, at, match.home_team_id, match.away_team_id);
        for (const side of ["home", "away"] as const) {
          const observed = statValue(side === "home" ? match.home_stats : match.away_stats, key);
          const leagueMean = side === "home" ? base.leagueHome : base.leagueAway;
          if (observed === null || leagueMean === null) continue;
          const lg = league.get(key)!;
          lg.abs += Math.abs(observed - leagueMean);
          lg.n += 1;
          for (const c of candidates) {
            const s = sums.get(key)!.get(c.id) ?? { abs: 0, n: 0 };
            s.abs += Math.abs(observed - f.get(c.id)![side]);
            s.n += 1;
            sums.get(key)!.set(c.id, s);
          }
        }
      }
    }
  }

  const chosen: Record<string, string> = {};
  const out = [`Validación. Temporadas ${seasons.join(", ")}; seis ligas; ${matchCount} partidos.`, ""];
  out.push("| Estadística | Obs. | Liga (a) | Publicado | Elegido | MAE elegido | 2.º | 3.º |", "|---|---:|---:|---:|---|---:|---|---|");
  for (const key of STAT_KEYS) {
    const ranked = [...sums.get(key)!.entries()].map(([id, s]) => ({ id, mae: s.abs / s.n, n: s.n })).sort((a, b) => a.mae - b.mae);
    if (!ranked.length) continue;
    chosen[key] = ranked[0].id;
    const lg = league.get(key)!;
    const published = ranked.find((r) => r.id === PUBLISHED_ID)!;
    out.push(
      `| ${LABEL[key]} | ${ranked[0].n} | ${fmt(lg.abs / lg.n, 4)} | ${fmt(published.mae, 4)} | \`${ranked[0].id}\` | ${fmt(ranked[0].mae, 4)} | ` +
        `\`${ranked[1].id}\` ${fmt(ranked[1].mae, 4)} | \`${ranked[2].id}\` ${fmt(ranked[2].mae, 4)} |`,
    );
  }
  const file = arg("out");
  if (file) writeFileSync(file, JSON.stringify(chosen, null, 2) + "\n");
  out.push("", "```json", JSON.stringify(chosen, null, 2), "```");
  console.log(out.join("\n"));
}

async function test() {
  const seasons = (arg("seasons") ?? "2526,2627").split(",");
  const chosen = JSON.parse(readFileSync(arg("chosen")!, "utf8")) as Record<StatKey, string>;
  const data = await load(seasons);
  const errors = new Map<StatKey, MatchErrors[]>(STAT_KEYS.map((k) => [k, []]));
  /** Qué equipo saca más: aciertos del elegido, del publicado y de "siempre el local". */
  const direction = new Map<StatKey, { model: number; published: number; home: number; n: number }>(
    STAT_KEYS.map((k) => [k, { model: 0, published: 0, home: 0, n: 0 }]),
  );
  /** Errores absolutos del elegido, para ver cuántos caen dentro de ±MAE. */
  const absolute = new Map<StatKey, number[]>(STAT_KEYS.map((k) => [k, []]));
  let matchCount = 0;

  for (const { league, season, current, window } of data) {
    for (const match of current) {
      matchCount += 1;
      const at = Date.parse(match.date);
      for (const key of STAT_KEYS) {
        if (key === "xg" && !XG_LEAGUES.has(league.code)) continue;
        // El elegido, con el código de la web tal cual.
        const settings = parseId(chosen[key]);
        const model = isCard(key)
          ? cardsForecastWith(match, window, key, settings)
          : statForecastWith(match, window, key, settings.base as ModelSettings);
        const published = statForecastWith(match, window, key, PUBLISHED);
        if (!model || !published) continue;
        const base = baselines(window, key, at, match.home_team_id, match.away_team_id);
        const row: MatchErrors = { league: league.code, season, errors: { model: [], published: [], league: [], team: [] } };
        const observed = { home: statValue(match.home_stats, key), away: statValue(match.away_stats, key) };
        for (const side of ["home", "away"] as const) {
          const leagueMean = side === "home" ? base.leagueHome : base.leagueAway;
          const teamMean = side === "home" ? base.teamHome : base.teamAway;
          const o = observed[side];
          if (o === null || leagueMean === null || teamMean === null) continue;
          row.errors.model.push(Math.abs(o - model[side]));
          row.errors.published.push(Math.abs(o - published[side]));
          row.errors.league.push(Math.abs(o - leagueMean));
          row.errors.team.push(Math.abs(o - teamMean));
          absolute.get(key)!.push(Math.abs(o - model[side]));
        }
        if (row.errors.model.length) errors.get(key)!.push(row);
        if (observed.home !== null && observed.away !== null && observed.home !== observed.away) {
          const d = direction.get(key)!;
          const homeMore = observed.home > observed.away;
          d.n += 1;
          if (model.home > model.away === homeMore) d.model += 1;
          if (published.home > published.away === homeMore) d.published += 1;
          if (homeMore) d.home += 1;
        }
      }
    }
  }

  const random = seeded(BOOTSTRAP_SEED);
  const pct = (x: number) => `${fmt(100 * x, 1)} %`;
  const evaluation: Record<string, { candidate: string; replaces: boolean; shown: boolean; mae: number; vsLeague: number }> = {};
  const out = [`Test. Temporadas ${seasons.join(", ")}; seis ligas; ${matchCount} partidos.`, ""];
  out.push(
    "| Estadística | Elegido | Obs. | MAE elegido | MAE publicado (c) | MAE liga (a) | MAE equipo (b) | Elegido − publicado [IC 95 %] | Elegido − liga [IC 95 %] | Elegido − equipo [IC 95 %] | Mejora vs liga | Decisión |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  );
  for (const key of STAT_KEYS) {
    const rows = errors.get(key)!;
    if (!rows.length) continue;
    const m = score(rows, "model");
    const c = score(rows, "published");
    const a = score(rows, "league");
    const b = score(rows, "team");
    const vsPublished = bootstrap(rows, "model", "published", random);
    const vsLeague = bootstrap(rows, "model", "league", random);
    const vsTeam = bootstrap(rows, "model", "team", random);
    const passes = m.mae < a.mae && m.mae < b.mae && vsLeague[1] < 0 && vsTeam[1] < 0;
    const replaces = chosen[key] !== PUBLISHED_ID && m.mae < c.mae && vsPublished[1] < 0;
    // xG..faltas: el elegido solo entra si mejora al publicado. Tarjetas: si pasa la regla de siempre.
    const decision = isCard(key) ? (passes ? "Aparece" : "No aparece") : replaces ? "Sustituye" : "Se queda el publicado";
    evaluation[key] = { candidate: chosen[key], replaces, shown: isCard(key) ? passes : true, mae: m.mae, vsLeague: (a.mae - m.mae) / a.mae };
    out.push(
      `| ${LABEL[key]} | \`${chosen[key]}\` | ${m.n} | ${fmt(m.mae, 3)} | ${fmt(c.mae, 3)} | ${fmt(a.mae, 3)} | ${fmt(b.mae, 3)} | ` +
        `${fmt(m.mae - c.mae, 3)} ${ci(vsPublished, 3)} | ${fmt(m.mae - a.mae, 3)} ${ci(vsLeague, 3)} | ${fmt(m.mae - b.mae, 3)} ${ci(vsTeam, 3)} | ` +
        `${fmt((100 * (a.mae - m.mae)) / a.mae, 1)} % | ${decision} |`,
    );
  }

  out.push("", "Solo informativo:", "", "| Estadística | Dentro de ±MAE | Qué equipo saca más: elegido / publicado / siempre el local (partidos) |", "|---|---:|---:|");
  for (const key of STAT_KEYS) {
    const abs = absolute.get(key)!;
    if (!abs.length) continue;
    const mae = abs.reduce((s, x) => s + x, 0) / abs.length;
    const d = direction.get(key)!;
    out.push(
      `| ${LABEL[key]} | ${pct(abs.filter((x) => x <= mae).length / abs.length)} | ` +
        `${pct(d.model / d.n)} / ${pct(d.published / d.n)} / ${pct(d.home / d.n)} (${d.n}) |`,
    );
  }

  out.push("", `| Por liga (elegido / publicado / liga) | ${STAT_KEYS.map((k) => LABEL[k]).join(" | ")} |`, `|---|${STAT_KEYS.map(() => "---:").join("|")}|`);
  for (const code of LEAGUES) {
    const cells = STAT_KEYS.map((key) => {
      const rows = errors.get(key)!.filter((r) => r.league === code);
      return rows.length ? ["model", "published", "league"].map((x) => fmt(score(rows, x).mae, 3)).join(" / ") : "—";
    });
    out.push(`| ${code} | ${cells.join(" | ")} |`);
  }
  out.push("", "```json", JSON.stringify(evaluation, null, 2), "```");
  console.log(out.join("\n"));
}

const mode = arg("mode");
(mode === "validation" ? validation() : mode === "test" ? test() : Promise.reject(new Error("--mode validation | test"))).catch(
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
