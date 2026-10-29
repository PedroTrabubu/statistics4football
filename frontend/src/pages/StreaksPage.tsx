import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Trans, useTranslation } from "react-i18next";
import { PageHero } from "../components/PageHero";
import { Link, useSearchParams } from "react-router-dom";
import { getLeagueResults, getLeagueSeasons, getLeagueUpcoming, getLeagues } from "../api/client";
import type { League, MatchResult, UpcomingMatch } from "../api/types";
import { DayTabs } from "../components/DayTabs";
import { LeagueLogo } from "../components/LeagueLogo";
import { LeagueSwitch } from "../components/LeagueSwitch";
import { EmptyView, ErrorView, LoadingView } from "../components/StatusView";
import { MatchTeams, TeamCrest, TeamName } from "../components/TeamCrest";
import { currentLocale, t } from "../i18n";
import {
  formatKickoff,
  formatLocaleNumber,
  formatOdds,
  formatSeason,
  formatShortDate,
  parseApiDate,
  withPercent,
} from "../lib/format";
import { leagueName, leagueParam, orderLeagues, parseLeagueParam, useSelectedLeagueCode } from "../lib/leagues";
import { parseOddsInput } from "../lib/oddsMath";
import {
  ALL_CATEGORIES,
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
  categoryLabel,
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

/** Chips: claves; su texto, chipLabel. */
const ALL_CHIP = ALL_CATEGORIES;
const POPULAR_CHIP = "populares";
const CHIPS = [ALL_CHIP, POPULAR_CHIP, ...CATEGORIES, REFEREE_CHIP, BAD_RUN_CHIP];

function chipLabel(chip: string): string {
  return chip === POPULAR_CHIP ? t("streaks:chip.popular") : categoryLabel(chip);
}

type ContextFilter = "any" | StreakContext;
const CONTEXT_OPTIONS: ContextFilter[] = ["any", "all", "home", "away"];

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

const pct = (x: number) => withPercent(String(Math.round(x * 100)));

/** Rareza en palabras: "1 de cada 1500" (redondeado a dos cifras). */
function chanceText(x: number): string {
  const n = 1 / x;
  if (n >= 10_000) return t("streaks:chance.lessThan", { n: formatLocaleNumber(10_000) });
  return t("streaks:chance.oneIn", { n: formatLocaleNumber(Number(n.toPrecision(2))) });
}

/** Dia en que se tomo la cuota: "17 oct". */
function takenDate(iso: string): string {
  return parseApiDate(iso).toLocaleDateString(currentLocale(), { day: "numeric", month: "short" });
}

function takenText(match: UpcomingMatch): string | null {
  if (!match.odds_taken_at) return null;
  return t("streaks:odds.taken", {
    source: match.odds_source ?? t("streaks:odds.unknownSource"),
    date: takenDate(match.odds_taken_at),
  });
}

// --- Pagina ------------------------------------------------------------------

/** /rachas: rachas activas de los equipos que juegan en los proximos dias. */
export function StreaksPage() {
  const { t, i18n } = useTranslation();
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
        notes.add(
          t("streaks:odds.note", { league: leagueName(d.league.code), source: m.odds_source, date: takenDate(m.odds_taken_at) }),
        );
      }
    }
    return [...notes];
    // El idioma, para rehacer las notas al cambiarlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, i18n.language]);

  const rows = view.rows.slice(0, shown);
  const odds = (row: StreakRow) => ({ raw: myOdds[row.id] ?? "", set: (v: string) => setMyOdds((p) => ({ ...p, [row.id]: v })) });

  return (
    <div>
      <PageHero eyebrow={leagueCode === null ? t("common:league.all") : leagueName(leagueCode)} title={t("nav:streaks")} accentWords={0} lead={<p>{t("streaks:page.lead")}</p>} />

      <LeagueSwitch leagues={leagues} value={leagueCode} onChange={changeLeague} allowAll />

      <DayTabs
        days={days}
        value={day === "all" ? null : day}
        onChange={(d) => setDay(d ?? "all")}
        allDate={t("streaks:page.allDays", { count: DAYS_AHEAD })}
        enabled={data !== null ? (key) => matchDays.has(key) : null}
        title={(key) => t("streaks:page.count", { count: dayCounts[key] ?? 0 })}
      />

      <div className="streak-chips" role="group" aria-label={t("streaks:page.marketLabel")}>
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            className="group-chip"
            aria-pressed={chip === c}
            disabled={data !== null && c !== ALL_CHIP && !chipCounts[c]}
            title={
              c === POPULAR_CHIP && popular.length
                ? t("streaks:page.popularTitle", { categories: popular.map(categoryLabel).join(", ") })
                : undefined
            }
            onClick={() => setChip(c)}
          >
            {chipLabel(c)}
            {data && <span className="chip-count">{chipCounts[c] ?? 0}</span>}
          </button>
        ))}
      </div>

      <div className="filters">
        <select
          aria-label={t("streaks:page.contextLabel")}
          value={context}
          onChange={(e) => setContext(e.target.value as ContextFilter)}
        >
          {CONTEXT_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {t(`streaks:page.context.${value}`)}
            </option>
          ))}
        </select>
        <select aria-label={t("streaks:page.sortLabel")} value={sort} onChange={(e) => setSort(e.target.value as StreakSort)}>
          <option value="rarity">{t("streaks:page.sort.rarity")}</option>
          <option value="length">{t("streaks:page.sort.length")}</option>
        </select>
        {data && (
          <span className="small muted">
            {view.minLength < MIN_LENGTH
              ? t("streaks:page.totalFallback", { count: view.rows.length, min: view.minLength, normal: MIN_LENGTH })
              : t("streaks:page.count", { count: view.rows.length })}
          </span>
        )}
      </div>

      <RarityHelp />

      {error && <ErrorView message={t("common:error.api", { error })} />}
      {!error && (loading || !data) && <LoadingView label={t("streaks:page.loading")} />}
      {!error && !loading && data && view.rows.length === 0 && <EmptyView message={t("streaks:page.empty")} />}

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
                    <th>{t("streaks:page.column.league")}</th>
                    <th>{t("streaks:page.column.streak")}</th>
                    <th>{t("streaks:page.column.nextMatch")}</th>
                    <th>{t("streaks:page.column.odds")}</th>
                    <th>{t("streaks:page.column.date")}</th>
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
              {t("streaks:page.more", { n: view.rows.length - shown })}
            </button>
          )}
        </>
      )}

      <div className="streak-notes small muted">
        <p>
          <Trans i18nKey="streaks:notes.describe" components={{ bold: <strong /> }} />
        </p>
        <p>
          {oddsNotes.length > 0
            ? t("streaks:notes.oddsWith", { notes: oddsNotes.join(" · ") })
            : t("streaks:notes.oddsNone")}
        </p>
        <p>
          {t("streaks:notes.which", {
            min: MIN_LENGTH,
            fallback: FALLBACK_MIN_LENGTH,
            chance: Math.round(1 / MAX_CHANCE),
            perEntity: MAX_PER_ENTITY,
          })}
        </p>
        <p>{t("streaks:notes.cards")}</p>
      </div>

      {data && <StudyPanel data={data} />}
    </div>
  );
}

