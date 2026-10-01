import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { getLeagues, getLeagueSeasonStats, getLeagueSeasons } from "../api/client";
import type { FormResult, SplitStats, TeamSeasonStats } from "../api/types";
import { LeagueSwitch } from "../components/LeagueSwitch";
import { EmptyView, ErrorView, LoadingView } from "../components/StatusView";
import { formatPct } from "../lib/format";
import { DEFAULT_LEAGUE_CODE, useSelectedLeagueCode } from "../lib/leagues";
import { useApi } from "../lib/useApi";

type SplitKey = "overall" | "home" | "away" | "last5";

const SPLIT_LABELS: Record<SplitKey, string> = {
  overall: "Total",
  home: "Local",
  away: "Visitante",
  last5: "Últimos 5",
};

function splitOf(team: TeamSeasonStats, split: SplitKey): SplitStats {
  return team[split];
}

type SortDir = "asc" | "desc";

type ColumnGroup = "General" | "Goles" | "Descanso" | "Corners" | "Tarjetas";

interface Column {
  key: string;
  group: ColumnGroup;
  label: string;
  title: string;
  value: (s: SplitStats) => number | null;
  render: (s: SplitStats) => ReactNode;
  /** Se pinta en gris cuando la muestra es pequena. */
  lowSampleAware?: boolean;
  /** Entra en el mapa de calor (porcentajes y medias, no conteos). */
  heat?: boolean;
}

type ValueFn = (s: SplitStats) => number | null;

const pctColumn = (group: ColumnGroup, key: string, label: string, title: string, value: ValueFn): Column => ({
  key,
  group,
  label,
  title,
  value,
  render: (s) => formatPct(value(s)),
  lowSampleAware: true,
  heat: true,
});

const avgColumn = (
  group: ColumnGroup,
  key: string,
  label: string,
  title: string,
  value: ValueFn,
  digits = 1,
): Column => ({
  key,
  group,
  label,
  title,
  value,
  render: (s) => value(s)?.toFixed(digits) ?? "—",
  lowSampleAware: true,
  heat: true,
});

const countColumn = (key: string, label: string, title: string, value: (s: SplitStats) => number): Column => ({
  key,
  group: "General",
  label,
  title,
  value,
  render: value,
});

const COLUMNS: Column[] = [
  { ...countColumn("pj", "PJ", "Partidos jugados", (s) => s.matches_played), lowSampleAware: true },
  countColumn("g", "G", "Ganados", (s) => s.wins),
  countColumn("e", "E", "Empatados", (s) => s.draws),
  countColumn("p", "P", "Perdidos", (s) => s.losses),
  countColumn("gf", "GF", "Goles a favor", (s) => s.goals_for),
  countColumn("gc", "GC", "Goles en contra", (s) => s.goals_against),
  {
    ...countColumn("dg", "DG", "Diferencia de goles", (s) => s.goals_for - s.goals_against),
    render: (s) => {
      const dg = s.goals_for - s.goals_against;
      return dg > 0 ? `+${dg}` : dg;
    },
  },
  { ...countColumn("pts", "Pts", "Puntos", (s) => s.points), render: (s) => <strong>{s.points}</strong> },
  avgColumn("General", "ppg", "Pts/PJ", "Puntos por partido", (s) => s.points_per_game, 2),
  avgColumn("Goles", "gfa", "GF/PJ", "Goles a favor por partido", (s) => s.goals_for_avg, 2),
  avgColumn("Goles", "gca", "GC/PJ", "Goles en contra por partido", (s) => s.goals_against_avg, 2),
  pctColumn("Goles", "o15", "+1.5", "% de partidos con más de 1.5 goles", (s) => s.over_1_5_pct),
  pctColumn("Goles", "o25", "+2.5", "% de partidos con más de 2.5 goles", (s) => s.over_2_5_pct),
  pctColumn("Goles", "o35", "+3.5", "% de partidos con más de 3.5 goles", (s) => s.over_3_5_pct),
  pctColumn("Goles", "btts", "Ambos anotan", "% de partidos en los que marcan los dos equipos", (s) => s.btts_pct),
  pctColumn("Goles", "cs", "Portería a 0", "% de partidos sin encajar", (s) => s.clean_sheet_pct),
  pctColumn("Goles", "fts", "No marca", "% de partidos sin marcar", (s) => s.failed_to_score_pct),
  pctColumn("Descanso", "ht05", "+0.5 1ª parte", "% de partidos con algún gol en la 1ª parte", (s) => s.ht_over_0_5_pct),
  pctColumn("Descanso", "htw", "Gana al descanso", "% de partidos que llega ganando al descanso", (s) => s.ht_win_pct),
  avgColumn("Corners", "cf", "A favor", "Media de corners a favor por partido", (s) => s.corners_for_avg),
  avgColumn("Corners", "cc", "En contra", "Media de corners en contra por partido", (s) => s.corners_against_avg),
  avgColumn("Tarjetas", "yf", "Amarillas", "Media de amarillas vistas por partido", (s) => s.yellow_for_avg),
  avgColumn("Tarjetas", "ya", "Del rival", "Media de amarillas del rival por partido", (s) => s.yellow_against_avg),
];

