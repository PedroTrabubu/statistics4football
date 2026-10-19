import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  getLeagueMatchdays,
  getLeagueResults,
  getLeagueSeasons,
  getLeagues,
  getMatches,
} from "../api/client";
import type { Match, MatchdayInfo, MatchResult } from "../api/types";
import { LeagueSwitch } from "../components/LeagueSwitch";
import { EmptyView, ErrorView, LoadingView } from "../components/StatusView";
import { MatchTeams, TeamCrest, TeamName } from "../components/TeamCrest";
import { formatDateRange, formatDateTime, formatSeason } from "../lib/format";
import {
  DEFAULT_LEAGUE_CODE,
  leagueName,
  leagueParam,
  parseLeagueParam,
  useSelectedLeagueCode,
} from "../lib/leagues";
import {
  MIN_TEAM_PICKS,
  rankTeams,
  summarizeByStrength,
  summarizeByTeam,
  summarizePicks,
  upcomingPicks,
  type MatchPicksResult,
  type PickResult,
  type PicksSummary,
  type ProbablePick,
  type Strength,
  type TeamRankKey,
} from "../lib/patterns";
import { useApi } from "../lib/useApi";
import {
  usePlayedPicks,
  usePlayedPicksMany,
  type SeasonData,
} from "../lib/usePlayedPicks";
import type { DuelForecast } from "../lib/cornerDuel";
import { CornerDuel } from "../components/CornerDuel";
import {
  PredictabilityChip,
  PredictabilityTable,
} from "../components/Predictability";
import { MatchPickLine } from "../components/MatchPick";
import { useMatchPicks } from "../lib/matchPick";
import type { MatchPicksResponse } from "../api/types";

const STRENGTH_LABEL: Record<Strength, string> = {
  alta: "Fuerza alta",
  media: "Fuerza media",
  baja: "Fuerza baja",
};
const STRENGTHS: Strength[] = ["alta", "media", "baja"];
const STRENGTH_SHORT: Record<Strength, string> = {
  alta: "Alta",
  media: "Media",
  baja: "Baja",
};
const pct = (x: number | null) =>
  x === null ? "—" : `${Math.round(x * 100)} %`;

type View = "proxima" | "jornadas" | "resumen" | "equipos";

/** ?temporada=todas: el resumen y la tabla por equipo de todas las temporadas. */
const ALL_SEASONS = "todas";

/** `short`: en movil, para que quepan las cuatro. */
const VIEWS: { key: View; label: string; short: string }[] = [
  { key: "proxima", label: "Próxima jornada", short: "Próxima" },
  { key: "jornadas", label: "Jornadas jugadas", short: "Jugadas" },
  { key: "resumen", label: "Resumen", short: "Resumen" },
  { key: "equipos", label: "Tabla de aciertos", short: "Equipos" },
];

/** Picks muy probables de una liga: los de la proxima jornada (los mismos que
 * en la ficha de cada partido) y, de las jornadas jugadas, si se cumplieron.
 * Liga, temporada, vista y jornada van en la URL (?liga=&temporada=&vista=&jornada=). */
