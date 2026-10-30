import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PageHero } from "../components/PageHero";
import { useSearchParams } from "react-router-dom";
import { getLeagues, getLeagueSeasonStats, getLeagueSeasons } from "../api/client";
import type { FormResult, SplitStats, TeamSeasonStats } from "../api/types";
import { LeagueSwitch } from "../components/LeagueSwitch";
import { EmptyView, ErrorView, LoadingView } from "../components/StatusView";
import { TeamName } from "../components/TeamCrest";
import { formatFixed, formatPct } from "../lib/format";
import { defaultLeagueCode, useSelectedLeagueCode, leagueName, parseLeagueParam } from "../lib/leagues";
import { QUERY } from "../lib/routes";
import { useApi } from "../lib/useApi";

type SplitKey = "overall" | "home" | "away" | "last5";

const SPLITS: SplitKey[] = ["overall", "home", "away", "last5"];

function splitOf(team: TeamSeasonStats, split: SplitKey): SplitStats {
  return team[split];
}

type SortDir = "asc" | "desc";

type ColumnGroup = "General" | "Goles" | "Descanso" | "Corners" | "Tarjetas";

/** `label`, `title` y `short`: claves de sus textos (standings:column). */
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
  /** Se oculta en pantallas estrechas ("md": tablet; "sm": movil) para que la
   * tabla quepa sin desplazar de lado. */
  hide?: "md" | "sm";
  /** Etiqueta en el movil, donde no hay fila de grupos ni sitio. */
  short?: string;
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
  render: (s) => {
    const x = value(s);
    return x != null ? formatFixed(x, digits) : "—";
  },
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
  { ...countColumn("pj", "standings:column.played.label", "standings:column.played.title", (s) => s.matches_played), lowSampleAware: true },
  { ...countColumn("g", "standings:column.won.label", "standings:column.won.title", (s) => s.wins), hide: "sm" },
  { ...countColumn("e", "standings:column.drawn.label", "standings:column.drawn.title", (s) => s.draws), hide: "sm" },
  { ...countColumn("p", "standings:column.lost.label", "standings:column.lost.title", (s) => s.losses), hide: "sm" },
  { ...countColumn("gf", "standings:column.goalsFor.label", "standings:column.goalsFor.title", (s) => s.goals_for), hide: "sm" },
  { ...countColumn("gc", "standings:column.goalsAgainst.label", "standings:column.goalsAgainst.title", (s) => s.goals_against), hide: "sm" },
  {
    ...countColumn("dg", "standings:column.goalDifference.label", "standings:column.goalDifference.title", (s) => s.goals_for - s.goals_against),
    render: (s) => {
      const dg = s.goals_for - s.goals_against;
      return dg > 0 ? `+${dg}` : dg;
    },
  },
  { ...countColumn("pts", "standings:column.points.label", "standings:column.points.title", (s) => s.points), render: (s) => <strong>{s.points}</strong> },
  avgColumn("General", "ppg", "standings:column.pointsPerGame.label", "standings:column.pointsPerGame.title", (s) => s.points_per_game, 2),
  avgColumn("Goles", "gfa", "standings:column.goalsForPerGame.label", "standings:column.goalsForPerGame.title", (s) => s.goals_for_avg, 2),
  {
    ...avgColumn("Goles", "gca", "standings:column.goalsAgainstPerGame.label", "standings:column.goalsAgainstPerGame.title", (s) => s.goals_against_avg, 2),
    hide: "sm",
  },
  { ...pctColumn("Goles", "o15", "standings:column.over15.label", "standings:column.over15.title", (s) => s.over_1_5_pct), hide: "sm" },
  pctColumn("Goles", "o25", "standings:column.over25.label", "standings:column.over25.title", (s) => s.over_2_5_pct),
  { ...pctColumn("Goles", "o35", "standings:column.over35.label", "standings:column.over35.title", (s) => s.over_3_5_pct), hide: "md" },
  {
    ...pctColumn("Goles", "btts", "standings:column.btts.label", "standings:column.btts.title", (s) => s.btts_pct),
    short: "standings:column.btts.short",
  },
  { ...pctColumn("Goles", "cs", "standings:column.cleanSheet.label", "standings:column.cleanSheet.title", (s) => s.clean_sheet_pct), short: "standings:column.cleanSheet.short" },
  { ...pctColumn("Goles", "fts", "standings:column.failedToScore.label", "standings:column.failedToScore.title", (s) => s.failed_to_score_pct), hide: "md" },
  {
    ...pctColumn("Descanso", "ht05", "standings:column.htOver05.label", "standings:column.htOver05.title", (s) => s.ht_over_0_5_pct),
    hide: "sm",
  },
  {
    ...pctColumn("Descanso", "htw", "standings:column.htWin.label", "standings:column.htWin.title", (s) => s.ht_win_pct),
    hide: "md",
  },
  { ...avgColumn("Corners", "cf", "standings:column.cornersFor.label", "standings:column.cornersFor.title", (s) => s.corners_for_avg), short: "standings:column.cornersFor.short" },
  {
    ...avgColumn("Corners", "cc", "standings:column.cornersAgainst.label", "standings:column.cornersAgainst.title", (s) => s.corners_against_avg),
    short: "standings:column.cornersAgainst.short",
  },
  { ...avgColumn("Tarjetas", "yf", "standings:column.yellowFor.label", "standings:column.yellowFor.title", (s) => s.yellow_for_avg), short: "standings:column.yellowFor.short" },
  {
    ...avgColumn("Tarjetas", "ya", "standings:column.yellowAgainst.label", "standings:column.yellowAgainst.title", (s) => s.yellow_against_avg),
    short: "standings:column.yellowAgainst.short",
  },
];