/** Grupos consecutivos de COLUMNS para la fila superior de la cabecera. */
const COLUMN_GROUPS = COLUMNS.reduce<{ group: ColumnGroup; span: number }[]>((acc, col) => {
  const last = acc[acc.length - 1];
  if (last?.group === col.group) last.span += 1;
  else acc.push({ group: col.group, span: 1 });
  return acc;
}, []);

const MIN_MATCHES_OPTIONS = [0, 3, 5, 10];
const LOW_SAMPLE = 5;

const FORM_LABELS: Record<FormResult, string> = { W: "G", D: "E", L: "P" };
const FORM_TITLES: Record<FormResult, string> = { W: "Ganó", D: "Empató", L: "Perdió" };

/** Orden de clasificacion: puntos, diferencia de goles y goles a favor. */
function compareStandings(a: SplitStats, b: SplitStats): number {
  return (
    b.points - a.points ||
    b.goals_for - b.goals_against - (a.goals_for - a.goals_against) ||
    b.goals_for - a.goals_for
  );
}

function FormDots({ form }: { form: FormResult[] }) {
  if (form.length === 0) return <span className="muted">—</span>;
  return (
    <span className="form-dots" aria-label={`Últimos resultados: ${form.map((r) => FORM_TITLES[r]).join(", ")}`}>
      {form.map((result, i) => (
        <span key={i} className={`form-dot form-${result}`} title={FORM_TITLES[result]}>
          {FORM_LABELS[result]}
        </span>
      ))}
    </span>
  );
}