export function PicksHistoryPage() {
  const { data: leagues } = useApi(() => getLeagues(), []);
  const [storedCode, setStoredCode] = useSelectedLeagueCode();
  const [params, setParams] = useSearchParams();
  const setParam = (changes: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  // Sin "todas las ligas": cada liga se comprueba con su propio historial. La
  // del enlace manda; si no hay, la elegida en el resto de la web.
  const fromUrl = leagues
    ? parseLeagueParam(params.get("liga"), leagues)
    : undefined;
  const leagueCode = fromUrl ?? storedCode ?? DEFAULT_LEAGUE_CODE;
  const league = leagues?.find((l) => l.code === leagueCode);
  useEffect(() => {
    if (!league) return;
    if (storedCode !== league.code) setStoredCode(league.code);
    if (params.get("liga") !== leagueParam(league))
      setParam({ liga: leagueParam(league) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league, storedCode, params]);
  const changeLeague = (code: string | null) => {
    const next = leagues?.find((l) => l.code === code);
    if (!next) return;
    setStoredCode(next.code);
    setParam({ liga: leagueParam(next), temporada: null, jornada: null });
  };

  const { data: seasons } = useApi(
    () => (league ? getLeagueSeasons(league.id) : Promise.resolve(null)),
    [league?.id],
  );
  const seasonParam = params.get("temporada");
  const wantsAll = seasonParam === ALL_SEASONS;
  // Con "todas", la temporada suelta es la actual (jornadas y proxima jornada).
  const season = seasons?.length
    ? seasonParam && seasons.includes(seasonParam)
      ? seasonParam
      : seasons[0]
    : null;
  const previous =
    seasons && season ? (seasons[seasons.indexOf(season) + 1] ?? null) : null;

  // Los patrones de cada partido salen de su temporada y la anterior, como en su ficha.
  const data = useApi<SeasonData | null>(
    () =>
      league && season
        ? Promise.all([
            getLeagueResults(league.id, season),
            previous
              ? getLeagueResults(league.id, previous)
              : Promise.resolve([] as MatchResult[]),
          ]).then(([played, before]) => ({
            key: `${league.id}|${season}`,
            played,
            history: [...played, ...before],
          }))
        : Promise.resolve(null),
    [league?.id, season, previous],
  );
  const current =
    data.data && league && data.data.key === `${league.id}|${season}`
      ? data.data
      : null;
  const check = usePlayedPicks(current);

  // Todas las temporadas: cada una con la anterior como historial, como en su
  // ficha, y cada una con su cache (las ya abiertas no se recalculan).
  const allData = useApi<SeasonData[] | null>(
    () =>
      league && seasons && wantsAll
        ? Promise.all(seasons.map((s) => getLeagueResults(league.id, s))).then(
            (results) =>
              seasons.map((s, i) => ({
                key: `${league.id}|${s}`,
                played: results[i],
                history: [...results[i], ...(results[i + 1] ?? [])],
              })),
          )
        : Promise.resolve(null),
    [league?.id, seasons?.join(), wantsAll],
  );
  const allCheck = usePlayedPicksMany(
    allData.data && league && allData.data[0]?.key.startsWith(`${league.id}|`)
      ? allData.data
      : null,
  );

  // Proxima jornada: la que Partidos abre por defecto, con sus partidos pendientes.
  const { data: nextInfo } = useApi(
    () => (league ? getLeagueMatchdays(league.id) : Promise.resolve(null)),
    [league?.id],
  );
  const nextSeason = nextInfo?.season ?? null;
  // La primera jornada, desde la actual, con partidos aún por jugarse. Una
  // jornada cuyos pendientes ya tenían que haberse jugado (cancelados o
  // aplazados sin nueva fecha) no cuenta: si no, se quedaría ahí.
  const nextMatchday = useMemo(() => {
    if (!nextInfo) return null;
    const recent = Date.now() - 3 * 3_600_000;
    const utc = (d: string) => Date.parse(d.endsWith("Z") ? d : `${d}Z`);
    const pending = nextInfo.matchdays.find(
      (m) =>
        m.matchday >= (nextInfo.current ?? 0) &&
        m.played < m.total &&
        utc(m.end) >= recent,
    );
    return pending?.matchday ?? nextInfo.current ?? null;
  }, [nextInfo]);
  const nextKey = league && nextSeason ? `${league.id}|${nextSeason}` : null;
  const nextMatches = useApi(
    () =>
      league && nextSeason && nextMatchday !== null
        ? getMatches({
            league_id: league.id,
            season: nextSeason,
            matchday: nextMatchday,
            limit: 50,
          })
        : Promise.resolve(null),
    [league?.id, nextSeason, nextMatchday],
  );
  // Sus picks salen de la temporada de la jornada y la anterior, como en cada
  // ficha. Si es la temporada elegida abajo, se aprovecha lo ya cargado.
  const nextHistoryApi = useApi(() => {
    if (
      !league ||
      !nextSeason ||
      !nextKey ||
      !seasons ||
      !current ||
      current.key === nextKey
    ) {
      return Promise.resolve(null);
    }
    const i = seasons.indexOf(nextSeason);
    const prev = i >= 0 ? seasons[i + 1] : seasons[0];
    return Promise.all([
      i >= 0
        ? getLeagueResults(league.id, nextSeason)
        : Promise.resolve([] as MatchResult[]),
      prev
        ? getLeagueResults(league.id, prev)
        : Promise.resolve([] as MatchResult[]),
    ]).then(([played, before]) => ({
      key: nextKey,
      history: [...played, ...before],
    }));
  }, [nextKey, current?.key, seasons?.join()]);
  const nextHistory =
    current && current.key === nextKey
      ? current.history
      : nextHistoryApi.data?.key === nextKey
        ? nextHistoryApi.data.history
        : null;
  const nextList = nextMatches.data?.every((m) => m.league_id === league?.id)
    ? nextMatches.data
    : null;
  const upcoming = useMemo(
    () =>
      nextList && nextHistory ? upcomingPicks(nextList, nextHistory) : null,
    [nextList, nextHistory],
  );

  // Vista: la de la URL; sin ella, la proxima jornada (o las jugadas si no hay).
  const viewParam = params.get("vista");
  const noNext = nextInfo !== null && nextMatchday === null;
  const asked: View = VIEWS.some((v) => v.key === viewParam)
    ? (viewParam as View)
    : "proxima";
  const view: View = asked === "proxima" && noNext ? "jornadas" : asked;
  const jornada = Number(params.get("jornada")) || null;
  const fuerzaParam = params.get("fuerza");
  const strength = STRENGTHS.includes(fuerzaParam as Strength)
    ? (fuerzaParam as Strength)
    : null;

  // Al cambiar de vista con la pagina bajada, se vuelve al principio del
  // contenido. La posicion sale de un marcador justo antes de la barra: la de
  // la barra, ya fija, seria la de pegada arriba.
  const anchor = useRef<HTMLDivElement>(null);
  const changeView = (next: View) => {
    setParam({ vista: next });
    if (!anchor.current) return;
    const navbar =
      document.querySelector(".app-navbar")?.getBoundingClientRect().height ??
      0;
    const top =
      anchor.current.getBoundingClientRect().top + window.scrollY - navbar;
    if (window.scrollY > top) window.scrollTo({ top });
  };

  const history = view !== "proxima";
  // Las jornadas jugadas son siempre de una temporada.
  const allSeasons = wantsAll && view !== "jornadas";
  const shown = allSeasons ? allCheck : check;
  const shownError = allSeasons ? allData.error : data.error;

  return (
    <div>
      <h1>Picks muy probables</h1>
      <p className="page-lead">
        Los de la próxima jornada, los mismos que salen en la ficha de cada
        partido. Y, de cada partido ya jugado, los que se mostraban antes de
        jugarse, calculados solo con los partidos anteriores, y si se
        cumplieron.
      </p>

      <LeagueSwitch
        leagues={leagues}
        value={leagueCode}
        onChange={changeLeague}
      />

      <div ref={anchor} />
      <div className="picks-toolbar">
        <div className="tab-group picks-tabs" role="tablist" aria-label="Vista">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              disabled={v.key === "proxima" && noNext}
              title={
                v.key === "proxima" && noNext
                  ? "No hay partidos pendientes en esta liga"
                  : undefined
              }
              className={
                view === v.key ? "tab-button tab-button-active" : "tab-button"
              }
              onClick={() => changeView(v.key)}
            >
              <span className="label-long">{v.label}</span>
              <span className="label-short">{v.short}</span>
            </button>
          ))}
        </div>
        {history && seasons && season && (
          <label className="picks-season">
            <span>Temporada</span>
            <select
              value={allSeasons ? ALL_SEASONS : season}
              onChange={(e) =>
                setParam({
                  temporada:
                    e.target.value === seasons[0] ? null : e.target.value,
                  jornada: null,
                })
              }
            >
              {view !== "jornadas" && (
                <option value={ALL_SEASONS}>Todas las temporadas</option>
              )}
              {seasons.map((s, i) => (
                <option key={s} value={s}>
                  {formatSeason(s)}
                  {i === 0 ? " (actual)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {view === "proxima" && nextMatchday !== null && (
        <NextMatchday
          matchday={nextMatchday}
          info={
            nextInfo?.matchdays.find((m) => m.matchday === nextMatchday) ?? null
          }
          upcoming={upcoming}
          error={nextMatches.error ?? nextHistoryApi.error}
          league={leagueCode}
          history={nextHistory}
          strength={strength}
          onStrength={(level) => setParam({ fuerza: level })}
        />
      )}
      {view === "proxima" && nextInfo === null && (
        <LoadingView label="Buscando la próxima jornada..." />
      )}

      {history && !allSeasons && !previous && seasons && (
        <p className="small muted">
          Primera temporada con datos: los patrones solo pueden usar esta
          temporada.
        </p>
      )}
      {history && shownError && (
        <ErrorView message={`No se pudo conectar con la API: ${shownError}`} />
      )}
      {history && !shownError && !shown.results && (
        <LoadingView
          label={
            shown.total
              ? `Comprobando partidos${allSeasons ? " de todas las temporadas" : ""}: ${shown.done} de ${shown.total}...`
              : "Cargando partidos..."
          }
        />
      )}
      {history && shown.results && shown.results.length === 0 && (
        <EmptyView message="Aún no hay partidos jugados en esta temporada." />
      )}
      {history &&
        shown.results &&
        shown.results.length > 0 &&
        season && (
          <>
            {view === "jornadas" && current && check.results && (
              <MatchdayResults
                key={current.key}
                results={check.results}
                league={leagueCode}
                matchday={jornada}
                onMatchday={(m) => setParam({ jornada: String(m) })}
                strength={strength}
                onStrength={(level) => setParam({ fuerza: level })}
              />
            )}
            {view === "resumen" && (
              <>
                <SeasonSummary
                  results={shown.results}
                  title={
                    allSeasons
                      ? `Todas las temporadas (${formatSeason(seasons![seasons!.length - 1])} a ${formatSeason(seasons![0])})`
                      : `Temporada ${formatSeason(season)}`
                  }
                />
                <PredictabilityTable league={leagueCode} />
              </>
            )}
            {view === "equipos" && (
              <TeamRanking results={shown.results} league={leagueCode} />
            )}
          </>
        )}

      <p className="small muted picks-disclaimer">
        Patrones históricos de alta frecuencia. No son predicciones garantizadas
        ni recomendaciones de apuesta.
      </p>
    </div>
  );
}

/** Los partidos pendientes de la proxima jornada con sus picks. */
function NextMatchday({
  matchday,
  info,
  upcoming,
  error,
  league,
  history,
  strength,
  onStrength,
}: {
  matchday: number;
  info: MatchdayInfo | null;
  upcoming:
    | {
        match: Match;
        picks: ProbablePick[];
        duelPicks: ProbablePick[];
        duel: DuelForecast | null;
      }[]
    | null;
  error: string | null;
  league: string;
  history: MatchResult[] | null;
  /** Solo los picks de esa fuerza (null: todos). */
  strength: Strength | null;
  onStrength: (strength: Strength | null) => void;
}) {
  const picks = upcoming?.flatMap((u) => u.picks) ?? [];
  const counts = strengthCounts(picks);
  const visible = (upcoming ?? []).filter(
    (u) => strength === null || u.picks.some((p) => p.strength === strength),
  );
  const pickOfMatch = useMatchPicks(upcoming?.map((u) => u.match) ?? null);
  const hidden = (upcoming?.length ?? 0) - visible.length;
  const playedAlready = info ? info.played : 0;

  return (
    <section className="detail-section next-matchday">
      <div className="section-head">
        <h2>Próxima jornada: jornada {matchday}</h2>
        {info && (
          <span className="small muted">
            {formatDateRange(info.start, info.end)}
          </span>
        )}
      </div>
      <p className="small muted">
        Calculados con todo lo jugado hasta hoy. Cuando se jueguen, aparecerán
        abajo con su resultado.
      </p>

      {error ? (
        <ErrorView message={`No se pudo conectar con la API: ${error}`} />
      ) : upcoming === null ? (
        <LoadingView label="Calculando los picks de la próxima jornada..." />
      ) : upcoming.length === 0 ? (
        <EmptyView message="No hay partidos pendientes en esta liga." />
      ) : (
        <>
          <p className="next-matchday-summary">
            <strong>{upcoming.length}</strong> partidos pendientes,{" "}
            <strong>{picks.length}</strong> picks: {counts.alta} de fuerza alta,{" "}
            {counts.media} de fuerza media y {counts.baja} de fuerza baja.
          </p>
          <StrengthFilter
            counts={counts}
            value={strength}
            onChange={onStrength}
          />
          {strength !== null && hidden > 0 && (
            <p className="small muted">
              {hidden}{" "}
              {hidden === 1 ? "partido no tiene" : "partidos no tienen"} picks
              de {STRENGTH_LABEL[strength].toLowerCase()}.
            </p>
          )}
          <div className="checked-matches">
            {visible.map(({ match, picks: matchPicks, duelPicks, duel }) => (
              <MatchPicksCard
                key={match.id}
                match={match}
                results={matchPicks.map((pick) => ({ pick }))}
                league={league}
                duel={duel}
                duelPicks={duelPicks.map((pick) => ({ pick }))}
                history={history}
                strength={strength}
                matchPicks={pickOfMatch}
              />
            ))}
          </div>
        </>
      )}
      {playedAlready > 0 && upcoming !== null && (
        <p className="small muted">
          {playedAlready}{" "}
          {playedAlready === 1
            ? "partido de esta jornada ya jugado está"
            : "partidos de esta jornada ya jugados están"}{" "}
          abajo, con su resultado.
        </p>
      )}
    </section>
  );
}

function strengthCounts(picks: ProbablePick[]): Record<Strength, number> {
  return {
    alta: picks.filter((p) => p.strength === "alta").length,
    media: picks.filter((p) => p.strength === "media").length,
    baja: picks.filter((p) => p.strength === "baja").length,
  };
}

/** Todas · Alta · Media · Baja, con los picks de cada una. */
function StrengthFilter({
  counts,
  value,
  onChange,
}: {
  counts: Record<Strength, number>;
  value: Strength | null;
  onChange: (strength: Strength | null) => void;
}) {
  return (
    <div className="strength-filter" role="group" aria-label="Fuerza">
      <span className="small muted">Fuerza:</span>
      {[null, ...STRENGTHS].map((level) => (
        <button
          key={level ?? "todas"}
          type="button"
          className={`group-chip${level ? ` strength-chip-${level}` : ""}`}
          aria-pressed={value === level}
          disabled={level !== null && counts[level] === 0}
          onClick={() => onChange(level)}
        >
          {level === null ? "Todas" : STRENGTH_SHORT[level]}
          <span className="chip-count">
            {level === null
              ? counts.alta + counts.media + counts.baja
              : counts[level]}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Barra del acierto (verde si supera a la liga, roja si no) con una marca en
 * lo que pasa en la liga. */
function RateMeter({
  rate,
  expected,
}: {
  rate: number | null;
  expected: number | null;
}) {
  if (rate === null) return <span className="muted">—</span>;
  const good = expected === null || rate >= expected;
  return (
    <span className="rate-meter">
      <span className="rate-meter-track">
        <span
          className={`rate-meter-fill ${good ? "rate-good" : "rate-bad"}`}
          style={{ width: `${rate * 100}%` }}
        />
        {expected !== null && (
          <span
            className="rate-meter-mark"
            style={{ left: `${expected * 100}%` }}
          />
        )}
      </span>
      <strong className={good ? "edge-up" : "edge-down"}>{pct(rate)}</strong>
    </span>
  );
}

/** Puntos por encima o por debajo de la liga. */
function EdgePill({
  rate,
  expected,
}: {
  rate: number | null;
  expected: number | null;
}) {
  if (rate === null || expected === null)
    return <span className="muted">—</span>;
  const edge = Math.round((rate - expected) * 100);
  return (
    <span
      className={`edge-pill ${edge > 0 ? "edge-pill-up" : edge < 0 ? "edge-pill-down" : ""}`}
    >
      {edge > 0 ? `+${edge}` : edge} pts
    </span>
  );
}

function SeasonSummary({
  results,
  title,
}: {
  results: MatchPicksResult[];
  title: string;
}) {
  const by = summarizeByStrength(results);
  const rows: [string, PicksSummary, string][] = [
    [STRENGTH_LABEL.alta, by.alta, "alta"],
    [STRENGTH_LABEL.media, by.media, "media"],
    [STRENGTH_LABEL.baja, by.baja, "baja"],
    ["Todos", by.total, "total"],
  ];
  const { rate, expected } = by.total;
  const edge =
    rate !== null && expected !== null
      ? Math.round((rate - expected) * 100)
      : null;

  return (
    <section className="detail-section picks-summary">
      <h2>{title}</h2>
      <p>
        De <strong>{by.total.total}</strong> picks en{" "}
        <strong>{results.length}</strong> partidos se cumplieron{" "}
        <strong>{by.total.hits}</strong> ({pct(rate)}). En la liga, esos mismos
        sucesos pasan el {pct(expected)}
        {edge !== null && (
          <span
            className={
              edge > 0 ? "edge-up" : edge < 0 ? "edge-down" : undefined
            }
          >
            {edge > 0
              ? `: ${edge} puntos más.`
              : edge < 0
                ? `: ${-edge} puntos menos.`
                : ": lo mismo."}
          </span>
        )}
      </p>
      <div className="table-scroll">
        <table className="predictions-table picks-summary-table">
          <thead>
            <tr>
              <th>Nivel</th>
              <th className="num">Picks</th>
              <th className="num">Se cumplieron</th>
              <th className="num">Fallaron</th>
              <th>Acierto</th>
              <th
                className="num"
                title="Frecuencia de esos mismos sucesos en la liga: lo esperable sin patrón"
              >
                En la liga
              </th>
              <th className="num">Ventaja</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, s, key]) => (
              <tr
                key={key}
                className={key === "total" ? "picks-summary-total" : undefined}
              >
                <td>
                  {key === "total" ? (
                    label
                  ) : (
                    <span className={`pick-strength pick-strength-${key}`}>
                      {label}
                    </span>
                  )}
                </td>
                <td className="num">{s.total}</td>
                <td className="num summary-hits">{s.hits}</td>
                <td className="num summary-misses">{s.total - s.hits}</td>
                <td
                  title={
                    s.low !== null
                      ? `Intervalo 95 %: ${pct(s.low)}–${pct(s.high)}`
                      : undefined
                  }
                >
                  <RateMeter rate={s.rate} expected={s.expected} />
                </td>
                <td className="num">{pct(s.expected)}</td>
                <td className="num">
                  <EdgePill rate={s.rate} expected={s.expected} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {by.total.undecided > 0 && (
        <p className="small muted">
          {by.total.undecided} picks sin dato en el partido: no cuentan.
        </p>
      )}
    </section>
  );
}

/** `short`: la cabecera en movil, donde no cabe la larga. */
const RANK_COLUMNS: { key: TeamRankKey; label: string; short: string }[] = [
  { key: "alta", label: "Fuerza alta", short: "Alta" },
  { key: "media", label: "Fuerza media", short: "Media" },
  { key: "top", label: "Alta y media", short: "Total" },
];

/** Clasificacion de equipos por acierto de sus picks (los de su historial). */
function TeamRanking({
  results,
  league,
}: {
  results: MatchPicksResult[];
  league: string;
}) {
  const [sortKey, setSortKey] = useState<TeamRankKey>("top");
  const ranked = useMemo(
    () => rankTeams(summarizeByTeam(results), sortKey),
    [results, sortKey],
  );
  const enough = (s: PicksSummary) => s.total >= MIN_TEAM_PICKS;

  return (
    <section className="detail-section team-ranking">
      <h2>Tabla de aciertos por equipo</h2>
      <p className="small muted">
        Acierto de los picks que salen del historial de cada equipo. Pulsa una
        columna para ordenar por ella. Con menos de {MIN_TEAM_PICKS} picks en
        esa columna, al final de la lista. «Ventaja»: puntos por encima o por
        debajo de lo que pasa en la liga para esos mismos sucesos.
      </p>
      <div className="table-scroll">
        <table className="predictions-table team-ranking-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Equipo</th>
              {RANK_COLUMNS.map(({ key, label, short }) => (
                <th
                  key={key}
                  className={
                    sortKey === key ? "num sortable sorted" : "num sortable"
                  }
                  aria-sort={sortKey === key ? "descending" : "none"}
                >
                  <button type="button" onClick={() => setSortKey(key)}>
                    <span className="label-long">{label}</span>
                    <span className="label-short">{short}</span>
                    <span className="sort-arrow">
                      {sortKey === key ? "▼" : ""}
                    </span>
                  </button>
                </th>
              ))}
              <th
                className="num"
                title="Acierto en alta y media menos lo que pasa en la liga para esos sucesos"
              >
                <span className="label-long">Ventaja</span>
                <span className="label-short">Vent.</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((team, i) => {
              const { rate, expected } = team.top;
              const edge =
                rate !== null && expected !== null
                  ? Math.round((rate - expected) * 100)
                  : null;
              return (
                <tr
                  key={team.teamId}
                  className={
                    enough(team[sortKey]) ? undefined : "team-ranking-small"
                  }
                >
                  <td className="num muted">{i + 1}</td>
                  <td>
                    <TeamName team={team.team} league={league} />
                  </td>
                  {RANK_COLUMNS.map(({ key }) => (
                    <td
                      key={key}
                      className={sortKey === key ? "num sorted" : "num"}
                    >
                      <RateCell summary={team[key]} />
                    </td>
                  ))}
                  <td
                    className={
                      edge === null
                        ? "num"
                        : edge > 0
                          ? "num ev-positive"
                          : edge < 0
                            ? "num ev-negative"
                            : "num"
                    }
                  >
                    {edge === null ? "—" : `${edge > 0 ? "+" : ""}${edge}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** "84 %" y debajo "21 de 25"; al pasar por encima, el intervalo al 95 %
 * (con pocos picks, muy ancho). */
function RateCell({ summary }: { summary: PicksSummary }) {
  if (summary.total === 0) return <span className="muted">—</span>;
  return (
    <span
      className="rate-cell"
      title={`Intervalo 95 %: ${pct(summary.low)}–${pct(summary.high)}`}
    >
      <strong>{pct(summary.rate)}</strong>
      <span className="small muted rate-n-long">
        {summary.hits} de {summary.total}
      </span>
      <span className="small muted rate-n-short">
        {summary.hits}/{summary.total}
      </span>
    </span>
  );
}

/** Una jornada: sus partidos con los picks y si se cumplieron. Se abre en la
 * ultima jugada. */
function MatchdayResults({
  results,
  league,
  matchday: choice,
  onMatchday: setChoice,
  strength,
  onStrength,
}: {
  results: MatchPicksResult[];
  league: string;
  /** La de la URL; sin ella (o si no existe), la ultima jugada. */
  matchday: number | null;
  onMatchday: (matchday: number) => void;
  /** Solo los picks de esa fuerza (null: todos). */
  strength: Strength | null;
  onStrength: (strength: Strength | null) => void;
}) {
  const matchdays = useMemo(
    () =>
      [...new Set(results.map((r) => r.match.matchday ?? 0))].sort(
        (a, b) => a - b,
      ),
    [results],
  );
  const matchday =
    choice !== null && matchdays.includes(choice)
      ? choice
      : matchdays[matchdays.length - 1];
  const index = matchdays.indexOf(matchday);
  const all = results
    .filter((r) => (r.match.matchday ?? 0) === matchday)
    .sort((a, b) => a.match.date.localeCompare(b.match.date));
  // Con un filtro de fuerza, cada partido solo con esos picks; fuera los que no tienen ninguno.
  const keep = (r: PickResult) =>
    strength === null || r.pick.strength === strength;
  const filtered = all.map((r) => ({
    ...r,
    picks: r.picks.filter(keep),
    duelPicks: r.duelPicks.filter(keep),
  }));
  const rows =
    strength === null ? filtered : filtered.filter((r) => r.picks.length > 0);
  const hidden = all.length - rows.length;
  const visibleIds = new Set(rows.map((r) => r.match.id));
  const pickOfMatch = useMatchPicks(all.map((r) => r.match));
  const summary = summarizePicks(rows.flatMap((r) => r.picks));
  const range = (m: number) => {
    const ds = results
      .filter((r) => (r.match.matchday ?? 0) === m)
      .map((r) => r.match.date)
      .sort();
    return formatDateRange(ds[0], ds[ds.length - 1]);
  };

  return (
    <section className="picks-matchday">
      <div className="filters matchday-nav">
        <h2>Jornada {matchday}</h2>
        <div className="matchday-nav-group">
          <span className="small muted">
            {summary.hits} de {summary.total} ({pct(summary.rate)})
          </span>
          <button
            type="button"
            disabled={index <= 0}
            onClick={() => setChoice(matchdays[index - 1])}
            aria-label="Jornada anterior"
          >
            ←
          </button>
          <select
            aria-label="Jornada"
            value={matchday}
            onChange={(e) => setChoice(Number(e.target.value))}
          >
            {matchdays.map((m) => (
              <option key={m} value={m}>
                Jornada {m} · {range(m)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={index >= matchdays.length - 1}
            onClick={() => setChoice(matchdays[index + 1])}
            aria-label="Jornada siguiente"
          >
            →
          </button>
        </div>
      </div>
      <StrengthFilter
        counts={strengthCounts(all.flatMap((r) => r.picks.map((p) => p.pick)))}
        value={strength}
        onChange={onStrength}
      />
      {strength !== null && hidden > 0 && (
        <p className="small muted">
          {hidden} {hidden === 1 ? "partido no tiene" : "partidos no tienen"}{" "}
          picks de {STRENGTH_LABEL[strength].toLowerCase()} en esta jornada.
        </p>
      )}
      <MatchdaySummary
        matchday={matchday}
        league={league}
        picks={rows.flatMap((r) => r.picks)}
        rows={rows}
      />
      <div className="checked-matches">
        {all
          .filter((r) => visibleIds.has(r.match.id))
          .map(({ match, picks, duelPicks, duel }) => (
            <MatchPicksCard
              key={match.id}
              match={match}
              results={picks}
              league={league}
              duel={duel}
              duelPicks={duelPicks}
              strength={strength}
              matchPicks={pickOfMatch}
            />
          ))}
      </div>
    </section>
  );
}

/** Lo que se acertó en la jornada: total, por fuerza y frente a la liga. */
function MatchdaySummary({
  matchday,
  league,
  picks,
  rows,
}: {
  matchday: number;
  league: string;
  picks: PickResult[];
  rows: MatchPicksResult[];
}) {
  const total = summarizePicks(picks);
  // Duelo de córners: el resultado más probable del modelo y los picks del duelo.
  const duels = rows.flatMap(({ match, duel }) => {
    const h = match.home_stats?.corners;
    const a = match.away_stats?.corners;
    if (!duel || h == null || a == null) return [];
    const best =
      duel.home >= duel.draw && duel.home >= duel.away
        ? 0
        : duel.away >= duel.draw
          ? 2
          : 1;
    return [best === (h > a ? 0 : h === a ? 1 : 2)];
  });
  const duelHits = duels.filter(Boolean).length;
  const duelPicks = summarizePicks(rows.flatMap((r) => r.duelPicks));
  if (total.total === 0) return null;
  const edge =
    total.rate !== null && total.expected !== null
      ? Math.round((total.rate - total.expected) * 100)
      : null;
  const tone =
    edge === null
      ? ""
      : edge >= 0
        ? " matchday-summary-up"
        : " matchday-summary-down";
  const levels = (["alta", "media", "baja"] as const)
    .map(
      (level) =>
        [
          level,
          summarizePicks(picks.filter((r) => r.pick.strength === level)),
        ] as const,
    )
    .filter(([, sum]) => sum.total > 0);
  return (
    <div className={`matchday-summary${tone}`}>
      <p className="matchday-summary-head">
        Jornada {matchday} en {leagueName(league)}: se cumplieron{" "}
        <strong>
          {total.hits} de {total.total}
        </strong>{" "}
        picks{" "}
        <span
          className={`edge-pill ${edge !== null && edge >= 0 ? "edge-pill-up" : "edge-pill-down"}`}
        >
          {pct(total.rate)}
        </span>
      </p>
      <ul className="matchday-summary-levels">
        {levels.map(([level, sum]) => (
          <li key={level}>
            <span className={`pick-strength pick-strength-${level}`}>
              {STRENGTH_LABEL[level]}
            </span>{" "}
            {sum.hits} de {sum.total}{" "}
            <strong
              className={
                sum.expected === null || (sum.rate ?? 0) >= sum.expected
                  ? "edge-up"
                  : "edge-down"
              }
            >
              {pct(sum.rate)}
            </strong>
          </li>
        ))}
      </ul>
      <p className="small">
        En la liga, esos mismos sucesos pasan el {pct(total.expected)}
        {edge !== null && (
          <span className={edge >= 0 ? "edge-up" : "edge-down"}>
            {edge > 0
              ? `: ${edge} puntos más.`
              : edge < 0
                ? `: ${-edge} puntos menos.`
                : ": lo mismo."}
          </span>
        )}
        {total.undecided > 0 &&
          ` ${total.undecided} picks aún sin dato del partido: no cuentan.`}
      </p>
      {duels.length > 0 && (
        <p className="small matchday-summary-duel">
          <strong>Duelo de córners:</strong> el resultado más probable acertó en{" "}
          <strong
            className={duelHits * 2 >= duels.length ? "edge-up" : "edge-down"}
          >
            {duelHits} de {duels.length}
          </strong>{" "}
          partidos ({pct(duelHits / duels.length)})
          {duelPicks.total > 0 && (
            <>
              {" "}
              · picks muy probables del duelo:{" "}
              <strong
                className={
                  (duelPicks.rate ?? 0) >= (duelPicks.expected ?? 0)
                    ? "edge-up"
                    : "edge-down"
                }
              >
                {duelPicks.hits} de {duelPicks.total}
              </strong>{" "}
              ({pct(duelPicks.rate)})
            </>
          )}
          .
        </p>
      )}
    </div>
  );
}

/** Un pick y, si el partido ya se jugo, si se cumplio (sin `hit`: pendiente). */
interface CardPick {
  pick: ProbablePick;
  hit?: boolean | null;
}

/** Un partido con sus picks: con el marcador y ✓/✗ si ya se jugo. Debajo,
 * el duelo de córners (nuevo, fuera de las cifras de acierto). */
function MatchPicksCard({
  match,
  results,
  league,
  duel,
  duelPicks: allDuelPicks,
  history = null,
  strength = null,
  matchPicks = null,
}: {
  match: Match;
  /** Todos los picks del partido (el indice se calcula con todos). */
  results: CardPick[];
  league: string;
  duel: DuelForecast | null;
  duelPicks: CardPick[];
  /** Partidos de la liga: solo para el indice de un partido por jugar. */
  history?: MatchResult[] | null;
  /** Solo se muestran y cuentan los picks de esa fuerza. */
  strength?: Strength | null;
  /** Picks del partido de la lista (una sola peticion para todas las tarjetas). */
  matchPicks?: MatchPicksResponse | null;
}) {
  const played = match.status === "historical";
  const keep = (r: CardPick) =>
    strength === null || r.pick.strength === strength;
  const shown = results.filter(keep);
  const duelPicks = allDuelPicks.filter(keep);
  const decided = shown.filter((r) => r.hit === true || r.hit === false);
  const hits = decided.filter((r) => r.hit).length;
  // Verde si acierta al menos lo que pasa en la liga con esos mismos sucesos.
  const withBase = decided.filter((r) => r.pick.leagueRate !== null);
  const expected = withBase.reduce((sum, r) => sum + r.pick.leagueRate!, 0);
  return (
    <article className="checked-match">
      <Link to={`/matches/${match.id}`} className="checked-match-head">
        <MatchTeams
          home={match.home_team}
          away={match.away_team}
          league={match.league_code}
          middle={
            played ? (
              <span className="match-row-score">
                {match.home_goals} - {match.away_goals}
              </span>
            ) : (
              <span className="match-row-score match-row-vs">vs</span>
            )
          }
        />
        <span className="checked-match-when">
          <span className="small muted">{formatDateTime(match.date)}</span>
          {played && decided.length > 0 && (
            <span
              className={`checked-match-hits ${hits >= expected ? "edge-up" : "edge-down"}`}
              title={`Se cumplieron ${hits} de ${decided.length} picks; en la liga, esos sucesos pasan ${expected.toFixed(1)} de ${withBase.length}${decided.length < shown.length ? ` · ${shown.length - decided.length} sin dato` : ""}`}
            >
              {hits}/{decided.length}
            </span>
          )}
        </span>
      </Link>
      <PredictabilityChip
        match={match}
        picks={results.map((r) => r.pick)}
        history={history}
      />
      {matchPicks && (
        <MatchPickLine
          entry={matchPicks.matches[String(match.id)]}
          kinds={matchPicks.kinds}
        />
      )}
      {shown.length === 0 ? (
        <p className="small muted">
          Sin picks: no hay patrones con muestra suficiente.
        </p>
      ) : (
        <ul className="checked-picks">
          {shown.map((r) => (
            <CheckedPick
              key={`${r.pick.side}-${r.pick.family}-${r.pick.option.key}`}
              result={r}
              league={league}
            />
          ))}
        </ul>
      )}
      <CornerDuel
        compact
        match={match}
        forecast={duel}
        picks={duelPicks}
        played={played ? (match as MatchResult) : null}
      />
    </article>
  );
}

const OUTCOME = {
  hit: { mark: "✓", label: "Se cumplió" },
  miss: { mark: "✗", label: "No se cumplió" },
  unknown: { mark: "–", label: "Sin dato" },
  pending: { mark: "•", label: "Pendiente" },
};

function CheckedPick({ result, league }: { result: CardPick; league: string }) {
  const { pick, hit } = result;
  const outcome =
    hit === undefined
      ? "pending"
      : hit === null
        ? "unknown"
        : hit
          ? "hit"
          : "miss";
  return (
    <li className={`checked-pick checked-${outcome}`}>
      <span
        className="checked-mark"
        role="img"
        aria-label={OUTCOME[outcome].label}
        title={OUTCOME[outcome].label}
      >
        {OUTCOME[outcome].mark}
      </span>
      <TeamCrest team={pick.team} league={league} />
      <span className="checked-text">
        {pick.text}
        <span className="small muted">
          {" "}
          · {pick.team}, {pick.rate.hits} de {pick.rate.total}
        </span>
      </span>
      <span className={`pick-strength pick-strength-${pick.strength}`}>
        {STRENGTH_LABEL[pick.strength]}
      </span>
    </li>
  );
}
