import { type CSSProperties, useEffect, useId, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getLeagueContextResults, getLeagueResults, getLeagueSeasons, getLeagues } from "../api/client";
import { LeagueSwitch } from "../components/LeagueSwitch";
import { NextMatchdayPanel, NextMatchdayToggle } from "../components/NextMatchdayCompare";
import { PageHero } from "../components/PageHero";
import { EmptyView, ErrorView, LoadingView } from "../components/StatusView";
import { TeamCrest, TeamName } from "../components/TeamCrest";
import { formatFixed, formatSeason, formatShortDate, withPercent } from "../lib/format";
import {
  MARKETS,
  average,
  familyVariants,
  findMarket,
  groupByReferee,
  groupByTeam,
  hitRate,
  marketGroupLabel,
  type DetailValue,
  type HitRate,
  type MarketDef,
  type MarketOption,
  type MatchGroup,
  type TeamMatchView,
} from "../lib/markets";
import { CHAMPIONS_LEAGUE_CODE, DEFAULT_LEAGUE_CODE, leagueName, useSelectedLeagueCode } from "../lib/leagues";
import { wilsonLower, wilsonUpper } from "../lib/patterns";
import { matchesSearch } from "../lib/teamSearch";
import { useApi } from "../lib/useApi";

type Mode = "team" | "referee";
type ViewMode = "split" | "all";
type SortMode = "pct" | "name";

/** Por debajo de esto el porcentaje es poco fiable: se muestra atenuado. */
const LOW_SAMPLE = 5;

/** Valor del selector de temporada para "todas" (solo por árbitro). */
const ALL_SEASONS = "all";

/** Partidos que se cuentan: toda la temporada o los últimos N. */
const LAST_N_OPTIONS: (number | null)[] = [null, 10, 5];

/** Mercados que tienen sentido por arbitro: los que dan lo mismo mirados
 * desde cualquiera de los dos equipos. */
const REFEREE_MARKETS = MARKETS.filter((m) => m.matchLevel);

/** La opcion elegida se recuerda por familia (al pasar de "córners del
 * partido" a "cada equipo" se mantiene la linea si existe en la variante). */
const optionMemoryKey = (market: MarketDef) => market.family?.key ?? market.slug;

/** Filas de botones; `label`: clave de su rotulo en markets:page. */
const OPTION_ROWS: { row: MarketOption["row"]; label: string | null }[] = [
  { row: undefined, label: null },
  { row: "over", label: "over" },
  { row: "under", label: "under" },
];
const DEFAULT_REFEREE_MARKET = "tarjetas";

/** /mercados/:slug: un mercado, una tarjeta por equipo. */
export function MarketPage() {
  const { slug } = useParams();
  const market = findMarket(slug);
  if (!market) {
    return <Navigate to={`/mercados/${MARKETS[0].slug}`} replace />;
  }
  return <MarketView mode="team" market={market} />;
}

/** /arbitros: mercados de partido (tarjetas, corners, goles...), una
 * tarjeta por arbitro. */
export function RefereePage() {
  const [slug, setSlug] = useState(DEFAULT_REFEREE_MARKET);
  const market = REFEREE_MARKETS.find((m) => m.slug === slug) ?? REFEREE_MARKETS[0];
  return <MarketView mode="referee" market={market} onMarketChange={setSlug} />;
}

