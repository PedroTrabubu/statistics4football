import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getLeagueMatchdays, getLeagueResults, getLeagueSeasons, getLeagues, getMatches } from "../api/client";
import type { Match, MatchdayInfo, MatchResult } from "../api/types";
import { LeagueSwitch } from "../components/LeagueSwitch";
import { EmptyView, ErrorView, LoadingView } from "../components/StatusView";
import { MatchTeams, TeamCrest, TeamName } from "../components/TeamCrest";
import { formatDateRange, formatDateTime, formatSeason } from "../lib/format";
import { DEFAULT_LEAGUE_CODE, leagueName, useSelectedLeagueCode } from "../lib/leagues";
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
import { usePlayedPicks, type SeasonData } from "../lib/usePlayedPicks";
import type { DuelForecast } from "../lib/cornerDuel";
import { CornerDuel } from "../components/CornerDuel";

const STRENGTH_LABEL: Record<Strength, string> = { alta: "Fuerza alta", media: "Fuerza media", baja: "Fuerza baja" };
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)} %`);

/** Picks muy probables de una liga: los de la proxima jornada (los mismos que
 * en la ficha de cada partido) y, de las jornadas jugadas, si se cumplieron. */
export function PicksHistoryPage() {
  const { data: leagues } = useApi(() => getLeagues(), []);
  const [selectedCode, setLeagueCode] = useSelectedLeagueCode();
  // Sin "todas las ligas": cada liga se comprueba con su propio historial.
  const leagueCode = selectedCode ?? DEFAULT_LEAGUE_CODE;
  const league = leagues?.find((l) => l.code === leagueCode);

  const { data: seasons } = useApi(
    () => (league ? getLeagueSeasons(league.id) : Promise.resolve(null)),
    [league?.id],
  );
  const [seasonChoice, setSeasonChoice] = useState<string | null>(null);
  const season = seasons?.length ? (seasonChoice && seasons.includes(seasonChoice) ? seasonChoice : seasons[0]) : null;
  const previous = seasons && season ? (seasons[seasons.indexOf(season) + 1] ?? null) : null;

  // Los patrones de cada partido salen de su temporada y la anterior, como en su ficha.
  const data = useApi<SeasonData | null>(
    () =>
      league && season
        ? Promise.all([
            getLeagueResults(league.id, season),
            previous ? getLeagueResults(league.id, previous) : Promise.resolve([] as MatchResult[]),
          ]).then(([played, before]) => ({ key: `${league.id}|${season}`, played, history: [...played, ...before] }))
        : Promise.resolve(null),
    [league?.id, season, previous],
  );
  const current = data.data && league && data.data.key === `${league.id}|${season}` ? data.data : null;
  const check = usePlayedPicks(current);

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
      (m) => m.matchday >= (nextInfo.current ?? 0) && m.played < m.total && utc(m.end) >= recent,
    );
    return pending?.matchday ?? nextInfo.current ?? null;
  }, [nextInfo]);
  const nextKey = league && nextSeason ? `${league.id}|${nextSeason}` : null;
  const nextMatches = useApi(
    () =>
      league && nextSeason && nextMatchday !== null
        ? getMatches({ league_id: league.id, season: nextSeason, matchday: nextMatchday, limit: 50 })
        : Promise.resolve(null),
    [league?.id, nextSeason, nextMatchday],
  );
  // Sus picks salen de la temporada de la jornada y la anterior, como en cada
  // ficha. Si es la temporada elegida abajo, se aprovecha lo ya cargado.
  const nextHistoryApi = useApi(
    () => {
      if (!league || !nextSeason || !nextKey || !seasons || !current || current.key === nextKey) {
        return Promise.resolve(null);
      }
      const i = seasons.indexOf(nextSeason);
      const prev = i >= 0 ? seasons[i + 1] : seasons[0];
      return Promise.all([
        i >= 0 ? getLeagueResults(league.id, nextSeason) : Promise.resolve([] as MatchResult[]),
        prev ? getLeagueResults(league.id, prev) : Promise.resolve([] as MatchResult[]),
      ]).then(([played, before]) => ({ key: nextKey, history: [...played, ...before] }));
    },
    [nextKey, current?.key, seasons?.join()],
  );
  const nextHistory =
    current && current.key === nextKey
      ? current.history
      : nextHistoryApi.data?.key === nextKey
        ? nextHistoryApi.data.history
        : null;
  const nextList = nextMatches.data?.every((m) => m.league_id === league?.id) ? nextMatches.data : null;
  const upcoming = useMemo(
    () => (nextList && nextHistory ? upcomingPicks(nextList, nextHistory) : null),
    [nextList, nextHistory],
  );

  return (
    <div>
      <h1>Picks muy probables</h1>
      <p className="page-lead">
        Los de la próxima jornada, los mismos que salen en la ficha de cada partido. Y, de cada partido ya jugado, los
        que se mostraban antes de jugarse, calculados solo con los partidos anteriores, y si se cumplieron.
      </p>

      <LeagueSwitch leagues={leagues} value={leagueCode} onChange={(code) => code && setLeagueCode(code)} />

      {nextMatchday !== null && (
        <NextMatchday
          matchday={nextMatchday}
          info={nextInfo?.matchdays.find((m) => m.matchday === nextMatchday) ?? null}
          upcoming={upcoming}
          error={nextMatches.error ?? nextHistoryApi.error}
          league={leagueCode}
        />
      )}

      <h2 className="picks-played-title">Jornadas jugadas: ¿se cumplieron?</h2>
      {seasons && season && (
        <div className="filters">
          <select aria-label="Temporada" value={season} onChange={(e) => setSeasonChoice(e.target.value)}>
            {seasons.map((s) => (
              <option key={s} value={s}>
                Temporada {formatSeason(s)}
              </option>
            ))}
          </select>
          {!previous && (
            <span className="small muted">Primera temporada con datos: los patrones solo pueden usar esta temporada.</span>
          )}
        </div>
      )}

      {data.error && <ErrorView message={`No se pudo conectar con la API: ${data.error}`} />}
      {!data.error && !check.results && (
        <LoadingView
          label={check.total ? `Comprobando partidos: ${check.done} de ${check.total}...` : "Cargando partidos..."}
        />
      )}
      {check.results && check.results.length === 0 && (
        <EmptyView message="Aún no hay partidos jugados en esta temporada." />
      )}
      {check.results && check.results.length > 0 && current && (
        <>
          <SeasonSummary results={check.results} />
          <TeamRanking results={check.results} league={leagueCode} />
          <MatchdayResults key={current.key} results={check.results} league={leagueCode} />
        </>
      )}

      <p className="small muted picks-disclaimer">
        Patrones históricos de alta frecuencia. No son predicciones garantizadas ni recomendaciones de apuesta.
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
}: {
  matchday: number;
  info: MatchdayInfo | null;
  upcoming: { match: Match; picks: ProbablePick[]; duelPicks: ProbablePick[]; duel: DuelForecast | null }[] | null;
  error: string | null;
  league: string;
}) {
  const picks = upcoming?.flatMap((u) => u.picks) ?? [];
  const count = (level: Strength) => picks.filter((p) => p.strength === level).length;
  const playedAlready = info ? info.played : 0;

  return (
    <section className="detail-section next-matchday">
      <div className="section-head">
        <h2>Próxima jornada: jornada {matchday}</h2>
        {info && <span className="small muted">{formatDateRange(info.start, info.end)}</span>}
      </div>
      <p className="small muted">
        Calculados con todo lo jugado hasta hoy. Cuando se jueguen, aparecerán abajo con su resultado.
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
            <strong>{upcoming.length}</strong> partidos pendientes, <strong>{picks.length}</strong> picks:{" "}
            {count("alta")} de fuerza alta, {count("media")} de fuerza media y {count("baja")} de fuerza baja.
          </p>
          <div className="checked-matches">
            {upcoming.map(({ match, picks: matchPicks, duelPicks, duel }) => (
              <MatchPicksCard
                key={match.id}
                match={match}
                results={matchPicks.map((pick) => ({ pick }))}
                league={league}
                duel={duel}
                duelPicks={duelPicks.map((pick) => ({ pick }))}
              />
            ))}
          </div>
        </>
      )}
      {playedAlready > 0 && upcoming !== null && (
        <p className="small muted">
          {playedAlready} {playedAlready === 1 ? "partido de esta jornada ya jugado está" : "partidos de esta jornada ya jugados están"}{" "}
          abajo, con su resultado.
        </p>
      )}
    </section>
  );
}

/** Barra del acierto (verde si supera a la liga, roja si no) con una marca en
 * lo que pasa en la liga. */
function RateMeter({ rate, expected }: { rate: number | null; expected: number | null }) {
  if (rate === null) return <span className="muted">—</span>;
  const good = expected === null || rate >= expected;
  return (
    <span className="rate-meter">
      <span className="rate-meter-track">
        <span className={`rate-meter-fill ${good ? "rate-good" : "rate-bad"}`} style={{ width: `${rate * 100}%` }} />
        {expected !== null && <span className="rate-meter-mark" style={{ left: `${expected * 100}%` }} />}
      </span>
      <strong className={good ? "edge-up" : "edge-down"}>{pct(rate)}</strong>
    </span>
  );
}

/** Puntos por encima o por debajo de la liga. */
function EdgePill({ rate, expected }: { rate: number | null; expected: number | null }) {
  if (rate === null || expected === null) return <span className="muted">—</span>;
  const edge = Math.round((rate - expected) * 100);
  return (
    <span className={`edge-pill ${edge > 0 ? "edge-pill-up" : edge < 0 ? "edge-pill-down" : ""}`}>
      {edge > 0 ? `+${edge}` : edge} pts
    </span>
  );
}

function SeasonSummary({ results }: { results: MatchPicksResult[] }) {
  const by = summarizeByStrength(results);
  const rows: [string, PicksSummary, string][] = [
    [STRENGTH_LABEL.alta, by.alta, "alta"],
    [STRENGTH_LABEL.media, by.media, "media"],
    [STRENGTH_LABEL.baja, by.baja, "baja"],
    ["Todos", by.total, "total"],
  ];
  const { rate, expected } = by.total;
  const edge = rate !== null && expected !== null ? Math.round((rate - expected) * 100) : null;

  return (
    <section className="detail-section picks-summary">
      <h2>Esta temporada</h2>
      <p>
        De <strong>{by.total.total}</strong> picks en <strong>{results.length}</strong> partidos se cumplieron{" "}
        <strong>{by.total.hits}</strong> ({pct(rate)}). En la liga, esos mismos sucesos pasan el {pct(expected)}
        {edge !== null && (
          <span className={edge > 0 ? "edge-up" : edge < 0 ? "edge-down" : undefined}>
            {edge > 0 ? `: ${edge} puntos más.` : edge < 0 ? `: ${-edge} puntos menos.` : ": lo mismo."}
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
              <th className="num" title="Frecuencia de esos mismos sucesos en la liga: lo esperable sin patrón">
                En la liga
              </th>
              <th className="num">Ventaja</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, s, key]) => (
              <tr key={key} className={key === "total" ? "picks-summary-total" : undefined}>
                <td>
                  {key === "total" ? label : <span className={`pick-strength pick-strength-${key}`}>{label}</span>}
                </td>
                <td className="num">{s.total}</td>
                <td className="num summary-hits">{s.hits}</td>
                <td className="num summary-misses">{s.total - s.hits}</td>
                <td title={s.low !== null ? `Intervalo 95 %: ${pct(s.low)}–${pct(s.high)}` : undefined}>
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
        <p className="small muted">{by.total.undecided} picks sin dato en el partido: no cuentan.</p>
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
function TeamRanking({ results, league }: { results: MatchPicksResult[]; league: string }) {
  const [sortKey, setSortKey] = useState<TeamRankKey>("top");
  const ranked = useMemo(() => rankTeams(summarizeByTeam(results), sortKey), [results, sortKey]);
  const enough = (s: PicksSummary) => s.total >= MIN_TEAM_PICKS;

  return (
    <section className="detail-section team-ranking">
      <h2>Por equipo</h2>
      <p className="small muted">
        Acierto de los picks que salen del historial de cada equipo. Pulsa una columna para ordenar por ella. Con menos
        de {MIN_TEAM_PICKS} picks en esa columna, al final de la lista. «Ventaja»: puntos por encima o por debajo de lo
        que pasa en la liga para esos mismos sucesos.
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
                  className={sortKey === key ? "num sortable sorted" : "num sortable"}
                  aria-sort={sortKey === key ? "descending" : "none"}
                >
                  <button type="button" onClick={() => setSortKey(key)}>
                    <span className="label-long">{label}</span>
                    <span className="label-short">{short}</span>
                    <span className="sort-arrow">{sortKey === key ? "▼" : ""}</span>
                  </button>
                </th>
              ))}
              <th className="num" title="Acierto en alta y media menos lo que pasa en la liga para esos sucesos">
                <span className="label-long">Ventaja</span>
                <span className="label-short">Vent.</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((team, i) => {
              const { rate, expected } = team.top;
              const edge = rate !== null && expected !== null ? Math.round((rate - expected) * 100) : null;
              return (
                <tr key={team.teamId} className={enough(team[sortKey]) ? undefined : "team-ranking-small"}>
                  <td className="num muted">{i + 1}</td>
                  <td>
                    <TeamName team={team.team} league={league} />
                  </td>
                  {RANK_COLUMNS.map(({ key }) => (
                    <td key={key} className={sortKey === key ? "num sorted" : "num"}>
                      <RateCell summary={team[key]} />
                    </td>
                  ))}
                  <td className={edge === null ? "num" : edge > 0 ? "num ev-positive" : edge < 0 ? "num ev-negative" : "num"}>
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
    <span className="rate-cell" title={`Intervalo 95 %: ${pct(summary.low)}–${pct(summary.high)}`}>
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
function MatchdayResults({ results, league }: { results: MatchPicksResult[]; league: string }) {
  const matchdays = useMemo(
    () => [...new Set(results.map((r) => r.match.matchday ?? 0))].sort((a, b) => a - b),
    [results],
  );
  const [choice, setChoice] = useState<number | null>(null);
  const matchday = choice !== null && matchdays.includes(choice) ? choice : matchdays[matchdays.length - 1];
  const index = matchdays.indexOf(matchday);
  const rows = results
    .filter((r) => (r.match.matchday ?? 0) === matchday)
    .sort((a, b) => a.match.date.localeCompare(b.match.date));
  const summary = summarizePicks(rows.flatMap((r) => r.picks));
  const range = (m: number) => {
    const ds = results.filter((r) => (r.match.matchday ?? 0) === m).map((r) => r.match.date).sort();
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
          <button type="button" disabled={index <= 0} onClick={() => setChoice(matchdays[index - 1])} aria-label="Jornada anterior">
            ←
          </button>
          <select aria-label="Jornada" value={matchday} onChange={(e) => setChoice(Number(e.target.value))}>
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
      <MatchdaySummary matchday={matchday} league={league} picks={rows.flatMap((r) => r.picks)} rows={rows} />
      <div className="checked-matches">
        {rows.map(({ match, picks, duelPicks, duel }) => (
          <MatchPicksCard key={match.id} match={match} results={picks} league={league} duel={duel} duelPicks={duelPicks} />
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
    const best = duel.home >= duel.draw && duel.home >= duel.away ? 0 : duel.away >= duel.draw ? 2 : 1;
    return [best === (h > a ? 0 : h === a ? 1 : 2)];
  });
  const duelHits = duels.filter(Boolean).length;
  const duelPicks = summarizePicks(rows.flatMap((r) => r.duelPicks));
  if (total.total === 0) return null;
  const edge = total.rate !== null && total.expected !== null ? Math.round((total.rate - total.expected) * 100) : null;
  const tone = edge === null ? "" : edge >= 0 ? " matchday-summary-up" : " matchday-summary-down";
  const levels = (["alta", "media", "baja"] as const)
    .map((level) => [level, summarizePicks(picks.filter((r) => r.pick.strength === level))] as const)
    .filter(([, sum]) => sum.total > 0);
  return (
    <div className={`matchday-summary${tone}`}>
      <p className="matchday-summary-head">
        Jornada {matchday} en {leagueName(league)}: se cumplieron{" "}
        <strong>
          {total.hits} de {total.total}
        </strong>{" "}
        picks <span className={`edge-pill ${edge !== null && edge >= 0 ? "edge-pill-up" : "edge-pill-down"}`}>{pct(total.rate)}</span>
      </p>
      <ul className="matchday-summary-levels">
        {levels.map(([level, sum]) => (
          <li key={level}>
            <span className={`pick-strength pick-strength-${level}`}>{STRENGTH_LABEL[level]}</span> {sum.hits} de{" "}
            {sum.total} <strong className={sum.expected === null || (sum.rate ?? 0) >= sum.expected ? "edge-up" : "edge-down"}>
              {pct(sum.rate)}
            </strong>
          </li>
        ))}
      </ul>
      <p className="small">
        En la liga, esos mismos sucesos pasan el {pct(total.expected)}
        {edge !== null && (
          <span className={edge >= 0 ? "edge-up" : "edge-down"}>
            {edge > 0 ? `: ${edge} puntos más.` : edge < 0 ? `: ${-edge} puntos menos.` : ": lo mismo."}
          </span>
        )}
        {total.undecided > 0 && ` ${total.undecided} picks aún sin dato del partido: no cuentan.`}
      </p>
      {duels.length > 0 && (
        <p className="small matchday-summary-duel">
          <strong>Duelo de córners:</strong> el resultado más probable acertó en{" "}
          <strong className={duelHits * 2 >= duels.length ? "edge-up" : "edge-down"}>
            {duelHits} de {duels.length}
          </strong>{" "}
          partidos ({pct(duelHits / duels.length)})
          {duelPicks.total > 0 && (
            <>
              {" "}
              · picks muy probables del duelo:{" "}
              <strong className={(duelPicks.rate ?? 0) >= (duelPicks.expected ?? 0) ? "edge-up" : "edge-down"}>
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
  duelPicks,
}: {
  match: Match;
  results: CardPick[];
  league: string;
  duel: DuelForecast | null;
  duelPicks: CardPick[];
}) {
  const played = match.status === "historical";
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
        <span className="small muted">{formatDateTime(match.date)}</span>
      </Link>
      {results.length === 0 ? (
        <p className="small muted">Sin picks: no hay patrones con muestra suficiente.</p>
      ) : (
        <ul className="checked-picks">
          {results.map((r) => (
            <CheckedPick key={`${r.pick.side}-${r.pick.family}-${r.pick.option.key}`} result={r} league={league} />
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
  const outcome = hit === undefined ? "pending" : hit === null ? "unknown" : hit ? "hit" : "miss";
  return (
    <li className={`checked-pick checked-${outcome}`}>
      <span className="checked-mark" role="img" aria-label={OUTCOME[outcome].label} title={OUTCOME[outcome].label}>
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
      <span className={`pick-strength pick-strength-${pick.strength}`}>{STRENGTH_LABEL[pick.strength]}</span>
    </li>
  );
}