/** Grupos consecutivos de esas columnas para la fila superior de la cabecera. */
function columnGroups(columns: Column[]) {
  return columns.reduce<{ group: ColumnGroup; span: number }[]>((acc, col) => {
    const last = acc[acc.length - 1];
    if (last?.group === col.group) last.span += 1;
    else acc.push({ group: col.group, span: 1 });
    return acc;
  }, []);
}

/** Clave del rotulo de cada grupo de columnas (el grupo da tambien su clase CSS). */
const GROUP_LABEL: Record<ColumnGroup, string> = {
  General: "standings:group.general",
  Goles: "standings:group.goals",
  Descanso: "standings:group.halfTime",
  Corners: "standings:group.corners",
  Tarjetas: "standings:group.cards",
};
const groupClass = (g: ColumnGroup) => `grp-${g.toLowerCase()}`;

/** Una vista cada vez: cada una cabe en el ancho de la pagina. */
type View = "clasificacion" | "goles" | "corners";
const VIEWS: { key: View; label: string; groups: ColumnGroup[]; sort: string }[] = [
  { key: "clasificacion", label: "standings:view.standings", groups: ["General"], sort: "pts" },
  { key: "goles", label: "standings:view.goals", groups: ["Goles", "Descanso"], sort: "o25" },
  { key: "corners", label: "standings:view.corners", groups: ["Corners", "Tarjetas"], sort: "cf" },
];
const VIEW_KEY = "season-stats-view";
const FORM_KEY = "season-stats-form";

/** Lo elegido la ultima vez en este navegador (vista, racha). */
function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // sin almacenamiento: solo para esta visita
  }
}

const MIN_MATCHES_OPTIONS = [0, 3, 5, 10];
const LOW_SAMPLE = 5;

/** Claves de la letra y del texto de cada resultado (standings:form). */
const FORM_KEYS: Record<FormResult, string> = { W: "win", D: "draw", L: "loss" };

/** Orden de clasificacion: puntos, diferencia de goles y goles a favor. */
function compareStandings(a: SplitStats, b: SplitStats): number {
  return (
    b.points - a.points ||
    b.goals_for - b.goals_against - (a.goals_for - a.goals_against) ||
    b.goals_for - a.goals_for
  );
}

