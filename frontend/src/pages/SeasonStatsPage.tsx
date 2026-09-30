import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { getLeagues, getLeagueSeasonStats, getLeagueSeasons } from "../api/client";
import type { SplitStats, TeamSeasonStats } from "../api/types";
import { LeagueSwitch } from "../components/LeagueSwitch";
import { EmptyView, ErrorView, LoadingView } from "../components/StatusView";
import { formatPct } from "../lib/format";
import { DEFAULT_LEAGUE_CODE, useSelectedLeagueCode } from "../lib/leagues";
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

type SortDir = "asc" | "desc";

interface Column {
  key: string;
  label: string;
  title: string;
  value: (s: SplitStats) => number | null;
  render: (s: SplitStats) => ReactNode;
  /** Se pinta en gris cuando la muestra es pequena. */
  lowSampleAware?: boolean;
}

const pctColumn = (key: string, label: string, title: string, value: (s: SplitStats) => number | null): Column => ({
  key,
  label,
  title,
  value,
  render: (s) => formatPct(value(s)),
  lowSampleAware: true,
});

const avgColumn = (key: string, label: string, title: string, value: (s: SplitStats) => number | null): Column => ({
  key,
  label,
  title,
  value,
  render: (s) => value(s)?.toFixed(1) ?? "—",
});

const COLUMNS: Column[] = [
  {
    key: "pj",
    label: "PJ",
    title: "Partidos jugados",
    value: (s) => s.matches_played,
    render: (s) => s.matches_played,
    lowSampleAware: true,
  },
  { key: "g", label: "G", title: "Ganados", value: (s) => s.wins, render: (s) => s.wins },
  { key: "e", label: "E", title: "Empatados", value: (s) => s.draws, render: (s) => s.draws },
  { key: "p", label: "P", title: "Perdidos", value: (s) => s.losses, render: (s) => s.losses },
  { key: "gf", label: "GF", title: "Goles a favor", value: (s) => s.goals_for, render: (s) => s.goals_for },
  { key: "gc", label: "GC", title: "Goles en contra", value: (s) => s.goals_against, render: (s) => s.goals_against },
  {
    key: "dg",
    label: "DG",
    title: "Diferencia de goles",
    value: (s) => s.goals_for - s.goals_against,
    render: (s) => {
      const dg = s.goals_for - s.goals_against;
      return dg > 0 ? `+${dg}` : dg;
    },
  },
  { key: "pts", label: "Pts", title: "Puntos", value: (s) => s.points, render: (s) => <strong>{s.points}</strong> },
  pctColumn("o15", "+1.5", "% de partidos con más de 1.5 goles", (s) => s.over_1_5_pct),
  pctColumn("o25", "+2.5", "% de partidos con más de 2.5 goles", (s) => s.over_2_5_pct),
  pctColumn("o35", "+3.5", "% de partidos con más de 3.5 goles", (s) => s.over_3_5_pct),
  pctColumn("btts", "Ambos anotan", "% de partidos en los que marcan los dos equipos", (s) => s.btts_pct),
  pctColumn("cs", "Portería a 0", "% de partidos sin encajar", (s) => s.clean_sheet_pct),
  pctColumn("fts", "No marca", "% de partidos sin marcar", (s) => s.failed_to_score_pct),
  avgColumn("cf", "Corners a favor", "Media de corners a favor por partido", (s) => s.corners_for_avg),
  avgColumn("cc", "Corners en contra", "Media de corners en contra por partido", (s) => s.corners_against_avg),
];

/** Orden de clasificacion: puntos, diferencia de goles y goles a favor. */
function compareStandings(a: SplitStats, b: SplitStats): number {
  return (
    b.points - a.points ||
    b.goals_for - b.goals_against - (a.goals_for - a.goals_against) ||
    b.goals_for - a.goals_for
  );
}

