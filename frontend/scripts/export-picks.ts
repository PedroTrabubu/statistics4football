/** Exporta a CSV los "Picks muy probables" de los partidos ya jugados, con el
 * motor de la web (src/lib/patterns.ts) tal cual, para medirlos fuera de la
 * web contra el mercado (backend/scripts/report_picks_vs_pinnacle.py).
 *
 * Mismos datos que la página de picks probables: para cada liga y temporada,
 * los partidos jugados de la temporada y, como historial, esos mismos más los
 * de la temporada anterior. Cada partido solo ve los anteriores a su fecha.
 *
 * Uso, con el backend en marcha (desde frontend/):
 *   npm run export:picks
 *   npm run export:picks -- --seasons 2526,2627 --out ../data/reports/picks.csv
 * API_URL cambia la dirección del backend (por defecto http://127.0.0.1:8000).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { League, MatchResult } from "../src/api/types";
import { checkPlayedPicksSteps } from "../src/lib/patterns";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";
/** Desde la 21/22: la 20/21 es la primera de la base y no tiene temporada anterior. */
const FIRST_SEASON = "2122";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(new URL(path, API_URL));
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} — ${path}`);
  return (await response.json()) as T;
}

/** "2526" -> "2425". */
function previousSeason(season: string): string {
  const start = Number(season.slice(0, 2)) - 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(start)}${pad(start + 1)}`;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const COLUMNS = [
  "league",
  "season",
  "match_id",
  "date",
  "matchday",
  "home_team",
  "away_team",
  "side",
  "team_id",
  "team",
  "family",
  "option",
  "dir",
  "line",
  "text",
  "strength",
  "strength_score",
  "league_rate",
  "rival_state",
  "pattern_hits",
  "pattern_total",
  "hit",
] as const;

async function main() {
  const wanted = arg("seasons")?.split(",").map((s) => s.trim());
  const out = resolve(arg("out") ?? "../data/reports/picks_probables.csv");

  const leagues = await get<League[]>("/leagues");
  const rows: string[] = [COLUMNS.join(",")];
  let picks = 0;
  for (const league of leagues) {
    const seasons = (await get<string[]>(`/leagues/${league.id}/seasons`))
      .filter((s) => (wanted ? wanted.includes(s) : s >= FIRST_SEASON))
      .sort();
    for (const season of seasons) {
      const played = await get<MatchResult[]>(`/leagues/${league.id}/results?season=${season}`);
      const before = await get<MatchResult[]>(`/leagues/${league.id}/results?season=${previousSeason(season)}`).catch(
        () => [] as MatchResult[],
      );
      let count = 0;
      for (const { match, picks: results } of checkPlayedPicksSteps(played, [...played, ...before])) {
        for (const { pick, hit } of results) {
          const row: Record<(typeof COLUMNS)[number], unknown> = {
            league: league.code,
            season,
            match_id: match.id,
            date: match.date,
            matchday: match.matchday,
            home_team: match.home_team,
            away_team: match.away_team,
            side: pick.side,
            team_id: pick.teamId,
            team: pick.team,
            family: pick.family,
            option: pick.option.key,
            dir: pick.info.dir,
            line: pick.info.line,
            text: pick.text,
            strength: pick.strength,
            strength_score: pick.strengthScore.toFixed(4),
            league_rate: pick.leagueRate === null ? null : pick.leagueRate.toFixed(4),
            rival_state: pick.rival.state,
            pattern_hits: pick.rate.hits,
            pattern_total: pick.rate.total,
            hit: hit === null ? null : hit ? 1 : 0,
          };
          rows.push(COLUMNS.map((c) => csvCell(row[c])).join(","));
          count += 1;
        }
      }
      picks += count;
      console.log(`${league.code} ${season}: ${played.length} partidos, ${count} picks`);
    }
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, rows.join("\n") + "\n", "utf-8");
  console.log(`${picks} picks -> ${out}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
