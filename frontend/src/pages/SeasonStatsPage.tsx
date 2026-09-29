import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getLeagues, getLeagueSeasonStats, getLeagueSeasons } from "../api/client";
import type { SplitStats, TeamSeasonStats } from "../api/types";
import { EmptyView, ErrorView, LoadingView } from "../components/StatusView";
import { formatPct } from "../lib/format";
import { useApi } from "../lib/useApi";

type SplitKey = "overall" | "home" | "away";

const SPLIT_LABELS: Record<SplitKey, string> = {
  overall: "Total",
  home: "Local",
  away: "Visitante",
};

function splitOf(team: TeamSeasonStats, split: SplitKey): SplitStats {
  return team[split];
}

export function SeasonStatsPage() {
  const [searchParams] = useSearchParams();
  const leagueFromUrl = searchParams.get("league");

  const [leagueId, setLeagueId] = useState<number | undefined>(
    leagueFromUrl ? Number(leagueFromUrl) : undefined,
  );
  const [season, setSeason] = useState<string | undefined>(undefined);
  const [split, setSplit] = useState<SplitKey>("overall");

  const { data: leagues } = useApi(() => getLeagues(), []);

  useEffect(() => {
    if (leagueId === undefined && leagues && leagues.length > 0) {
      setLeagueId(leagues[0].id);
    }
  }, [leagues, leagueId]);

  const { data: seasons } = useApi(
    () => (leagueId !== undefined ? getLeagueSeasons(leagueId) : Promise.resolve([])),
    [leagueId],
  );

  useEffect(() => {
    setSeason(undefined);
  }, [leagueId]);

  const effectiveSeason = season ?? seasons?.[0];

  const {
    data: teams,
    loading,
    error,
  } = useApi(
    () => (leagueId !== undefined ? getLeagueSeasonStats(leagueId, effectiveSeason) : Promise.resolve([])),
    [leagueId, effectiveSeason],
  );

  const sorted = teams ? [...teams].sort((a, b) => splitOf(b, split).points - splitOf(a, split).points) : null;
  const noCornersYet = sorted !== null && sorted.length > 0 && sorted.every((t) => splitOf(t, split).matches_with_corners === 0);

  return (
    <div>
      <h1>Estadísticas por temporada</h1>
      <p className="muted">
        Datos reales de partidos jugados: % over/under, ambos anotan, porterías a cero, forma local y
        visitante.
      </p>

      <div className="filters">
        <select
          value={leagueId ?? ""}
          onChange={(e) => setLeagueId(e.target.value ? Number(e.target.value) : undefined)}
        >
          {leagues?.map((league) => (
            <option key={league.id} value={league.id}>
              {league.name}
            </option>
          ))}
        </select>

        <select value={effectiveSeason ?? ""} onChange={(e) => setSeason(e.target.value)}>
          {seasons?.map((s) => (
            <option key={s} value={s}>
              {s.slice(0, 2)}/{s.slice(2)}
            </option>
          ))}
        </select>

        <div className="tab-group">
          {(Object.keys(SPLIT_LABELS) as SplitKey[]).map((key) => (
            <button
              key={key}
              className={split === key ? "tab-button tab-button-active" : "tab-button"}
              onClick={() => setSplit(key)}
            >
              {SPLIT_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      {noCornersYet && (
        <p className="small muted intro-note">
          Todavía no hay datos de corners para la temporada {effectiveSeason ? `${effectiveSeason.slice(0, 2)}/${effectiveSeason.slice(2)}` : "seleccionada"}: la
          fuente que alimenta los partidos en curso (football-data.org, plan gratuito) no incluye corners, solo
          resultados. Los corners solo están disponibles en temporadas ya cerradas. Prueba con una temporada
          anterior en el selector de arriba.
        </p>
      )}

      {loading && <LoadingView label="Cargando estadísticas..." />}
      {error && <ErrorView message={`No se pudo conectar con la API: ${error}`} />}
      {!loading && !error && sorted?.length === 0 && (
        <EmptyView message="No hay estadísticas para esta liga/temporada." />
      )}

      {!loading && !error && sorted && sorted.length > 0 && (
        <div className="table-scroll">
          <table className="predictions-table season-stats-table">
            <thead>
              <tr>
                <th>Equipo</th>
                <th className="num">PJ</th>
                <th className="num">G</th>
                <th className="num">E</th>
                <th className="num">P</th>
                <th className="num">GF</th>
                <th className="num">GC</th>
                <th className="num">Pts</th>
                <th className="num">+1.5</th>
                <th className="num">+2.5</th>
                <th className="num">+3.5</th>
                <th className="num">Ambos anotan</th>
                <th className="num">Portería a 0</th>
                <th className="num">Corners a favor</th>
                <th className="num">Corners en contra</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((team) => {
                const s = splitOf(team, split);
                const lowSample = s.matches_played > 0 && s.matches_played < 5;
                return (
                  <tr key={team.team_id}>
                    <td>{team.team_name}</td>
                    <td className={lowSample ? "num low-sample" : "num"}>{s.matches_played}</td>
                    <td className="num">{s.wins}</td>
                    <td className="num">{s.draws}</td>
                    <td className="num">{s.losses}</td>
                    <td className="num">{s.goals_for}</td>
                    <td className="num">{s.goals_against}</td>
                    <td className="num">
                      <strong>{s.points}</strong>
                    </td>
                    <td className={lowSample ? "num low-sample" : "num"}>{formatPct(s.over_1_5_pct)}</td>
                    <td className={lowSample ? "num low-sample" : "num"}>{formatPct(s.over_2_5_pct)}</td>
                    <td className={lowSample ? "num low-sample" : "num"}>{formatPct(s.over_3_5_pct)}</td>
                    <td className={lowSample ? "num low-sample" : "num"}>{formatPct(s.btts_pct)}</td>
                    <td className={lowSample ? "num low-sample" : "num"}>{formatPct(s.clean_sheet_pct)}</td>
                    <td className="num">{s.corners_for_avg?.toFixed(1) ?? "—"}</td>
                    <td className="num">{s.corners_against_avg?.toFixed(1) ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && sorted && sorted.length > 0 && (
        <p className="muted small">
          PJ = partidos jugados · G/E/P = ganados/empatados/perdidos · GF/GC = goles a favor/en contra. Con menos de
          5 partidos (en gris) los porcentajes son poco fiables — tómalos como orientativos, no como un patrón
          asentado.
        </p>
      )}
    </div>
  );
}