/** Que es la rareza, junto al orden: con ejemplos y lo que no dice. */
function RarityHelp() {
  const { t } = useTranslation();
  return (
    <details className="picks-method streak-rarity">
      <summary>{t("streaks:rarity.title")}</summary>
      <p>
        <Trans i18nKey="streaks:rarity.what" components={{ bold: <strong /> }} />
      </p>
      <ul>
        <li>
          <Trans i18nKey="streaks:rarity.example1" components={{ sup: <sup /> }} />
        </li>
        <li>
          <Trans i18nKey="streaks:rarity.example2" components={{ sup: <sup /> }} />
        </li>
        <li>
          <Trans i18nKey="streaks:rarity.example3" components={{ sup: <sup /> }} />
        </li>
      </ul>
      <p>{t("streaks:rarity.order")}</p>
      <p>
        <Trans i18nKey="streaks:rarity.notSay" components={{ bold: <strong />, anchor: <Link to="/glosario" /> }} />
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

/** La frase y, debajo, su contexto: lo normal en la competicion y la rareza. */
function StreakText({ row }: { row: StreakRow }) {
  const { t } = useTranslation();
  const where = row.kind === "referee" ? "all" : row.context;
  return (
    <div className="streak-entity">
      {row.kind === "team" && <TeamCrest team={row.entity} league={row.leagueCode} />}
      <div>
        <p className="streak-text">{row.text}</p>
        <p className="streak-context small muted">
          {t(`streaks:row.normal.${where}`, { league: leagueName(row.leagueCode), pct: pct(row.baseRate) })} ·{" "}
          <span
            className="streak-chance"
            title={t("streaks:row.chanceTitle", { pct: pct(row.baseRate), n: row.length })}
          >
            {t("streaks:row.chance", { chance: chanceText(row.chance) })}
          </span>{" "}
          · {t("streaks:row.since", { date: formatShortDate(row.since) })}
          {row.skipped > 0 && ` · ${t("streaks:row.skipped", { count: row.skipped })}`}
          {row.odds &&
            ` · ${t("streaks:row.odds", { odds: formatOdds(row.odds.odds), pct: pct(1 / row.odds.odds) })}`}
        </p>
      </div>
    </div>
  );
}

function NextMatch({ row }: { row: StreakRow }) {
  const { t } = useTranslation();
  const m = row.match;
  if (row.kind === "referee") {
    return (
      <div>
        <Link to={`/matches/${m.id}`} className="streak-next">
          <MatchTeams home={m.home_team} away={m.away_team} league={row.leagueCode} middle="vs" />
        </Link>
        <div className="small muted">{t("streaks:row.referee", { name: row.entity })}</div>
      </div>
    );
  }
  const rival = row.side === "home" ? m.away_team : m.home_team;
  return (
    <Link to={`/matches/${m.id}`} className="streak-next">
      <span className="streak-venue">{row.side === "home" ? t("streaks:row.home") : t("streaks:row.away")}</span>
      <span className="muted">vs</span>
      <TeamName team={rival} league={row.leagueCode} />
    </Link>
  );
}

function OddsCell({ row, raw, set }: { row: StreakRow; raw: string; set: (v: string) => void }) {
  const { t } = useTranslation();
  const mine = parseOddsInput(raw);
  return (
    <>
      {row.odds ? (
        <span className="streak-odds-value" title={takenText(row.match) ?? undefined}>
          {formatOdds(row.odds.odds)}
        </span>
      ) : (
        <span className="muted" title={t("streaks:odds.none")}>
          —
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        className="odds-input"
        placeholder={t("streaks:odds.yours")}
        value={raw}
        onChange={(e) => set(e.target.value)}
        aria-label={t("streaks:odds.yoursFor", { text: row.text })}
      />
      {mine !== null && <div className="small muted">{t("streaks:odds.requires", { pct: pct(1 / mine) })}</div>}
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
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { rows, progress } = useStudy(data, open);
  const seasons = [...new Set(data.flatMap((d) => d.seasons))].sort().map(formatSeason).join(t("common:listAnd"));
  const leagues = data.map((d) => leagueName(d.league.code)).join(", ");

  const cells = rows?.flatMap((r) => LENGTH_BUCKETS.map((b) => r.cells[b]).filter((c): c is StudyCell => c !== null)) ?? [];
  const above = cells.filter((c) => isClear(c) && c.diff > 0).length;
  const below = cells.filter((c) => isClear(c) && c.diff < 0).length;

  return (
    <details className="picks-method streak-study" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t("streaks:study.title")}</summary>
      <p className="small muted">
        {t("streaks:study.method", {
          seasons,
          leagues,
          min: MIN_LENGTH,
          samples: BOOTSTRAP_SAMPLES,
          minEvents: MIN_CELL_EVENTS,
        })}
      </p>
      {rows === null ? (
        <LoadingView label={t("streaks:study.loading", { pct: withPercent(String(Math.round(progress * 100))) })} />
      ) : rows.length === 0 ? (
        <EmptyView message={t("streaks:study.empty")} />
      ) : (
        <>
          <p className="streak-study-verdict">
            {above === 0 && below === 0
              ? t("streaks:study.verdictNone")
              : below
                ? t("streaks:study.verdictAboveBelow", { above, cells: cells.length, below })
                : t("streaks:study.verdictAbove", { above, cells: cells.length })}
          </p>
          <div className="table-scroll">
            <table className="predictions-table streak-study-table">
              <thead>
                <tr>
                  <th>{t("streaks:study.market")}</th>
                  {LENGTH_BUCKETS.map((b) => (
                    <th key={b}>{t("streaks:study.bucket", { n: b })}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.category} className={row.category === ALL_CATEGORIES ? "picks-summary-total" : undefined}>
                    <td>{categoryLabel(row.category)}</td>
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
  const { t } = useTranslation();
  if (!cell) return <span className="muted">—</span>;
  const clear = isClear(cell);
  const diff = { diff: pp(cell.diff), low: pp(cell.low), high: pp(cell.high) };
  return (
    <>
      <span>
        {pct(cell.rate)} <span className="muted">{t("streaks:study.versus", { expected: pct(cell.expected) })}</span>
      </span>
      <div className={`small ${clear ? (cell.diff > 0 ? "edge-up" : "edge-down") : "muted"}`}>
        {t(clear ? "streaks:study.diff" : "streaks:study.diffUnclear", diff)}
      </div>
      <div className="small muted">{t("streaks:page.count", { count: cell.events })}</div>
    </>
  );
}