// El mismo componente se reutiliza al cambiar de mercado en el sidebar
// (misma ruta, otro :slug), asi que liga/temporada/vista se conservan al
// saltar entre mercados. La opcion elegida se guarda por mercado.
function MarketView({
  mode,
  market,
  onMarketChange,
}: {
  mode: Mode;
  market: MarketDef;
  onMarketChange?: (slug: string) => void;
}) {
  const { t } = useTranslation();
  const [season, setSeason] = useState<string | undefined>(undefined);
  const [optionBySlug, setOptionBySlug] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [lastN, setLastN] = useState<number | null>(null);
  const [sort, setSort] = useState<SortMode>("pct");
  // Se conserva al cambiar de mercado o de liga: así se sigue a un equipo.
  // ?arbitro=Nombre (enlace desde la ficha de un partido): ya filtrado.
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get("arbitro") ?? "");
  // Comparar: dos tarjetas marcadas se quedan solas, una al lado de la otra.
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (key: string) =>
    setPicked((now) => (now.includes(key) ? now.filter((k) => k !== key) : [...now, key].slice(-2)));
  // Siguiente jornada: un partido compara a sus dos equipos de un toque.
  const [nextOpen, setNextOpen] = useState(false);
  const nextPanelId = useId();
  const compareNote = useRef<HTMLParagraphElement>(null);
  const compareMatch = (keys: string[]) => {
    setPicked(keys);
    if (keys.length === 0) return;
    // Si la comparación queda fuera de la pantalla, se baja hasta ella.
    requestAnimationFrame(() => {
      const note = compareNote.current;
      if (!note || note.getBoundingClientRect().top < window.innerHeight * 0.7) return;
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      note.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    });
  };

  const { data: leagues } = useApi(() => getLeagues(), []);

  // Sin "todas las ligas" en esta pagina: si venia de "Ambas", LaLiga.
  const [selectedCode, setLeagueCode] = useSelectedLeagueCode();
  const leagueCode = selectedCode ?? DEFAULT_LEAGUE_CODE;
  const leagueId = leagues?.find((l) => l.code === leagueCode)?.id;

  const { data: seasons } = useApi(
    () => (leagueId !== undefined ? getLeagueSeasons(leagueId) : Promise.resolve([])),
    [leagueId],
  );

  useEffect(() => {
    setSeason(undefined);
  }, [leagueId]);

  const effectiveSeason = season ?? seasons?.[0];
  // Por árbitro, también todas las temporadas juntas: en una sola, un
  // árbitro pita unos 20 partidos y los sucesos raros (rojas) no dan para
  // mucho.
  const allSeasons = mode === "referee" && effectiveSeason === ALL_SEASONS;

  const {
    data: results,
    loading,
    error,
  } = useApi(() => {
    if (leagueId === undefined || effectiveSeason === undefined) return Promise.resolve([]);
    if (!allSeasons) return getLeagueResults(leagueId, effectiveSeason);
    // Cada temporada viene de la más reciente a la más antigua, y ellas también.
    return Promise.all((seasons ?? []).map((s) => getLeagueResults(leagueId, s))).then((lists) => lists.flat());
  }, [leagueId, effectiveSeason, allSeasons, seasons?.join()]);

  // Champions: cada equipo, tambien en su liga. Se pide la primera vez que
  // se abre el bloque de un equipo.
  const withDomestic = mode === "team" && leagueCode === CHAMPIONS_LEAGUE_CODE;
  const [domesticWanted, setDomesticWanted] = useState(false);
  const domesticApi = useApi(
    () =>
      withDomestic && domesticWanted && leagueId !== undefined && effectiveSeason !== undefined
        ? getLeagueContextResults(leagueId, effectiveSeason)
        : Promise.resolve(null),
    [withDomestic, domesticWanted, leagueId, effectiveSeason],
  );
  const domesticByTeam = useMemo(
    () => (domesticApi.data ? new Map(groupByTeam(domesticApi.data).map((g) => [g.teamId, g])) : null),
    [domesticApi.data],
  );

  const navigate = useNavigate();
  const remembered = optionBySlug[optionMemoryKey(market)];
  const option =
    market.options.find((o) => o.key === remembered) ??
    market.options.find((o) => o.key === market.defaultOption) ??
    market.options[0];
  const variants = familyVariants(market);
  // Por arbitro no hay local/visitante: cada partido entra una sola vez.
  const view: ViewMode = mode === "referee" ? "all" : viewMode;

  const take = (views: TeamMatchView[]) => (lastN === null ? views : views.slice(0, lastN));

  const groups = results ? (mode === "team" ? groupByTeam(results) : groupByReferee(results)) : [];
  const rows = groups.map((group) => ({ group, overall: hitRate(take(group.all), option) }));
  rows.sort((a, b) =>
    sort === "name"
      ? a.group.name.localeCompare(b.group.name, "es")
      : (b.overall.pct ?? -1) - (a.overall.pct ?? -1) ||
        b.overall.total - a.overall.total ||
        a.group.name.localeCompare(b.group.name, "es"),
  );
  const comparing = picked.filter((k) => rows.some((r) => r.group.key === k));
  const visible =
    comparing.length === 2
      ? comparing.map((k) => rows.find((r) => r.group.key === k)!)
      : rows.filter((r) => matchesSearch(r.group.name, query));

  // Media de la liga por partido: solo tiene sentido si el mercado da lo
  // mismo mire desde el equipo que se mire (ver MarketDef.matchLevel).
  const leagueViews = results && lastN === null ? groupByTeam(results).flatMap((t) => t.home) : null;
  const leagueRate = market.matchLevel && leagueViews ? hitRate(leagueViews, option) : null;

  const seasonLabel =
    allSeasons && seasons?.length
      ? `${formatSeason(seasons[seasons.length - 1])}–${formatSeason(seasons[0])}`
      : effectiveSeason
        ? formatSeason(effectiveSeason)
        : t("markets:page.thisSeason");
  // Partidos jugados sin arbitro en ninguna fuente: no cuentan para nadie.
  const withoutReferee = mode === "referee" && results ? results.filter((r) => !r.referee).length : 0;
  const hasMissing = rows.some((r) => r.overall.missing > 0);
  const leagueAverage =
    market.average && leagueViews ? average(leagueViews, market.average.value) : null;

  return (
    <div>
      <PageHero
        eyebrow={[mode === "team" ? marketGroupLabel(market.group) : null, leagueName(leagueCode), seasonLabel]
          .filter(Boolean)
          .join(" · ")}
        title={mode === "team" ? market.title : t("nav:referees")}
        accentWords={mode === "team" ? 1 : 0}
        lead={<p>{mode === "team" ? market.description : t("markets:page.refereesLead")}</p>}
        aside={
          <MarketHeroCard
            loading={loading}
            error={error}
            rows={rows}
            option={option}
            league={leagueCode}
            leagueRate={leagueRate}
            seasonLabel={seasonLabel}
            leagueAverage={
              leagueAverage !== null ? { value: formatFixed(leagueAverage, 1), label: market.average?.label ?? "" } : null
            }
          />
        }
      />

      <LeagueSwitch leagues={leagues} value={leagueCode} onChange={(code) => code && setLeagueCode(code)} />

      <div className="filters">
        <input
          type="search"
          className="market-search"
          aria-label={t(`markets:page.search.${mode}`)}
          placeholder={t(`markets:page.searchPlaceholder.${mode}`)}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {mode === "referee" && (
          <select aria-label={t("markets:page.market")} value={market.slug} onChange={(e) => onMarketChange?.(e.target.value)}>
            {REFEREE_MARKETS.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.title}
              </option>
            ))}
          </select>
        )}


        <select aria-label={t("markets:page.season")} value={effectiveSeason ?? ""} onChange={(e) => setSeason(e.target.value)}>
          {seasons?.map((s) => (
            <option key={s} value={s}>
              {formatSeason(s)}
            </option>
          ))}
          {mode === "referee" && seasons && seasons.length > 1 && (
            <option value={ALL_SEASONS}>{t("markets:page.allSeasons")}</option>
          )}
        </select>

        <select
          aria-label={t("markets:page.matches")}
          value={lastN ?? ""}
          onChange={(e) => setLastN(e.target.value ? Number(e.target.value) : null)}
        >
          {LAST_N_OPTIONS.map((n) => (
            <option key={n ?? "season"} value={n ?? ""}>
              {n === null ? t("markets:page.wholeSeason") : t("markets:page.lastN", { n })}
            </option>
          ))}
        </select>

        <select aria-label={t("markets:page.sort")} value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
          <option value="pct">{t("markets:page.sortPct")}</option>
          <option value="name">{t("markets:page.sortName")}</option>
        </select>
      </div>

      {mode === "team" && variants.length > 1 && (
        <div className="filters">
          <label className="market-variant">
            <span className="small muted">{t("markets:page.statistic")}</span>
            <select value={market.slug} onChange={(e) => navigate(`/mercados/${e.target.value}`)}>
              {variants.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.family?.variant ?? m.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {market.options.length > 1 &&
        OPTION_ROWS.map(({ row, label }) => {
          const rowOptions = market.options.filter((o) => o.row === row);
          if (rowOptions.length === 0) return null;
          return (
            <div key={row ?? "options"} className="market-option-row">
              {label && <span className="market-option-label">{t(`markets:page.row.${label}`)}</span>}
              <div
                className="tab-group market-options"
                role="group"
                aria-label={label ? t(`markets:page.row.${label}`) : t("markets:page.option")}
              >
                {rowOptions.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    className={o.key === option.key ? "tab-button tab-button-active" : "tab-button"}
                    onClick={() => setOptionBySlug((prev) => ({ ...prev, [optionMemoryKey(market)]: o.key }))}
                  >
                    {o.short ?? o.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

      <div className="filters">
        {mode === "team" && (
          <div className="tab-group" role="group" aria-label={t("markets:page.view")}>
            <button
              type="button"
              className={viewMode === "split" ? "tab-button tab-button-active" : "tab-button"}
              onClick={() => setViewMode("split")}
            >
              {t("markets:page.viewSplit")}
            </button>
            <button
              type="button"
              className={viewMode === "all" ? "tab-button tab-button-active" : "tab-button"}
              onClick={() => setViewMode("all")}
            >
              {t("markets:page.viewAll")}
            </button>
          </div>
        )}
        {mode === "team" && (
          <NextMatchdayToggle open={nextOpen} panelId={nextPanelId} onToggle={() => setNextOpen((v) => !v)} />
        )}
      </div>

      {mode === "team" && nextOpen && (
        <NextMatchdayPanel
          id={nextPanelId}
          leagueId={leagueId}
          leagueCode={leagueCode}
          available={new Set(rows.map((r) => r.group.key))}
          picked={comparing}
          onCompare={compareMatch}
        />
      )}

      {leagueRate && leagueRate.pct !== null && (
        <p className="small muted market-league-rate">
          <Trans
            i18nKey={leagueAverage !== null ? "markets:page.leagueRateAverage" : "markets:page.leagueRate"}
            values={{
              season: seasonLabel,
              pct: withPercent(String(Math.round(leagueRate.pct * 100))),
              hits: leagueRate.hits,
              total: leagueRate.total,
              average: leagueAverage !== null ? formatFixed(leagueAverage, 1) : "",
              label: market.average?.label ?? "",
            }}
            components={{ bold: <strong /> }}
          />
        </p>
      )}

      {market.note && <p className="small muted intro-note">{market.note}</p>}

      {!loading && !error && rows.length > 0 && withoutReferee > 0 && (
        <p className="small muted intro-note">
          {t("markets:page.withoutReferee", { count: withoutReferee, season: seasonLabel })}
        </p>
      )}

      {loading && <LoadingView label={t("common:loading.matches")} />}
      {error && <ErrorView message={t("common:error.api", { error })} />}
      {!loading && !error && rows.length === 0 && (
        <EmptyView
          message={
            mode === "referee" && results && results.length > 0
              ? t("markets:page.noRefereeData", { season: seasonLabel })
              : t("markets:page.noMatches")
          }
        />
      )}

      {!loading && !error && rows.length > 0 && visible.length === 0 && (
        <EmptyView message={t(`markets:page.noSearchMatch.${mode}`, { query: query.trim() })} />
      )}

      {comparing.length > 0 && (
        <p className="small market-compare-note" ref={compareNote}>
          {comparing.length === 2
            ? t("markets:page.comparing", {
                first: rows.find((r) => r.group.key === comparing[0])!.group.name,
                second: rows.find((r) => r.group.key === comparing[1])!.group.name,
              })
            : t(`markets:page.pickAnother.${mode}`, {
                name: rows.find((r) => r.group.key === comparing[0])!.group.name,
              })}{" "}
          <button type="button" className="link-button" onClick={() => setPicked([])}>
            {t("markets:page.clear")}
          </button>
        </p>
      )}

      {!loading && !error && visible.length > 0 && (
        <div className="market-teams">
          {visible.map(({ group, overall }) => (
            <GroupCard
              key={group.key}
              group={group}
              overall={overall}
              market={market}
              option={option}
              view={view}
              take={take}
              league={leagueCode}
              interval={mode === "referee" ? { leaguePct: leagueRate?.pct ?? null } : undefined}
              checked={picked.includes(group.key)}
              onToggle={() => toggle(group.key)}
              domestic={
                withDomestic
                  ? {
                      group: domesticByTeam?.get(group.teamId!) ?? null,
                      loading: domesticWanted && (domesticApi.loading || !domesticByTeam) && !domesticApi.error,
                      error: domesticApi.error,
                      onOpen: () => setDomesticWanted(true),
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {!loading && !error && visible.length > 0 && (
        <p className="muted small">
          {[
            t("markets:page.legend.hit", { option: option.label }),
            market.detail ? t("markets:page.legend.detail", { detail: market.detail.inlineLabel }) : null,
            hasMissing ? t("markets:page.legend.missing") : null,
            t(`markets:page.legend.lowSample.${mode}`, { n: LOW_SAMPLE }),
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      )}
    </div>
  );
}

/** Tarjeta del hero de Mercados: la media de la liga en un anillo y los tres
 * mejores (equipos o árbitros) con la opción elegida, que llevan a su
 * tarjeta más abajo. Así el dato principal se ve sin bajar. */
function MarketHeroCard({
  loading,
  error,
  rows,
  option,
  league,
  leagueRate,
  seasonLabel,
  leagueAverage,
}: {
  loading: boolean;
  error: string | null;
  rows: { group: MatchGroup; overall: HitRate }[];
  option: MarketOption;
  league: string;
  leagueRate: HitRate | null;
  seasonLabel: string;
  leagueAverage: { value: string; label: string } | null;
}) {
  const { t } = useTranslation();
  if (error) return null;
  if (loading) {
    return (
      <div className="hero-card side-card" aria-hidden="true">
        <span className="sk" style={{ width: "50%", height: 14 }} />
        <span className="sk" style={{ height: 88, borderRadius: 14 }} />
        <span className="sk" style={{ height: 44, borderRadius: 12 }} />
        <span className="sk" style={{ height: 44, borderRadius: 12 }} />
        <span className="sk" style={{ height: 44, borderRadius: 12 }} />
      </div>
    );
  }
  const top = rows
    .filter((r) => r.overall.pct !== null && r.overall.total >= LOW_SAMPLE)
    .sort((a, b) => (b.overall.pct ?? 0) - (a.overall.pct ?? 0) || b.overall.total - a.overall.total)
    .slice(0, 3);
  if (top.length === 0 && !leagueRate) return null;
  const leaguePct = leagueRate?.pct != null ? Math.round(leagueRate.pct * 100) : null;

  return (
    <div className="hero-card side-card">
      <span className="hero-card-kicker">
        {t("markets:page.option")}: {option.label}
      </span>
      {leaguePct !== null && leagueRate && (
        <div className="side-card-league">
          <span className="market-ring side-card-ring" style={{ "--pct": leaguePct } as CSSProperties} aria-hidden="true">
            <strong>{withPercent(String(leaguePct))}</strong>
          </span>
          <p className="small">
            <Trans
              i18nKey={leagueAverage !== null ? "markets:page.leagueRateAverage" : "markets:page.leagueRate"}
              values={{
                season: seasonLabel,
                pct: withPercent(String(leaguePct)),
                hits: leagueRate.hits,
                total: leagueRate.total,
                average: leagueAverage?.value ?? "",
                label: leagueAverage?.label ?? "",
              }}
              components={{ bold: <strong /> }}
            />
          </p>
        </div>
      )}
      {top.map(({ group, overall }) => {
        const pct = Math.round((overall.pct ?? 0) * 100);
        return (
          <a key={group.key} href={`#grupo-${group.key}`} className="side-card-row side-card-top">
            <span className="side-card-row-teams">
              {group.teamId !== null && <TeamCrest team={group.name} league={league} />}
              <span>{group.name}</span>
            </span>
            <span className="side-card-top-figures">
              <span className="num side-card-row-date">
                {overall.hits}/{overall.total}
              </span>
              <strong>{withPercent(String(pct))}</strong>
            </span>
            <span className="side-card-top-bar" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </span>
          </a>
        );
      })}
    </div>
  );
}

function GroupCard({
  group,
  overall,
  market,
  option,
  view,
  take,
  league,
  interval,
  checked,
  onToggle,
  domestic,
}: {
  group: MatchGroup;
  overall: HitRate;
  market: MarketDef;
  option: MarketOption;
  view: ViewMode;
  take: (views: TeamMatchView[]) => TeamMatchView[];
  league: string;
  /** Por árbitro: el intervalo del 95 % y si se separa de la liga. */
  interval?: { leaguePct: number | null };
  checked: boolean;
  onToggle: () => void;
  domestic?: DomesticState;
}) {
  const { t } = useTranslation();
  const all = take(group.all);
  const avg = market.average ? average(all, market.average.value) : null;

  return (
    <section className="market-team" id={`grupo-${group.key}`}>
      <header className="market-team-header">
        <div className="market-team-title">
          {/* Anillo con el % de acierto alrededor del escudo (o vacio, por arbitro). */}
          <span
            className={overall.total < LOW_SAMPLE ? "market-ring is-low" : "market-ring"}
            style={{ "--pct": Math.round((overall.pct ?? 0) * 100) } as CSSProperties}
            aria-hidden="true"
          >
            {group.teamId !== null && <TeamCrest team={group.name} league={league} size="sm" />}
          </span>
          <div>
            <h2>{group.name}</h2>
            <div className="market-team-meta">
              <FormStrip views={all} option={option} />
              <label className="market-compare small">
                <input type="checkbox" checked={checked} onChange={onToggle} /> {t("markets:page.compare")}
              </label>
            </div>
            {avg !== null && market.average && (
              <p className="small muted market-average">
                {t("markets:page.average", { value: formatFixed(avg, 1), label: market.average.label })}
              </p>
            )}
            {interval && overall.total > 0 && <IntervalNote rate={overall} leaguePct={interval.leaguePct} />}
          </div>
        </div>
        <RateBar rate={overall} />
      </header>

      <GroupMatches group={group} market={market} option={option} view={view} take={take} />

      {domestic && <DomesticMatches state={domestic} market={market} option={option} view={view} take={take} />}
    </section>
  );
}

/** Intervalo del 95 % (Wilson) del porcentaje de un árbitro y, solo si queda
 * entero por encima o por debajo de la media de la liga, la marca de que se
 * separa de ella. Con sucesos raros (rojas) y ~20 partidos por
 * temporada, la mayoría no se separa: así no se lee ruido como tendencia. */
function IntervalNote({ rate, leaguePct }: { rate: HitRate; leaguePct: number | null }) {
  const { t } = useTranslation();
  const low = wilsonLower(rate.hits, rate.total);
  const high = wilsonUpper(rate.hits, rate.total);
  const pct = (x: number) => withPercent(String(Math.round(x * 100)));
  const side = leaguePct === null ? null : low > leaguePct ? "above" : high < leaguePct ? "below" : null;
  return (
    <p className="small muted market-interval">
      {t("markets:page.interval", { low: pct(low), high: pct(high) })}
      {side && (
        <span className={side === "above" ? "edge-up" : "edge-down"}>
          {" · "}
          {t(`markets:page.vsLeague.${side}`, { pct: pct(leaguePct!) })}
        </span>
      )}
    </p>
  );
}

/** Racha de la tarjeta: un cuadrito por partido, del mas antiguo al mas
 * reciente (como mucho los ultimos 12), verde si se cumplio y rojo si no. */
function FormStrip({ views, option }: { views: TeamMatchView[]; option: MarketOption }) {
  const recent = views.slice(0, 12).reverse();
  if (recent.length === 0) return null;
  return (
    <span className="market-form" aria-hidden="true">
      {recent.map((v) => {
        const hit = option.hit(v);
        return <span key={v.match.id} className={hit === null ? "is-unknown" : hit ? "is-hit" : "is-miss"} />;
      })}
    </span>
  );
}

/** Los partidos de una tarjeta: local y visitante, o todos juntos. */
function GroupMatches({
  group,
  market,
  option,
  view,
  take,
}: {
  group: MatchGroup;
  market: MarketDef;
  option: MarketOption;
  view: ViewMode;
  take: (views: TeamMatchView[]) => TeamMatchView[];
}) {
  const { t } = useTranslation();
  if (view === "all") {
    return <MatchList views={take(group.all)} market={market} option={option} teamId={group.teamId} />;
  }
  return (
    <div className="market-team-split">
      <MatchColumn title={t("markets:page.home")} views={take(group.home)} market={market} option={option} teamId={group.teamId} />
      <MatchColumn title={t("markets:page.away")} views={take(group.away)} market={market} option={option} teamId={group.teamId} />
    </div>
  );
}

interface DomesticState {
  /** Los partidos del equipo en su liga; null si no hay (o aun no se han pedido). */
  group: MatchGroup | null;
  loading: boolean;
  error: string | null;
  onOpen: () => void;
}

/** Champions: el mismo mercado en la liga del equipo, plegado al principio,
 * con sus porcentajes y sus partidos como en la tarjeta. */
function DomesticMatches({
  state,
  market,
  option,
  view,
  take,
}: {
  state: DomesticState;
  market: MarketDef;
  option: MarketOption;
  view: ViewMode;
  take: (views: TeamMatchView[]) => TeamMatchView[];
}) {
  const { t } = useTranslation();
  const { group } = state;
  const league = group?.all[0]?.match.league_code;
  const avg = group && market.average ? average(take(group.all), market.average.value) : null;
  return (
    <details className="market-domestic" onToggle={(e) => e.currentTarget.open && state.onOpen()}>
      <summary>
        {league ? t("markets:page.domestic.titleLeague", { league: leagueName(league) }) : t("markets:page.domestic.title")}
      </summary>
      {state.error ? (
        <p className="small muted">{t("markets:page.domestic.error", { error: state.error })}</p>
      ) : state.loading ? (
        <p className="small muted">{t("markets:page.domestic.loading")}</p>
      ) : !group ? (
        <p className="small muted">{t("markets:page.domestic.none")}</p>
      ) : (
        <>
          <div className="market-domestic-total">
            <div>
              <h3>{t("markets:page.domestic.total", { league: leagueName(league!) })}</h3>
              {avg !== null && market.average && (
                <p className="small muted market-average">
                  {t("markets:page.average", { value: formatFixed(avg, 1), label: market.average.label })}
                </p>
              )}
            </div>
            <RateBar rate={hitRate(take(group.all), option)} />
          </div>
          <GroupMatches group={group} market={market} option={option} view={view} take={take} />
        </>
      )}
    </details>
  );
}

function MatchColumn({
  title,
  views,
  market,
  option,
  teamId,
}: {
  title: string;
  views: TeamMatchView[];
  market: MarketDef;
  option: MarketOption;
  teamId: number | null;
}) {
  return (
    <div className="market-column">
      <div className="market-column-header">
        <h3>{title}</h3>
        <RateBar rate={hitRate(views, option)} />
      </div>
      <MatchList views={views} market={market} option={option} teamId={teamId} />
    </div>
  );
}

function RateBar({ rate }: { rate: HitRate }) {
  const { t } = useTranslation();
  if (rate.pct === null) {
    return (
      <div className="rate-bar rate-bar-empty">{rate.missing > 0 ? t("markets:page.noData") : t("markets:page.noMatchesShort")}</div>
    );
  }

  const yes = Math.round(rate.pct * 100);
  const low = rate.total < LOW_SAMPLE;
  const summary =
    rate.missing > 0
      ? t("markets:page.rateSummaryMissing", { hits: rate.hits, count: rate.total, missing: rate.missing })
      : t("markets:page.rateSummary", { hits: rate.hits, count: rate.total });
  return (
    <div className={low ? "rate rate-low" : "rate"} title={summary}>
      <div className="rate-bar" aria-label={t("markets:page.rateLabel", { pct: withPercent(String(yes)), summary })}>
        <div className="rate-bar-yes" style={{ width: `${yes}%` }}>
          {yes >= 15 && withPercent(String(yes))}
        </div>
        <div className="rate-bar-no" style={{ width: `${100 - yes}%` }}>
          {100 - yes >= 15 && withPercent(String(100 - yes))}
        </div>
      </div>
      <span className="rate-count">
        {rate.hits}/{rate.total}
      </span>
    </div>
  );
}

function MatchList({
  views,
  market,
  option,
  teamId,
}: {
  views: TeamMatchView[];
  market: MarketDef;
  option: MarketOption;
  teamId: number | null;
}) {
  const { t } = useTranslation();
  if (views.length === 0) {
    return <p className="small muted market-empty">{t("markets:page.noMatchesList")}</p>;
  }

  return (
    <table className="market-matches">
      <tbody>
        {views.map((v) => {
          const { match } = v;
          const hit = option.hit(v);
          const rowClass = hit === null ? "market-unknown" : hit ? "market-hit" : "market-miss";
          const detail = market.detail?.value(match);
          return (
            <tr key={match.id} className={rowClass}>
              <td className="market-date">{formatShortDate(match.date)}</td>
              <td className={match.home_team_id === teamId ? "market-home market-self" : "market-home"}>
                <TeamName team={match.home_team} league={match.league_code} reverse />
              </td>
              <td className="market-score">
                <Link to={`/matches/${match.id}`}>
                  {match.home_goals} - {match.away_goals}
                </Link>
              </td>
              <td className={match.away_team_id === teamId ? "market-away market-self" : "market-away"}>
                <TeamName team={match.away_team} league={match.league_code} />
              </td>
              {market.detail && (
                <td className="market-detail" title={market.detail.label}>
                  {detail ? <Detail value={detail} /> : "—"}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RedCards({ count }: { count?: number }) {
  const { t } = useTranslation();
  if (!count) return null;
  return (
    <span className="red-card" title={t("markets:page.redCards", { count })}>
      {count > 1 ? count : ""}
    </span>
  );
}

function Detail({ value }: { value: DetailValue }) {
  return (
    <>
      {value.home}
      <RedCards count={value.homeRed} /> - {value.away}
      <RedCards count={value.awayRed} />
    </>
  );
}