export function SeasonStatsPage() {
  const [searchParams] = useSearchParams();
  const leagueFromUrl = searchParams.get("league");

  const [season, setSeason] = useState<string | undefined>(undefined);
  const [split, setSplit] = useState<SplitKey>("overall");
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "pts", dir: "desc" });
  const [minMatches, setMinMatches] = useState(0);
  const [heatmap, setHeatmap] = useState(true);

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

  // Posicion real en la clasificacion, independiente de la columna por la que se ordene
  // y del filtro de partidos minimos.
  const standings = teams ? [...teams].sort((a, b) => compareStandings(splitOf(a, split), splitOf(b, split))) : null;
  const position = new Map(standings?.map((t, i) => [t.team_id, i + 1]));

  const visible = standings?.filter((t) => splitOf(t, split).matches_played >= minMatches) ?? null;
  const hiddenCount = (standings?.length ?? 0) - (visible?.length ?? 0);

  const sortColumn = COLUMNS.find((c) => c.key === sort.key);
  const sorted =
    visible && sortColumn
      ? [...visible].sort((a, b) => {
          const va = sortColumn.value(splitOf(a, split));
          const vb = sortColumn.value(splitOf(b, split));
          // Sin dato siempre al final, sea cual sea la direccion.
          if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
          return sort.dir === "desc" ? vb - va : va - vb;
        })
      : visible;

  // Primer clic: mayor a menor; segundo clic en la misma columna: menor a mayor.
  function toggleSort(key: string) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  }

  const isLowSample = (s: SplitStats) => s.matches_played > 0 && s.matches_played < LOW_SAMPLE;

  // Rango de cada columna entre los equipos visibles con muestra suficiente:
  // el mas alto se pinta mas intenso, el mas bajo sin color.
  const heatRange = new Map<string, { min: number; max: number }>();
  if (heatmap && sorted) {
    for (const col of COLUMNS.filter((c) => c.heat)) {
      const values = sorted
        .map((t) => splitOf(t, split))
        .filter((s) => !isLowSample(s))
        .map(col.value)
        .filter((v): v is number => v !== null);
      if (values.length > 1) heatRange.set(col.key, { min: Math.min(...values), max: Math.max(...values) });
    }
  }

  function heatStyle(col: Column, s: SplitStats): CSSProperties | undefined {
    const range = heatRange.get(col.key);
    const value = col.value(s);
    if (!range || value === null || range.max === range.min || isLowSample(s)) return undefined;
    const intensity = (value - range.min) / (range.max - range.min);
    return { background: `color-mix(in srgb, var(--primary) ${Math.round(intensity * 32)}%, transparent)` };
  }

  const noCornersYet =
    sorted !== null && sorted.length > 0 && sorted.every((t) => splitOf(t, split).matches_with_corners === 0);

  return (
    <div>
      <h1>Clasificación y estadísticas</h1>
      <p className="muted">
        Datos reales de partidos jugados: % over/under, ambos anotan, porterías a cero, descanso, corners y tarjetas,
        en total, como local, como visitante o en los últimos 5 partidos. Pulsa en una cabecera para ordenar por esa
        columna (otra vez para invertir el orden).
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

        <label className="filter-label">
          Mín. partidos
          <select value={minMatches} onChange={(e) => setMinMatches(Number(e.target.value))}>
            {MIN_MATCHES_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "Todos" : n}
              </option>
            ))}
          </select>
        </label>

        <label className="filter-label">
          <input type="checkbox" checked={heatmap} onChange={(e) => setHeatmap(e.target.checked)} />
          Mapa de calor
        </label>
      </div>

      {noCornersYet && (
        <p className="small muted intro-note">
          Todavía no hay datos de corners ni tarjetas para la temporada{" "}
          {effectiveSeason ? `${effectiveSeason.slice(0, 2)}/${effectiveSeason.slice(2)}` : "seleccionada"}: la fuente
          que alimenta los partidos en curso (football-data.org, plan gratuito) no los incluye, solo resultados. Solo
          están disponibles en temporadas ya cerradas. Prueba con una temporada anterior en el selector de arriba.
        </p>
      )}

      {loading && <LoadingView label="Cargando estadísticas..." />}
      {error && <ErrorView message={`No se pudo conectar con la API: ${error}`} />}
      {!loading && !error && standings?.length === 0 && (
        <EmptyView message="No hay estadísticas para esta liga/temporada." />
      )}
      {!loading && !error && standings && standings.length > 0 && sorted?.length === 0 && (
        <EmptyView message={`Ningún equipo tiene al menos ${minMatches} partidos en esta vista.`} />
      )}

      {!loading && !error && sorted && sorted.length > 0 && (
        <div className="table-scroll">
          <table className="predictions-table season-stats-table">
            <thead>
              <tr className="group-row">
                <th colSpan={3} />
                {COLUMN_GROUPS.map(({ group, span }) => (
                  <th key={group} colSpan={span} className="group-head">
                    {group}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="num">#</th>
                <th>Equipo</th>
                <th title="Últimos 5 partidos de la temporada, del más antiguo al más reciente">Racha</th>
                {COLUMNS.map((col, i) => {
                  const active = sort.key === col.key;
                  const classes = ["num", "sortable"];
                  if (active) classes.push("sorted");
                  if (i > 0 && COLUMNS[i - 1].group !== col.group) classes.push("group-start");
                  return (
                    <th
                      key={col.key}
                      className={classes.join(" ")}
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
                const lowSample = isLowSample(s);
                return (
                  <tr key={team.team_id}>
                    <td className="num muted">{position.get(team.team_id)}</td>
                    <td>{team.team_name}</td>
                    <td>
                      <FormDots form={team.form} />
                    </td>
                    {COLUMNS.map((col, i) => {
                      const classes = ["num"];
                      if (col.lowSampleAware && lowSample) classes.push("low-sample");
                      if (sort.key === col.key) classes.push("sorted");
                      if (i > 0 && COLUMNS[i - 1].group !== col.group) classes.push("group-start");
                      return (
                        <td key={col.key} className={classes.join(" ")} style={heatStyle(col, s)}>
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
          # = posición en la clasificación de la vista elegida · PJ = partidos jugados · G/E/P =
          ganados/empatados/perdidos · GF/GC/DG = goles a favor/en contra/diferencia · Racha: G/E/P de los últimos 5
          partidos, el más reciente a la derecha. Descanso, corners y tarjetas se calculan solo con los partidos que
          traen ese dato. Con menos de {LOW_SAMPLE} partidos (en gris, sin mapa de calor) los porcentajes son poco
          fiables — tómalos como orientativos, no como un patrón asentado.
          {hiddenCount > 0 && ` Ocultos ${hiddenCount} equipos con menos de ${minMatches} partidos.`}
        </p>
      )}
    </div>
  );
}
