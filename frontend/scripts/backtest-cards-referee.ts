/** Tarjetas con el árbitro: ampliación de docs/PREDICTOR_ESTADISTICAS_PROTOCOLO.md,
 * con el modelo de la web (src/lib/statsPredictor.ts) tal cual.
 *
 * Validación (elige la variante del factor del árbitro, una por estadística):
 *   npm run backtest:cards -- --mode validation --seasons 2425
 * Test (una sola vez, con las variantes elegidas):
 *   npm run backtest:cards -- --mode test --seasons 2526,2627 --yellow adjusted:10 --red raw:20
 *
 * Cada partido solo ve los partidos de la liga anteriores a su fecha, de su
 * temporada y la anterior. Solo entran los partidos con árbitro conocido.
 */

import type { League, MatchResult } from "../src/api/types";
import {
  CARD_KEYS,
  cardsForecast,
  refereeFactor,
  statForecast,
  statValue,
  type CardKey,
  type RefereeSettings,
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

const LABEL: Record<CardKey, string> = { yellow_cards: "Amarillas", red_cards: "Rojas" };
const VARIANTS: RefereeSettings[] = (["raw", "adjusted"] as const).flatMap((method) =>
  [5, 10, 20].map((shrink) => ({ method, shrink })),
);
const name = (s: RefereeSettings) => `${s.method === "raw" ? "R1" : "R2"} K=${s.shrink}`;
const parse = (text: string | undefined): RefereeSettings => {
  const [method, shrink] = (text ?? "").split(":");
  if ((method !== "raw" && method !== "adjusted") || !Number(shrink)) throw new Error(`Variante no válida: ${text}`);
  return { method, shrink: Number(shrink) };
};

async function main() {
  const mode = arg("mode");
  if (mode !== "validation" && mode !== "test") throw new Error("--mode validation | test");
  const seasons = (arg("seasons") ?? (mode === "test" ? "2526,2627" : "2425")).split(",");
  const chosen: Record<CardKey, RefereeSettings[]> =
    mode === "test"
      ? { yellow_cards: [parse(arg("yellow"))], red_cards: [parse(arg("red"))] }
      : { yellow_cards: VARIANTS, red_cards: VARIANTS };

  const leagues = (await get<League[]>("/leagues")).filter((l) => LEAGUES.includes(l.code));
  const errors = new Map<CardKey, MatchErrors[]>(CARD_KEYS.map((k) => [k, []]));
  const refereeMatches: number[] = [];
  let matchCount = 0;
  let withReferee = 0;

  // Primero todos los datos: el cálculo de una liga tarda tanto que el backend
  // cerraría la conexión entre una petición y la siguiente.
  const data: { league: League; season: string; current: MatchResult[]; previous: MatchResult[] }[] = [];
  for (const league of leagues) {
    for (const season of seasons) {
      const [current, previous] = await Promise.all([
        get<MatchResult[]>(`/leagues/${league.id}/results?season=${season}`),
        get<MatchResult[]>(`/leagues/${league.id}/results?season=${previousSeason(season)}`),
      ]);
      data.push({ league, season, current, previous });
    }
  }

  for (const { league, season, current, previous } of data) {
    const window = [...current, ...previous];
    for (const match of current) {
      matchCount += 1;
      if (!match.referee) continue;
      withReferee += 1;
      const at = Date.parse(match.date);
      const own = refereeFactor(match, window, "yellow_cards", { method: "raw", shrink: 5 });
      if (own) refereeMatches.push(own.matches);
      for (const key of CARD_KEYS) {
        const noReferee = statForecast(match, window, key);
        const forecasts = chosen[key].map((s) => cardsForecast(match, window, key, s));
        if (!noReferee || forecasts.some((f) => !f)) continue;
        const base = baselines(window, key, at, match.home_team_id, match.away_team_id);
        const methods = ["league", "team", "noReferee", ...chosen[key].map(name)];
        const row: MatchErrors = { league: league.code, season, errors: Object.fromEntries(methods.map((m) => [m, []])) };
        for (const side of ["home", "away"] as const) {
          const observed = statValue(side === "home" ? match.home_stats : match.away_stats, key);
          const leagueMean = side === "home" ? base.leagueHome : base.leagueAway;
          const teamMean = side === "home" ? base.teamHome : base.teamAway;
          if (observed === null || leagueMean === null || teamMean === null) continue;
          row.errors.league.push(Math.abs(observed - leagueMean));
          row.errors.team.push(Math.abs(observed - teamMean));
          row.errors.noReferee.push(Math.abs(observed - noReferee[side]));
          chosen[key].forEach((s, i) => row.errors[name(s)].push(Math.abs(observed - forecasts[i]![side])));
        }
        if (row.errors.league.length) errors.get(key)!.push(row);
      }
    }
  }

  const sorted = [...refereeMatches].sort((a, b) => a - b);
  const out: string[] = [
    `Modo ${mode}. Temporadas ${seasons.join(", ")}; seis ligas; ${matchCount} partidos, ${withReferee} con árbitro.`,
    `Partidos anteriores del árbitro en la ventana: mediana ${sorted[Math.floor(sorted.length / 2)]}, ` +
      `sin ninguno ${refereeMatches.filter((n) => n === 0).length}, con menos de 5 ${refereeMatches.filter((n) => n < 5).length}.`,
    "",
  ];

  if (mode === "validation") {
    out.push("| Estadística | Obs. | Liga (a) | Sin árbitro (c) | " + VARIANTS.map(name).join(" | ") + " | Elegida |");
    out.push(`|---|---:|---:|---:|${VARIANTS.map(() => "---:").join("|")}|---|`);
    for (const key of CARD_KEYS) {
      const rows = errors.get(key)!;
      const maes = VARIANTS.map((s) => score(rows, name(s)).mae);
      const best = VARIANTS[maes.indexOf(Math.min(...maes))];
      out.push(
        `| ${LABEL[key]} | ${score(rows, "league").n} | ${fmt(score(rows, "league").mae, 4)} | ${fmt(score(rows, "noReferee").mae, 4)} | ` +
          `${maes.map((m) => fmt(m, 4)).join(" | ")} | ${name(best)} (\`${best.method}:${best.shrink}\`) |`,
      );
    }
    console.log(out.join("\n"));
    return;
  }

  const random = seeded(BOOTSTRAP_SEED);
  const evaluation: Record<string, { shown: boolean; mae: number; vsLeague: number; settings: RefereeSettings }> = {};
  out.push(
    "| Estadística | Variante | Obs. | MAE modelo | MAE liga (a) | MAE equipo (b) | MAE sin árbitro (c) | Modelo − liga [IC 95 %] | Modelo − equipo [IC 95 %] | Modelo − sin árbitro [IC 95 %] | Mejora vs liga | RMSE modelo / liga | ¿Aparece? |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  );
  for (const key of CARD_KEYS) {
    const rows = errors.get(key)!;
    const settings = chosen[key][0];
    const method = name(settings);
    const model = score(rows, method);
    const league = score(rows, "league");
    const team = score(rows, "team");
    const noReferee = score(rows, "noReferee");
    const vsLeague = bootstrap(rows, method, "league", random);
    const vsTeam = bootstrap(rows, method, "team", random);
    const vsNoReferee = bootstrap(rows, method, "noReferee", random);
    const shown = model.mae < league.mae && model.mae < team.mae && vsLeague[1] < 0 && vsTeam[1] < 0;
    const gain = (league.mae - model.mae) / league.mae;
    evaluation[key] = { shown, mae: model.mae, vsLeague: gain, settings };
    out.push(
      `| ${LABEL[key]} | ${method} | ${model.n} | ${fmt(model.mae, 3)} | ${fmt(league.mae, 3)} | ${fmt(team.mae, 3)} | ${fmt(noReferee.mae, 3)} | ` +
        `${fmt(model.mae - league.mae, 3)} ${ci(vsLeague, 3)} | ${fmt(model.mae - team.mae, 3)} ${ci(vsTeam, 3)} | ` +
        `${fmt(model.mae - noReferee.mae, 3)} ${ci(vsNoReferee, 3)} | ${fmt(100 * gain, 1)} % | ` +
        `${fmt(model.rmse, 3)} / ${fmt(league.rmse, 3)} | ${shown ? "Sí" : "No"} |`,
    );
  }

  // Solo informativo: por liga, MAE del modelo / sin árbitro (c) / liga (a).
  out.push("", `| Por liga (modelo / sin árbitro / liga) | ${CARD_KEYS.map((k) => LABEL[k]).join(" | ")} |`, "|---|---:|---:|");
  for (const league of leagues) {
    const cells = CARD_KEYS.map((key) => {
      const rows = errors.get(key)!.filter((r) => r.league === league.code);
      const m = name(chosen[key][0]);
      return rows.length ? [m, "noReferee", "league"].map((x) => fmt(score(rows, x).mae, 3)).join(" / ") : "—";
    });
    out.push(`| ${league.code} | ${cells.join(" | ")} |`);
  }
  out.push("", "```json", JSON.stringify(evaluation, null, 2), "```");
  console.log(out.join("\n"));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
