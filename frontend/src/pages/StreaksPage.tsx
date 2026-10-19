import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getLeagueResults, getLeagueSeasons, getLeagueUpcoming, getLeagues } from "../api/client";
import type { League, MatchResult, UpcomingMatch } from "../api/types";
import { LeagueLogo } from "../components/LeagueLogo";
import { LeagueSwitch } from "../components/LeagueSwitch";
import { EmptyView, ErrorView, LoadingView } from "../components/StatusView";
import { MatchTeams, TeamCrest, TeamName } from "../components/TeamCrest";
import { formatKickoff, formatOdds, formatSeason, formatShortDate, parseApiDate } from "../lib/format";
import { leagueName, leagueParam, orderLeagues, parseLeagueParam, useSelectedLeagueCode } from "../lib/leagues";
import { parseOddsInput } from "../lib/oddsMath";
import {
  BAD_RUN_CHIP,
  BOOTSTRAP_SAMPLES,
  CATEGORIES,
  DAYS_AHEAD,
  FALLBACK_MIN_LENGTH,
  LENGTH_BUCKETS,
  MAX_CHANCE,
  MAX_PER_ENTITY,
  MIN_CELL_EVENTS,
  MIN_LENGTH,
  REFEREE_CHIP,
  activeStreaks,
  dayKey,
  isClear,
  matchesChip,
  popularCategories,
  selectStreaks,
  studyEventsSteps,
  summarizeStudySteps,
  upcomingDays,
  type StreakContext,
  type StreakRow,
  type StreakSort,
  type StudyCell,
  type StudyEvent,
  type StudyRow,
} from "../lib/streaks";
import { useApi } from "../lib/useApi";

// --- Datos: precalculados por liga y guardados para la sesion ----------------

interface LeagueStreaks {
  league: League;
  seasons: string[];
  played: MatchResult[];
  upcoming: UpcomingMatch[];
  rows: StreakRow[];
}

/** Las rachas de una liga se recalculan como mucho cada 10 minutos. */
const CACHE_MS = 10 * 60_000;
const cache = new Map<number, { at: number; data: Promise<LeagueStreaks> }>();

function loadLeague(league: League): Promise<LeagueStreaks> {
  const hit = cache.get(league.id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = (async () => {
    const seasons = (await getLeagueSeasons(league.id)).slice(0, 2);
    const [current, before, upcoming] = await Promise.all([
      seasons[0] ? getLeagueResults(league.id, seasons[0]) : Promise.resolve([] as MatchResult[]),
      seasons[1] ? getLeagueResults(league.id, seasons[1]) : Promise.resolve([] as MatchResult[]),
      getLeagueUpcoming(league.id, DAYS_AHEAD),
    ]);
    const played = [...current, ...before];
    return { league, seasons, played, upcoming, rows: activeStreaks(league.code, played, upcoming) };
  })();
  data.catch(() => cache.delete(league.id));
  cache.set(league.id, { at: Date.now(), data });
  return data;
}

// --- Filtros -----------------------------------------------------------------

const ALL_CHIP = "Todas";
const POPULAR_CHIP = "Populares";
const CHIPS = [ALL_CHIP, POPULAR_CHIP, ...CATEGORIES, REFEREE_CHIP, BAD_RUN_CHIP];

type ContextFilter = "any" | StreakContext;
const CONTEXT_OPTIONS: { value: ContextFilter; label: string }[] = [
  { value: "any", label: "Cualquier contexto" },
  { value: "all", label: "Todos los partidos" },
  { value: "home", label: "En casa" },
  { value: "away", label: "Fuera de casa" },
];

/** En movil, tarjetas en lugar de tabla (se pinta solo una de las dos). */
const MOBILE_QUERY = "(max-width: 720px)";

function useIsMobile(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(MOBILE_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(MOBILE_QUERY).matches,
  );
}

/** Filas visibles de golpe; el resto, con "Ver más". */
const PAGE_SIZE = 60;

const pct = (x: number) => `${Math.round(x * 100)} %`;

/** Rareza en palabras: "1 de cada 1500" (redondeado a dos cifras). */
function chanceText(x: number): string {
  const n = 1 / x;
  if (n >= 10_000) return "menos de 1 de cada 10.000";
  return `1 de cada ${Number(n.toPrecision(2)).toLocaleString("es-ES")}`;
}

function dayLabel(key: string, index: number): { name: string; date: string } {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = date.toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "");
  return {
    name: index === 0 ? "Hoy" : index === 1 ? "Mañana" : weekday.charAt(0).toUpperCase() + weekday.slice(1),
    date: date.toLocaleDateString("es-ES", { day: "numeric", month: "short" }),
  };
}

