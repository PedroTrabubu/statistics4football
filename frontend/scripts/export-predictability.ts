/** Exporta a CSV, por partido jugado, las variables del indice de
 * predecibilidad y su variable objetivo (exceso de acierto de sus picks sobre
 * la liga), con el motor de la web tal cual (src/lib/patterns.ts y
 * src/lib/predictability.ts). Protocolo: docs/PREDECIBILIDAD_PROTOCOLO.md.
 *
 * Mismos datos que la pagina de picks probables: cada partido solo ve los
 * anteriores de su liga, de su temporada y la anterior. Sin la Champions (no
 * calibrada). El modelo lo entrena backend/scripts/report_predictability.py.
 *
 * Uso, con el backend en marcha (desde frontend/):
 *   npm run export:predictability
 *   npm run export:predictability -- --seasons 2526 --leagues "ESP-La Liga"
 * API_URL cambia la dirección del backend (por defecto http://127.0.0.1:8000).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { League, MatchResult } from "../src/api/types";
import { checkPlayedPicksSteps, priorMatches } from "../src/lib/patterns";
import { FEATURES, isCalibratedLeague, matchExcess, matchFeatures } from "../src/lib/predictability";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";
const SEASONS = ["2526", "2627"];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(new URL(path, API_URL));
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} — ${path}`);
  return (await response.json()) as T;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const COLUMNS = ["league", "season", "match_id", "date", "home_team", "away_team", "picks", "hits", "expected", "excess", ...FEATURES];

async function main() {
  const seasons = arg("seasons")?.split(",").map((s) => s.trim()) ?? SEASONS;
  const only = arg("leagues")?.split(",").map((s) => s.trim());
  const out = resolve(arg("out") ?? "../data/reports/predictability_matches.csv");

  const leagues = (await get<League[]>("/leagues")).filter(
    (l) => isCalibratedLeague(l.code) && (!only || only.includes(l.code)),
  );
  const rows: string[] = [COLUMNS.join(",")];
  for (const league of leagues) {
    const available = await get<string[]>(`/leagues/${league.id}/seasons`);
    for (const season of seasons) {
      const i = available.indexOf(season);
      if (i < 0) continue;
      const played = await get<MatchResult[]>(`/leagues/${league.id}/results?season=${season}`);
      const before = available[i + 1]
        ? await get<MatchResult[]>(`/leagues/${league.id}/results?season=${available[i + 1]}`)
        : [];
      const history = [...played, ...before];
      let count = 0;
      for (const { match, picks } of checkPlayedPicksSteps(played, history)) {
        const features = matchFeatures(match, picks.map((r) => r.pick), priorMatches(match, history));
        const target = matchExcess(picks);
        const row: Record<string, unknown> = {
          league: league.code,
          season,
          match_id: match.id,
          date: match.date,
          home_team: match.home_team,
          away_team: match.away_team,
          picks: target.picks,
          hits: target.hits,
          expected: target.expected.toFixed(6),
          excess: target.excess === null ? null : target.excess.toFixed(6),
          ...features,
        };
        rows.push(COLUMNS.map((c) => csvCell(row[c])).join(","));
        count += 1;
      }
      console.log(`${league.code} ${season}: ${count} partidos`);
    }
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, rows.join("\n") + "\n", "utf-8");
  console.log(`${rows.length - 1} partidos -> ${out}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
