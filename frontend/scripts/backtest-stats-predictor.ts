/** Evaluación del predictor de estadísticas (docs/PREDICTOR_ESTADISTICAS_PROTOCOLO.md)
 * con el modelo de la web (src/lib/statsPredictor.ts) tal cual.
 *
 * Para cada liga y temporada: cada partido jugado, solo con los partidos de la
 * liga anteriores a su fecha, de su temporada y la anterior (lo que carga la
 * ficha). Error absoluto del modelo y de dos bases: (a) la media simple de la
 * liga para un local o un visitante y (b) la media simple del equipo en ese
 * campo (la de la liga si no tiene partidos). Intervalo de la diferencia de MAE
 * remuestreando partidos.
 *
 * Uso, con el backend en marcha (desde frontend/):
 *   npm run backtest:stats
 *   npm run backtest:stats -- --seasons 2223
 * API_URL cambia la dirección del backend (por defecto http://127.0.0.1:8000).
 */

import type { League, MatchResult } from "../src/api/types";
import { statForecast, statValue, STAT_KEYS, type StatKey } from "../src/lib/statsPredictor";
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

/** Las que tienen xG (Understat). */
const XG_LEAGUES = new Set(["ENG-Premier League", "ESP-La Liga", "FRA-Ligue 1", "GER-Bundesliga", "ITA-Serie A"]);

const DIGITS: Record<StatKey, number> = {
  xg: 3,
  shots: 2,
  shots_on_target: 2,
  corners: 2,
  fouls: 2,
  yellow_cards: 3,
  red_cards: 3,
};
const LABEL: Record<StatKey, string> = {
  xg: "xG",
  shots: "Tiros",
  shots_on_target: "Tiros a puerta",
  corners: "Córners",
  fouls: "Faltas",
  yellow_cards: "Amarillas",
  red_cards: "Rojas",
};

async function main() {
  const seasons = (arg("seasons") ?? "2526,2627").split(",");
  const leagues = (await get<League[]>("/leagues")).filter((l) => LEAGUES.includes(l.code));
  const errors = new Map<StatKey, MatchErrors[]>(STAT_KEYS.map((k) => [k, []]));
  let matchCount = 0;

  for (const league of leagues) {
    for (const season of seasons) {
      const [current, previous] = await Promise.all([
        get<MatchResult[]>(`/leagues/${league.id}/results?season=${season}`),
        get<MatchResult[]>(`/leagues/${league.id}/results?season=${previousSeason(season)}`),
      ]);
      const window = [...current, ...previous];
      for (const match of current) {
        matchCount += 1;
        const at = Date.parse(match.date);
        for (const key of STAT_KEYS) {
          if (key === "xg" && !XG_LEAGUES.has(league.code)) continue;
          const forecast = statForecast(match, window, key);
          if (!forecast) continue;
          const base = baselines(window, key, at, match.home_team_id, match.away_team_id);
          const row: MatchErrors = { league: league.code, season, errors: { model: [], league: [], team: [] } };
          const sides = [
            [statValue(match.home_stats, key), forecast.home, base.leagueHome, base.teamHome],
            [statValue(match.away_stats, key), forecast.away, base.leagueAway, base.teamAway],
          ] as const;
          for (const [observed, model, leagueMean, teamMean] of sides) {
            if (observed === null || leagueMean === null || teamMean === null) continue;
            row.errors.model.push(Math.abs(observed - model));
            row.errors.league.push(Math.abs(observed - leagueMean));
            row.errors.team.push(Math.abs(observed - teamMean));
          }
          if (row.errors.model.length) errors.get(key)!.push(row);
        }
      }
    }
  }

  const random = seeded(BOOTSTRAP_SEED);
  const out: string[] = [];
  const evaluation: Record<string, { shown: boolean; mae: number; observations: number; matches: number }> = {};

  out.push(`Temporadas ${seasons.join(", ")}; ligas: ${leagues.map((l) => l.code).join(", ")}; ${matchCount} partidos.`, "");
  out.push(
    "| Estadística | Obs. | MAE modelo | MAE liga (a) | MAE equipo (b) | Modelo − liga [IC 95 %] | Modelo − equipo [IC 95 %] | Mejora vs liga | RMSE modelo / liga / equipo | ¿Aparece? |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  );
  for (const key of STAT_KEYS) {
    const rows = errors.get(key)!;
    if (!rows.length) continue;
    const model = score(rows, "model");
    const league = score(rows, "league");
    const team = score(rows, "team");
    const d = DIGITS[key];
    const vsLeague = bootstrap(rows, "model", "league", random);
    const vsTeam = bootstrap(rows, "model", "team", random);
    const shown = model.mae < league.mae && model.mae < team.mae && vsLeague[1] < 0 && vsTeam[1] < 0;
    evaluation[key] = { shown, mae: model.mae, observations: model.n, matches: rows.length };
    out.push(
      `| ${LABEL[key]} | ${model.n} | ${fmt(model.mae, d)} | ${fmt(league.mae, d)} | ${fmt(team.mae, d)} | ` +
        `${fmt(model.mae - league.mae, d)} ${ci(vsLeague, d)} | ${fmt(model.mae - team.mae, d)} ${ci(vsTeam, d)} | ` +
        `${fmt((100 * (league.mae - model.mae)) / league.mae, 1)} % | ` +
        `${fmt(model.rmse, d)} / ${fmt(league.rmse, d)} / ${fmt(team.rmse, d)} | ${shown ? "Sí" : "No"} |`,
    );
  }

  // Solo informativo: MAE del modelo frente a la liga (a), por liga y por temporada.
  const breakdown = (title: string, groupOf: (r: MatchErrors) => string, groups: string[]) => {
    out.push("", `| ${title} | ${STAT_KEYS.map((k) => LABEL[k]).join(" | ")} |`, `|---|${STAT_KEYS.map(() => "---:").join("|")}|`);
    for (const g of groups) {
      const cells = STAT_KEYS.map((key) => {
        const rows = errors.get(key)!.filter((r) => groupOf(r) === g);
        if (!rows.length) return "—";
        return `${fmt(score(rows, "model").mae, DIGITS[key])} / ${fmt(score(rows, "league").mae, DIGITS[key])}`;
      });
      out.push(`| ${g} | ${cells.join(" | ")} |`);
    }
  };
  breakdown("MAE modelo / liga, por liga", (r) => r.league, leagues.map((l) => l.code));
  breakdown("MAE modelo / liga, por temporada", (r) => r.season, seasons);

  out.push("", "```json", JSON.stringify(evaluation, null, 2), "```");
  console.log(out.join("\n"));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