function FormDots({ form }: { form: FormResult[] }) {
  const { t } = useTranslation();
  if (form.length === 0) return <span className="muted">—</span>;
  const title = (r: FormResult) => t(`standings:form.${FORM_KEYS[r]}.title`);
  return (
    <span className="form-dots" aria-label={t("standings:form.label", { results: form.map(title).join(", ") })}>
      {form.map((result, i) => (
        <span key={i} className={`form-dot form-${result}`} title={title(result)}>
          {t(`standings:form.${FORM_KEYS[result]}.letter`)}
        </span>
      ))}
    </span>
  );
}

export function SeasonStatsPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const leagueFromUrl = searchParams.get(QUERY.league);

  const [season, setSeason] = useState<string | undefined>(undefined);
  const [split, setSplit] = useState<SplitKey>("overall");
  const [view, setViewState] = useState<View>(() =>
    stored(VIEW_KEY, VIEWS.map((v) => v.key), "clasificacion"),
  );
  const viewDef = VIEWS.find((v) => v.key === view)!;
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: viewDef.sort, dir: "desc" });
  function setView(next: View) {
    setViewState(next);
    store(VIEW_KEY, next);
    // Al cambiar de vista, se ordena por su columna principal.
    setSort({ key: VIEWS.find((v) => v.key === next)!.sort, dir: "desc" });
  }
  const [showForm, setShowFormState] = useState(() => stored(FORM_KEY, ["si", "no"], "si") === "si");
  function setShowForm(next: boolean) {
    setShowFormState(next);
    store(FORM_KEY, next ? "si" : "no");
  }
  const shown = COLUMNS.filter((c) => viewDef.groups.includes(c.group));
  const shownGroups = columnGroups(shown);
  const withGroupRow = shownGroups.length > 1;
  const [minMatches, setMinMatches] = useState(0);
  const [heatmap, setHeatmap] = useState(true);

  const { data: leagues } = useApi(() => getLeagues(), []);

  // Sin "todas las ligas" en esta pagina: si venia de "Todas", la del idioma.
  const [selectedCode, setLeagueCode] = useSelectedLeagueCode();
  const leagueCode = selectedCode ?? defaultLeagueCode();
  const leagueId = leagues?.find((l) => l.code === leagueCode)?.id;

  // Enlace desde la ficha de partido (?league=laliga): preselecciona esa liga.
  useEffect(() => {
    const fromUrl = leagues ? parseLeagueParam(leagueFromUrl, leagues) : undefined;
    if (fromUrl) setLeagueCode(fromUrl);
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
    // Verde de la web, de casi blanco (el valor más bajo) a intenso (el más
    // alto). Hasta el 40 %: el texto sigue con contraste AA en los dos temas.
    const intensity = (value - range.min) / (range.max - range.min);
    return { background: `color-mix(in srgb, var(--green-fill) ${Math.round(4 + intensity * 36)}%, transparent)` };
  }

  const noCornersYet =
    sorted !== null && sorted.length > 0 && sorted.every((t) => splitOf(t, split).matches_with_corners === 0);

  return (
    <div>
      <PageHero eyebrow={leagueName(leagueCode)} title={t("standings:title")} lead={<p>{t("standings:lead")}</p>} />

      <LeagueSwitch leagues={leagues} value={leagueCode} onChange={(code) => code && setLeagueCode(code)} />

      <div className="tab-group stats-views" role="tablist" aria-label={t("standings:viewsLabel")}>
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={view === v.key}
            className={view === v.key ? "tab-button tab-button-active" : "tab-button"}
            onClick={() => setView(v.key)}
          >
            {t(v.label)}
          </button>
        ))}
      </div>

      <div className="filters">
        <select value={effectiveSeason ?? ""} onChange={(e) => setSeason(e.target.value)}>
          {seasons?.map((s) => (
            <option key={s} value={s}>
              {s.slice(0, 2)}/{s.slice(2)}
            </option>
          ))}
        </select>

        <div className="tab-group">
          {SPLITS.map((key) => (
            <button
              key={key}
              className={split === key ? "tab-button tab-button-active" : "tab-button"}
              onClick={() => setSplit(key)}
            >
              {t(`standings:split.${key}`)}
            </button>
          ))}
        </div>

        <label className="filter-label">
          {t("standings:minMatches")}
          <select value={minMatches} onChange={(e) => setMinMatches(Number(e.target.value))}>
            {MIN_MATCHES_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? t("standings:minMatchesAll") : n}
              </option>
            ))}
          </select>
        </label>

        <label className="filter-label">
          <input type="checkbox" checked={heatmap} onChange={(e) => setHeatmap(e.target.checked)} />
          {t("standings:heatmap")}
        </label>

        <label className="filter-label">
          <input type="checkbox" checked={showForm} onChange={(e) => setShowForm(e.target.checked)} />
          {t("standings:form.column")}
        </label>
      </div>

      {noCornersYet && (
        <p className="small muted intro-note">
          {effectiveSeason
            ? t("standings:noCorners", { season: `${effectiveSeason.slice(0, 2)}/${effectiveSeason.slice(2)}` })
            : t("standings:noCornersSelected")}
        </p>
      )}

      {loading && <LoadingView label={t("standings:loading")} />}
      {error && <ErrorView message={t("common:error.api", { error })} />}
      {!loading && !error && standings?.length === 0 && <EmptyView message={t("standings:empty")} />}
      {!loading && !error && standings && standings.length > 0 && sorted?.length === 0 && (
        <EmptyView message={t("standings:emptyFiltered", { n: minMatches })} />
      )}

      {!loading && !error && sorted && sorted.length > 0 && (
          <table className={`predictions-table season-stats-table${withGroupRow ? " with-group-row" : ""}`}>
            <thead>
              {withGroupRow && (
                <tr className="group-row">
                  <th colSpan={showForm ? 3 : 2} />
                  {shownGroups.map(({ group, span }) => (
                    <th key={group} colSpan={span} className={`group-head ${groupClass(group)}`}>
                      {t(GROUP_LABEL[group])}
                    </th>
                  ))}
                </tr>
              )}
              <tr>
                <th className="num stats-pos">#</th>
                <th className="stats-team">{t("standings:team")}</th>
                {showForm && (
                  <th className="stats-form" title={t("standings:form.columnTitle")}>
                    {t("standings:form.column")}
                  </th>
                )}
                {shown.map((col, i) => {
                  const active = sort.key === col.key;
                  const classes = ["num", "sortable"];
                  if (col.hide) classes.push(`hide-${col.hide}`);
                  if (active) classes.push("sorted");
                  if (i > 0 && shown[i - 1].group !== col.group) classes.push("group-start", groupClass(col.group));
                  return (
                    <th
                      key={col.key}
                      className={classes.join(" ")}
                      title={t(col.title)}
                      aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}
                    >
                      <button type="button" onClick={() => toggleSort(col.key)}>
                        {col.short ? (
                          <>
                            <span className="label-long">{t(col.label)}</span>
                            <span className="label-short">{t(col.short)}</span>
                          </>
                        ) : (
                          t(col.label)
                        )}
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
                    <td className="num muted stats-pos">{position.get(team.team_id)}</td>
                    <td className="stats-team" title={team.team_name}>
                      <TeamName team={team.team_name} league={leagueCode} />
                    </td>
                    {showForm && (
                      <td className="stats-form">
                        <FormDots form={team.form} />
                      </td>
                    )}
                    {shown.map((col, i) => {
                      const classes = ["num"];
                      if (col.hide) classes.push(`hide-${col.hide}`);
                      if (col.lowSampleAware && lowSample) classes.push("low-sample");
                      if (sort.key === col.key) classes.push("sorted");
                      if (i > 0 && shown[i - 1].group !== col.group) classes.push("group-start", groupClass(col.group));
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
      )}

      {!loading && !error && sorted && sorted.length > 0 && (
        <p className="muted small">
          {t("standings:legend", { n: LOW_SAMPLE })}
          {hiddenCount > 0 && ` ${t("standings:hidden", { count: hiddenCount, n: minMatches })}`}
        </p>
      )}
    </div>
  );
}