function takenText(match: UpcomingMatch): string | null {
  if (!match.odds_taken_at) return null;
  const taken = parseApiDate(match.odds_taken_at).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  return `Cuota media de varias casas ("Market Average", ${match.odds_source ?? "fuente desconocida"}), tomada el ${taken}. No es la cuota actual.`;
}

// --- Pagina ------------------------------------------------------------------

/** /rachas: rachas activas de los equipos que juegan en los proximos dias. */
export function StreaksPage() {
  const [storedCode, setStoredCode] = useSelectedLeagueCode();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: leagues } = useApi(() => getLeagues(), []);

  // ?liga= como en Partidos: la URL manda y refleja siempre la liga que se ve.
  const param = searchParams.get("liga");
  const fromUrl = leagues ? parseLeagueParam(param, leagues) : undefined;
  const leagueCode = fromUrl !== undefined ? fromUrl : storedCode;
  const league = leagues?.find((l) => l.code === leagueCode);

  const writeParam = (value: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("liga", value);
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    if (!leagues) return;
    if (leagueCode !== storedCode) setStoredCode(leagueCode);
    const wanted = leagueCode === null ? leagueParam(null) : league ? leagueParam(league) : null;
    if (wanted !== null && param !== wanted) writeParam(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagues, leagueCode, storedCode, league, param]);

  const changeLeague = (code: string | null) => {
    setStoredCode(code);
    const next = code === null ? null : leagues?.find((l) => l.code === code);
    if (next !== undefined) writeParam(leagueParam(next));
  };

  const selected = useMemo(
    () => (leagues ? (leagueCode === null ? orderLeagues(leagues) : leagues.filter((l) => l.code === leagueCode)) : null),
    [leagues, leagueCode],
  );
  const { data, loading, error } = useApi(
    () => (selected ? Promise.all(selected.map(loadLeague)) : Promise.resolve(null)),
    [selected?.map((l) => l.id).join()],
  );

  const [day, setDay] = useState<string>("all");
  const [chip, setChip] = useState(ALL_CHIP);
  const [context, setContext] = useState<ContextFilter>("any");
  const [sort, setSort] = useState<StreakSort>("rarity");
  const [shown, setShown] = useState(PAGE_SIZE);
  // "Tu cuota" de cada fila: no se guarda en ningun sitio.
  const [myOdds, setMyOdds] = useState<Record<string, string>>({});

  const mobile = useIsMobile();
  const days = useMemo(() => upcomingDays(), []);
  const pool = useMemo(
    () => (data ?? []).flatMap((d) => d.rows).filter((r) => days.includes(r.day) && (context === "any" || r.context === context)),
    [data, days, context],
  );
  const dayPool = useMemo(() => (day === "all" ? pool : pool.filter((r) => r.day === day)), [pool, day]);
  const popular = useMemo(() => popularCategories(dayPool), [dayPool]);
  const chipTest = useCallback(
    (c: string) => (r: StreakRow) =>
      c === ALL_CHIP ? true : c === POPULAR_CHIP ? popular.includes(r.type.category) : matchesChip(r, c),
    [popular],
  );

  const view = useMemo(() => selectStreaks(dayPool.filter(chipTest(chip)), sort), [dayPool, chip, sort, chipTest]);
  const chipCounts = useMemo(
    () => Object.fromEntries(CHIPS.map((c) => [c, selectStreaks(dayPool.filter(chipTest(c))).rows.length])),
    [dayPool, chipTest],
  );
  const dayCounts = useMemo(
    () => Object.fromEntries(days.map((d) => [d, selectStreaks(pool.filter((r) => r.day === d && chipTest(chip)(r))).rows.length])),
    [pool, days, chip, chipTest],
  );
  const matchDays = useMemo(
    () => new Set((data ?? []).flatMap((d) => d.upcoming.map((m) => dayKey(parseApiDate(m.date))))),
    [data],
  );
  useEffect(() => setShown(PAGE_SIZE), [day, chip, context, sort, leagueCode]);

  const oddsNotes = useMemo(() => {
    const notes = new Set<string>();
    for (const d of data ?? []) {
      for (const m of d.upcoming) {
        if (!m.odds_taken_at) continue;
        const taken = parseApiDate(m.odds_taken_at).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
        notes.add(`${leagueName(d.league.code)}: ${m.odds_source}, tomada el ${taken}`);
      }
    }
    return [...notes];
  }, [data]);

  const rows = view.rows.slice(0, shown);
  const odds = (row: StreakRow) => ({ raw: myOdds[row.id] ?? "", set: (v: string) => setMyOdds((p) => ({ ...p, [row.id]: v })) });

  return (
    <div>
      <h1>Rachas</h1>
      <p className="page-lead">
        Rachas activas de los equipos que juegan en los próximos días: partidos seguidos, desde el más reciente, en los
        que se ha cumplido un mercado. Ordenadas por rareza: lo poco probable que sería una racha así por pura casualidad.
      </p>

      <LeagueSwitch leagues={leagues} value={leagueCode} onChange={changeLeague} allowAll />

      <div className="tab-group streak-days" role="group" aria-label="Día">
        <button
          type="button"
          className={day === "all" ? "tab-button tab-button-active" : "tab-button"}
          aria-pressed={day === "all"}
          onClick={() => setDay("all")}
        >
          <span className="streak-day-name">Todos</span>
          <span className="streak-day-date">7 días</span>
        </button>
        {days.map((key, i) => {
          const label = dayLabel(key, i);
          return (
            <button
              key={key}
              type="button"
              className={day === key ? "tab-button tab-button-active" : "tab-button"}
              aria-pressed={day === key}
              disabled={data !== null && !matchDays.has(key)}
              title={data !== null && !matchDays.has(key) ? "Sin partidos este día" : `${dayCounts[key] ?? 0} rachas`}
              onClick={() => setDay(key)}
            >
              <span className="streak-day-name">{label.name}</span>
              <span className="streak-day-date">{label.date}</span>
            </button>
          );
        })}
      </div>

      <div className="streak-chips" role="group" aria-label="Mercado">
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            className="group-chip"
            aria-pressed={chip === c}
            disabled={data !== null && c !== ALL_CHIP && !chipCounts[c]}
            title={c === POPULAR_CHIP && popular.length ? `Las categorías con más rachas: ${popular.join(", ")}` : undefined}
            onClick={() => setChip(c)}
          >
            {c}
            {data && <span className="chip-count">{chipCounts[c] ?? 0}</span>}
          </button>
        ))}
      </div>

      <div className="filters">
        <select aria-label="Contexto" value={context} onChange={(e) => setContext(e.target.value as ContextFilter)}>
          {CONTEXT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select aria-label="Orden" value={sort} onChange={(e) => setSort(e.target.value as StreakSort)}>
          <option value="rarity">Más raras primero</option>
          <option value="length">Más largas primero</option>
        </select>
        {data && (
          <span className="small muted">
            {view.rows.length} rachas
            {view.minLength < MIN_LENGTH && ` (con ${view.minLength} partidos o más: con ${MIN_LENGTH} salían muy pocas)`}
          </span>
        )}
      </div>

      <RarityHelp />

      {error && <ErrorView message={`No se pudo conectar con la API: ${error}`} />}
      {!error && (loading || !data) && <LoadingView label="Calculando las rachas..." />}
      {!error && !loading && data && view.rows.length === 0 && (
        <EmptyView message="No hay rachas poco probables por azar con estos filtros. Prueba con otro día, mercado o liga." />
      )}

      {!loading && data && view.rows.length > 0 && (
        <>
          {mobile ? (
            <ul className="streak-cards">
              {rows.map((row) => (
                <li key={row.id} className="streak-card">
                  <div className="streak-card-head">
                    <LeagueCell code={row.leagueCode} />
                    <span className="small muted">{formatKickoff(row.match.date)}</span>
                  </div>
                  <StreakText row={row} />
                  <div className="streak-card-foot">
                    <NextMatch row={row} />
                    <div className="streak-odds">
                      <OddsCell row={row} {...odds(row)} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="table-scroll">
              <table className="predictions-table streaks-table">
                <thead>
                  <tr>
                    <th>Liga</th>
                    <th>Racha</th>
                    <th>Próximo partido</th>
                    <th>Cuota</th>
                    <th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <LeagueCell code={row.leagueCode} />
                      </td>
                      <td>
                        <StreakText row={row} />
                      </td>
                      <td>
                        <NextMatch row={row} />
                      </td>
                      <td className="streak-odds">
                        <OddsCell row={row} {...odds(row)} />
                      </td>
                      <td className="streak-date">{formatKickoff(row.match.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {view.rows.length > shown && (
            <button type="button" className="tab-button streak-more" onClick={() => setShown((n) => n + PAGE_SIZE)}>
              Ver más ({view.rows.length - shown})
            </button>
          )}
        </>
      )}

      <div className="streak-notes small muted">
        <p>
          <strong>Las rachas describen lo que ha ocurrido; por sí solas no predecirán el siguiente partido.</strong> Hay
          cientos de combinaciones de equipo, mercado y línea, así que algunas rachas largas aparecen por casualidad.
        </p>
        <p>
          Cuota: la media de varias casas ("Market Average"), la misma referencia que usa el resto de la web, solo en
          Resultado (gana, empata, pierde) y en más/menos de 2,5 goles del partido. En el resto de mercados, "—": no se
          deriva ni se estima. Es la cuota de la última toma, no la actual
          {oddsNotes.length > 0 ? `: ${oddsNotes.join(" · ")}.` : "; ahora mismo no hay ninguna para estos partidos."}
        </p>
        <p>
          Solo salen las de {MIN_LENGTH} partidos o más (
          {FALLBACK_MIN_LENGTH} si salen muy pocas) que por casualidad saldrían como mucho 1 de cada {Math.round(1 / MAX_CHANCE)}, una por equipo y
          mercado (la de la línea más exigente) y como mucho {MAX_PER_ENTITY} por equipo y día. Cuentan los partidos de la
          misma competición, de esta temporada y la anterior. Las de árbitro, solo con el árbitro ya designado.
        </p>
        <p>
          Tarjetas y puntos de tarjeta salen de nuestros datos: tarjetas = amarillas + rojas; puntos = amarilla 10, roja
          25 (aproximado). Una estadística que una liga no tiene no sale, y un partido sin el dato no corta la racha.
        </p>
      </div>

      {data && <StudyPanel data={data} />}
    </div>
  );
}

/** Que es la rareza, junto al orden: con ejemplos y lo que no dice. */
function RarityHelp() {
  return (
    <details className="picks-method streak-rarity">
      <summary>¿Qué es la rareza?</summary>
      <p>
        La rareza mide lo difícil que sería ver una racha así <strong>por pura casualidad</strong>, si el equipo fuera
        uno cualquiera de la liga. Se calcula con lo habitual en la liga para ese suceso, multiplicado por sí mismo tantas
        veces como partidos tiene la racha. Es la cifra «Por casualidad» de cada fila: «1 de cada 1500» quiere decir
        que, por pura suerte, solo 1 equipo de cada 1500 tendría una racha así.
      </p>
      <ul>
        <li>
          Ganar 8 seguidos cuando en la liga se gana el 40 % de los partidos: 0,40<sup>8</sup> ≈ 1 de cada 1500. Muy
          rara.
        </li>
        <li>
          9 seguidos de algo que pasa el 90 % de las veces: 0,90<sup>9</sup> ≈ 1 de cada 3. Es lo normal, así que no sale
          en la tabla.
        </li>
        <li>
          6 seguidos de algo que pasa la mitad de las veces: 0,50<sup>6</sup> ≈ 1 de cada 64. Es más corta que la
          anterior, pero mucho más rara: por eso va antes.
        </li>
      </ul>
      <p>
        Por eso «Más raras primero» no ordena por longitud: así no suben arriba las rachas largas de cosas que pasan casi
        siempre.
      </p>
      <p>
        <strong>Lo que no dice:</strong> no es la probabilidad de que la racha siga. Supone que el equipo es uno medio y
        que cada partido es independiente, y no siempre es así: un equipo que tira mucho lo hace casi siempre, y su racha
        puede salir rarísima sin ser ninguna sorpresa. Si quieres saber si las rachas siguen, mira «¿Se prolongan las
        rachas?» al final de la página. <Link to="/glosario">Más en el glosario →</Link>
      </p>
    </details>
  );
}

function LeagueCell({ code }: { code: string }) {
  return (
    <span className="streak-league">
      <LeagueLogo code={code} />
      <span>{leagueName(code)}</span>
    </span>
  );
}

const CONTEXT_BASE: Record<StreakContext, string> = { all: "", home: " en casa", away: " fuera de casa" };

/** La frase y, debajo, su contexto: lo normal en la competicion y la rareza. */
function StreakText({ row }: { row: StreakRow }) {
  const where = row.kind === "referee" ? "" : CONTEXT_BASE[row.context];
  return (
    <div className="streak-entity">
      {row.kind === "team" && <TeamCrest team={row.entity} league={row.leagueCode} />}
      <div>
        <p className="streak-text">{row.text}</p>
        <p className="streak-context small muted">
          Lo normal en {leagueName(row.leagueCode)}: {pct(row.baseRate)} de los partidos{where} ·{" "}
          <span
            className="streak-chance"
            title={`${pct(row.baseRate)} multiplicado por sí mismo ${row.length} veces. Supone que cada partido es independiente del anterior.`}
          >
            Por casualidad: {chanceText(row.chance)}
          </span>{" "}
          · Desde el {formatShortDate(row.since)}
          {row.skipped > 0 && ` · ${row.skipped} ${row.skipped === 1 ? "partido sin dato no cuenta" : "partidos sin dato no cuentan"}`}
          {row.odds && ` · La cuota ${formatOdds(row.odds.odds)} pide acertar al menos el ${pct(1 / row.odds.odds)} para no perder`}
        </p>
      </div>
    </div>
  );
}

function NextMatch({ row }: { row: StreakRow }) {
  const m = row.match;
  if (row.kind === "referee") {
    return (
      <div>
        <Link to={`/matches/${m.id}`} className="streak-next">
          <MatchTeams home={m.home_team} away={m.away_team} league={row.leagueCode} middle="vs" />
        </Link>
        <div className="small muted">Árbitro: {row.entity}</div>
      </div>
    );
  }
  const rival = row.side === "home" ? m.away_team : m.home_team;
  return (
    <Link to={`/matches/${m.id}`} className="streak-next">
      <span className="streak-venue">{row.side === "home" ? "Local" : "Visitante"}</span>
      <span className="muted">vs</span>
      <TeamName team={rival} league={row.leagueCode} />
    </Link>
  );
}

function OddsCell({ row, raw, set }: { row: StreakRow; raw: string; set: (v: string) => void }) {
  const mine = parseOddsInput(raw);
  return (
    <>
      {row.odds ? (
        <span className="streak-odds-value" title={takenText(row.match) ?? undefined}>
          {formatOdds(row.odds.odds)}
        </span>
      ) : (
        <span className="muted" title="Sin cuota media de mercado para este suceso: no se deriva ni se estima.">
          —
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        className="odds-input"
        placeholder="Tu cuota"
        value={raw}
        onChange={(e) => set(e.target.value)}
        aria-label={`Tu cuota para: ${row.text}`}
      />
      {mine !== null && <div className="small muted">exige {pct(1 / mine)}</div>}
    </>
  );
}

// --- ¿Se prolongan? -------------------------------------------------------------

/** Trozos de trabajo de este tiempo como mucho, para no congelar la pagina. */
const SLICE_MS = 16;
const studyCache = new Map<string, StudyRow[]>();

/** El estudio de las ligas cargadas, por trozos y guardado para la sesion. */
function useStudy(data: LeagueStreaks[], enabled: boolean): { rows: StudyRow[] | null; progress: number } {
  const key = data.map((d) => `${d.league.id}:${d.played.length}`).join("|");
  const [state, setState] = useState<{ key: string; rows: StudyRow[] | null; progress: number }>({
    key: "",
    rows: null,
    progress: 0,
  });

  useEffect(() => {
    if (!enabled || studyCache.has(key)) return;
    let cancelled = false;
    let timer = 0;
    const total = data.length + 1;
    const events: StudyEvent[] = [];
    let league = 0;
    let steps: Generator<StudyEvent[]> | null = null;
    let summary: Generator<void, StudyRow[]> | null = null;
    const work = () => {
      if (cancelled) return;
      const start = performance.now();
      while (performance.now() - start < SLICE_MS) {
        if (league < data.length) {
          steps ??= studyEventsSteps(data[league].played);
          const step = steps.next();
          if (step.done) {
            steps = null;
            league += 1;
          } else {
            events.push(...step.value);
          }
          continue;
        }
        summary ??= summarizeStudySteps(events);
        const step = summary.next();
        if (step.done) {
          studyCache.set(key, step.value);
          setState({ key, rows: step.value, progress: 1 });
          return;
        }
      }
      setState({ key, rows: null, progress: league / total });
      timer = window.setTimeout(work, 0);
    };
    timer = window.setTimeout(work, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key, enabled, data]);

  const cached = studyCache.get(key);
  if (cached) return { rows: cached, progress: 1 };
  return { rows: null, progress: state.key === key ? state.progress : 0 };
}

function StudyPanel({ data }: { data: LeagueStreaks[] }) {
  const [open, setOpen] = useState(false);
  const { rows, progress } = useStudy(data, open);
  const seasons = [...new Set(data.flatMap((d) => d.seasons))].sort().map(formatSeason).join(" y ");
  const leagues = data.map((d) => leagueName(d.league.code)).join(", ");

  const cells = rows?.flatMap((r) => LENGTH_BUCKETS.map((b) => r.cells[b]).filter((c): c is StudyCell => c !== null)) ?? [];
  const above = cells.filter((c) => isClear(c) && c.diff > 0).length;
  const below = cells.filter((c) => isClear(c) && c.diff < 0).length;

  return (
    <details className="picks-method streak-study" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>¿Se prolongan las rachas?</summary>
      <p className="small muted">
        Con los partidos de {seasons} ({leagues}): antes de cada partido, las rachas que habría mostrado esta tabla (de{" "}
        {MIN_LENGTH} partidos o más, calculadas solo con los partidos anteriores) y si siguieron en ese partido, frente a
        lo habitual en la liga hasta entonces para ese mismo suceso. Entre paréntesis, la diferencia con su intervalo del
        95 % (remuestreando partidos, {BOOTSTRAP_SAMPLES} muestras, semilla fija). Sin dato: menos de {MIN_CELL_EVENTS}{" "}
        rachas.
      </p>
      {rows === null ? (
        <LoadingView label={`Calculando... ${Math.round(progress * 100)} %`} />
      ) : rows.length === 0 ? (
        <EmptyView message="No hay suficientes partidos para medirlo." />
      ) : (
        <>
          <p className="streak-study-verdict">
            {above === 0 && below === 0
              ? "No hay una diferencia clara: con estos datos, las rachas siguieron más o menos como lo habitual en la liga."
              : `En ${above} de ${cells.length} casillas la racha siguió claramente más que lo habitual en la liga${below ? ` y en ${below}, menos` : ""}; en el resto no hay una diferencia clara. Que siga más que la media de la liga no es inercia: sobre todo dice que ese equipo no es uno medio en ese mercado.`}
          </p>
          <div className="table-scroll">
            <table className="predictions-table streak-study-table">
              <thead>
                <tr>
                  <th>Mercado</th>
                  {LENGTH_BUCKETS.map((b) => (
                    <th key={b}>{b} partidos</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.category} className={row.category === "Todas" ? "picks-summary-total" : undefined}>
                    <td>{row.category}</td>
                    {LENGTH_BUCKETS.map((b) => (
                      <td key={b}>
                        <StudyCellView cell={row.cells[b]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </details>
  );
}

const pp = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))}`;

function StudyCellView({ cell }: { cell: StudyCell | null }) {
  if (!cell) return <span className="muted">—</span>;
  const clear = isClear(cell);
  return (
    <>
      <span>
        {pct(cell.rate)} <span className="muted">vs {pct(cell.expected)}</span>
      </span>
      <div className={`small ${clear ? (cell.diff > 0 ? "edge-up" : "edge-down") : "muted"}`}>
        {pp(cell.diff)} pp ({pp(cell.low)} a {pp(cell.high)}){clear ? "" : " · sin diferencia clara"}
      </div>
      <div className="small muted">{cell.events} rachas</div>
    </>
  );
}