export function SeasonStatsPage() {
  const [searchParams] = useSearchParams();
  const leagueFromUrl = searchParams.get("league");

  const [season, setSeason] = useState<string | undefined>(undefined);
  const [split, setSplit] = useState<SplitKey>("overall");
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "pts", dir: "desc" });

  const { data: leagues } = useApi(() => getLeagues(), []);

  // Sin "todas las ligas" en esta pagina: si venia de "Ambas", LaLiga.
  const [selectedCode, setLeagueCode] = useSelectedLeagueCode();
  const leagueCode = selectedCode ?? DEFAULT_LEAGUE_CODE;
  const leagueId = leagues?.find((l) => l.code === leagueCode)?.id;

  // Enlace desde la ficha de partido (?league=<id>): preselecciona esa liga.
  useEffect(() => {
    const fromUrl = leagues?.find((l) => String(l.id) === leagueFromUrl);
    if (fromUrl) setLeagueCode(fromUrl.code);
  }, [leagues, leagueFromUrl, setLeagueCode]);

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

  // Posicion real en la clasificacion, independiente de la columna por la que se ordene.
  const standings = teams ? [...teams].sort((a, b) => compareStandings(splitOf(a, split), splitOf(b, split))) : null;
  const position = new Map(standings?.map((t, i) => [t.team_id, i + 1]));

  const sortColumn = COLUMNS.find((c) => c.key === sort.key);
  const sorted =
    standings && sortColumn
      ? [...standings].sort((a, b) => {
          const va = sortColumn.value(splitOf(a, split));
          const vb = sortColumn.value(splitOf(b, split));
          // Sin dato siempre al final, sea cual sea la direccion.
          if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
          return sort.dir === "desc" ? vb - va : va - vb;
        })
      : standings;

  // Primer clic: mayor a menor; segundo clic en la misma columna: menor a mayor.
  function toggleSort(key: string) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  }
  const noCornersYet = sorted !== null && sorted.length > 0 && sorted.every((t) => splitOf(t, split).matches_with_corners === 0);

  return (
    <div>
      <h1>Clasificación y estadísticas</h1>
      <p className="muted">
        Datos reales de partidos jugados: % over/under, ambos anotan, porterías a cero, forma local y
        visitante. Pulsa en una cabecera para ordenar por esa columna (otra vez para invertir el orden).
      </p>

      <LeagueSwitch leagues={leagues} value={leagueCode} onChange={(code) => code && setLeagueCode(code)} />

      <div className="filters">

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
                <th className="num">#</th>
                <th>Equipo</th>
                {COLUMNS.map((col) => {
                  const active = sort.key === col.key;
                  return (
                    <th
                      key={col.key}
                      className={active ? "num sortable sorted" : "num sortable"}
                      title={col.title}
                      aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}
                    >
                      <button type="button" onClick={() => toggleSort(col.key)}>
                        {col.label}
                        <span className="sort-arrow">{active ? (sort.dir === "desc" ? "▼" : "▲") : ""}</span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((team) => {
                const s = splitOf(team, split);
                const lowSample = s.matches_played > 0 && s.matches_played < 5;
                return (
                  <tr key={team.team_id}>
                    <td className="num muted">{position.get(team.team_id)}</td>
                    <td>{team.team_name}</td>
                    {COLUMNS.map((col) => {
                      const classes = ["num"];
                      if (col.lowSampleAware && lowSample) classes.push("low-sample");
                      if (sort.key === col.key) classes.push("sorted");
                      return (
                        <td key={col.key} className={classes.join(" ")}>
                          {col.render(s)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && sorted && sorted.length > 0 && (
        <p className="muted small">
          PJ = partidos jugados · G/E/P = ganados/empatados/perdidos · GF/GC/DG = goles a favor/en contra/diferencia · # = posición en la
          clasificación. Con menos de
          5 partidos (en gris) los porcentajes son poco fiables — tómalos como orientativos, no como un patrón
          asentado.
        </p>
      )}
    </div>
  );
}
