/** Prueba con partidos futuros del predictor de estadísticas (final de la
 * ampliación 2 de docs/PREDICTOR_ESTADISTICAS_PROTOCOLO.md): la única sin
 * ninguna mirada previa.
 *
 * Guardar lo que estima la web (MODEL) para los partidos de los próximos días,
 * con la fecha en que se estimó:
 *   npm run prospective:stats -- --mode save
 * Comparar, cuando ya se hayan jugado, con lo que pasó y con la media de la liga:
 *   npm run prospective:stats -- --mode score
 *
 * Cada partido cuenta con la última estimación guardada antes de empezar.
 * Los ficheros van a data/reports/predicciones_estadisticas/ (fuera de git).
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { League, MatchResult, UpcomingMatch } from "../src/api/types";
import { EVALUATION, MODEL, predictStats, statValue, STAT_KEYS, type StatKey } from "../src/lib/statsPredictor";
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

const DIR = resolve(process.cwd(), "..", "data", "reports", "predicciones_estadisticas");
const DAYS_AHEAD = 7;

interface Saved {
  generatedAt: string;
  model: typeof MODEL;
  matches: {
    id: number;
    league: string;
    season: string;
    date: string;
    home: string;
    away: string;
    referee: string | null;
    predictions: Partial<Record<StatKey, { home: number; away: number }>>;
  }[];
}

async function leagues(): Promise<League[]> {
  return (await get<League[]>("/leagues")).filter((l) => LEAGUES.includes(l.code));
}

async function save() {
  const now = new Date();
  const out: Saved = { generatedAt: now.toISOString(), model: MODEL, matches: [] };
  for (const league of await leagues()) {
    const upcoming = (await get<UpcomingMatch[]>(`/leagues/${league.id}/upcoming?days=${DAYS_AHEAD}`)).filter(
      (m) => m.status === "scheduled" && Date.parse(`${m.date}Z`) > now.getTime(),
    );
    const windows = new Map<string, MatchResult[]>();
    for (const match of upcoming) {
      if (!windows.has(match.season)) {
        const [current, previous] = await Promise.all([
          get<MatchResult[]>(`/leagues/${league.id}/results?season=${match.season}`),
          get<MatchResult[]>(`/leagues/${league.id}/results?season=${previousSeason(match.season)}`),
        ]);
        windows.set(match.season, [...current, ...previous]);
      }
      const forecasts = predictStats(match, windows.get(match.season)!);
      const predictions: Saved["matches"][number]["predictions"] = {};
      // Solo las estadísticas que da la web.
      for (const key of STAT_KEYS) {
        const f = forecasts[key];
        if (EVALUATION[key].shown && f) predictions[key] = { home: f.home, away: f.away };
      }
      out.matches.push({
        id: match.id,
        league: league.code,
        season: match.season,
        date: match.date,
        home: match.home_team,
        away: match.away_team,
        referee: match.referee,
        predictions,
      });
    }
  }
  mkdirSync(DIR, { recursive: true });
  const file = join(DIR, `${out.generatedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`${out.matches.length} partidos guardados en ${file}`);
}

async function scoreSaved() {
  let files: string[] = [];
  try {
    files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
  } catch {
    // Sin carpeta todavía: no hay nada guardado.
  }
  const saved = files.map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as Saved);
  // Para cada partido, la última estimación guardada antes de empezar.
  const latest = new Map<number, { generatedAt: string; entry: Saved["matches"][number] }>();
  for (const s of saved) {
    for (const entry of s.matches) {
      if (Date.parse(s.generatedAt) >= Date.parse(`${entry.date}Z`)) continue;
      const known = latest.get(entry.id);
      if (!known || known.generatedAt < s.generatedAt) latest.set(entry.id, { generatedAt: s.generatedAt, entry });
    }
  }

  const byLeague = new Map((await leagues()).map((l) => [l.code, l]));
  const windows = new Map<string, MatchResult[]>();
  const errors = new Map<StatKey, MatchErrors[]>(STAT_KEYS.map((k) => [k, []]));
  let played = 0;
  for (const { entry } of latest.values()) {
    const league = byLeague.get(entry.league);
    if (!league) continue;
    const key = `${league.id}|${entry.season}`;
    if (!windows.has(key)) {
      const [current, previous] = await Promise.all([
        get<MatchResult[]>(`/leagues/${league.id}/results?season=${entry.season}`),
        get<MatchResult[]>(`/leagues/${league.id}/results?season=${previousSeason(entry.season)}`),
      ]);
      windows.set(key, [...current, ...previous]);
    }
    const window = windows.get(key)!;
    const match = window.find((m) => m.id === entry.id && m.status === "historical");
    if (!match) continue;
    played += 1;
    const at = Date.parse(match.date);
    for (const stat of STAT_KEYS) {
      const p = entry.predictions[stat];
      if (!p) continue;
      const base = baselines(window, stat, at, match.home_team_id, match.away_team_id);
      const row: MatchErrors = { league: entry.league, season: entry.season, errors: { model: [], league: [] } };
      for (const side of ["home", "away"] as const) {
        const observed = statValue(side === "home" ? match.home_stats : match.away_stats, stat);
        const leagueMean = side === "home" ? base.leagueHome : base.leagueAway;
        if (observed === null || leagueMean === null) continue;
        row.errors.model.push(Math.abs(observed - p[side]));
        row.errors.league.push(Math.abs(observed - leagueMean));
      }
      if (row.errors.model.length) errors.get(stat)!.push(row);
    }
  }

  const random = seeded(BOOTSTRAP_SEED);
  const out = [
    `${files.length} ficheros, ${latest.size} partidos estimados, ${played} ya jugados.`,
    "",
    "| Estadística | Obs. | MAE predictor | MAE liga (a) | Predictor − liga [IC 95 %] | MAE del test |",
    "|---|---:|---:|---:|---:|---:|",
  ];
  for (const stat of STAT_KEYS) {
    const rows = errors.get(stat)!;
    if (rows.length < 2) continue;
    const m = score(rows, "model");
    const a = score(rows, "league");
    out.push(
      `| ${stat} | ${m.n} | ${fmt(m.mae, 3)} | ${fmt(a.mae, 3)} | ${fmt(m.mae - a.mae, 3)} ${ci(bootstrap(rows, "model", "league", random), 3)} | ${fmt(EVALUATION[stat].mae, 3)} |`,
    );
  }
  console.log(out.join("\n"));
}

const mode = arg("mode");
(mode === "save" ? save() : mode === "score" ? scoreSaved() : Promise.reject(new Error("--mode save | score"))).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
