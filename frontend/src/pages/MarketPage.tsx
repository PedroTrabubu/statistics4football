import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getLeagueContextResults, getLeagueResults, getLeagueSeasons, getLeagues } from "../api/client";
import { LeagueSwitch } from "../components/LeagueSwitch";
import { EmptyView, ErrorView, LoadingView } from "../components/StatusView";
import { TeamName } from "../components/TeamCrest";
import { formatSeason, formatShortDate } from "../lib/format";
import {
  MARKETS,
  average,
  familyVariants,
  findMarket,
  groupByReferee,
  groupByTeam,
  hitRate,
  type DetailValue,
  type HitRate,
  type MarketDef,
  type MarketOption,
  type MatchGroup,
  type TeamMatchView,
} from "../lib/markets";
import { CHAMPIONS_LEAGUE_CODE, DEFAULT_LEAGUE_CODE, leagueName, useSelectedLeagueCode } from "../lib/leagues";
import { matchesSearch } from "../lib/teamSearch";
import { useApi } from "../lib/useApi";

type Mode = "team" | "referee";
type ViewMode = "split" | "all";
type SortMode = "pct" | "name";

/** Por debajo de esto el porcentaje es poco fiable: se muestra atenuado. */
const LOW_SAMPLE = 5;

const LAST_N_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "Toda la temporada" },
  { value: 10, label: "Últimos 10" },
  { value: 5, label: "Últimos 5" },
];

/** Mercados que tienen sentido por arbitro: los que dan lo mismo mirados
 * desde cualquiera de los dos equipos. */
const REFEREE_MARKETS = MARKETS.filter((m) => m.matchLevel);

/** La opcion elegida se recuerda por familia (al pasar de "córners del
 * partido" a "cada equipo" se mantiene la linea si existe en la variante). */
const optionMemoryKey = (market: MarketDef) => market.family?.key ?? market.slug;

const OPTION_ROWS: { row: MarketOption["row"]; label: string | null }[] = [
  { row: undefined, label: null },
  { row: "over", label: "Más de" },
  { row: "under", label: "Menos de" },
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

  const {
    data: results,
    loading,
    error,
  } = useApi(
    () =>
      leagueId !== undefined && effectiveSeason !== undefined
        ? getLeagueResults(leagueId, effectiveSeason)
        : Promise.resolve([]),
    [leagueId, effectiveSeason],
  );

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

  const seasonLabel = effectiveSeason ? formatSeason(effectiveSeason) : "esta temporada";
  // Partidos jugados sin arbitro en ninguna fuente: no cuentan para nadie.
  const withoutReferee = mode === "referee" && results ? results.filter((r) => !r.referee).length : 0;
  const hasMissing = rows.some((r) => r.overall.missing > 0);
  const groupNoun = mode === "team" ? "equipo" : "árbitro";

  return (
    <div>
      <h1>{mode === "team" ? market.title : "Árbitros"}</h1>
      <p className="page-lead">
        {mode === "team"
          ? market.description
          : "Cómo se comportan los partidos de cada árbitro: tarjetas, puntos de tarjeta, córners o goles. Solo mercados del partido completo, que no dependen de qué equipo sea local."}
      </p>

      <LeagueSwitch leagues={leagues} value={leagueCode} onChange={(code) => code && setLeagueCode(code)} />

      <div className="filters">
        <input
          type="search"
          className="market-search"
          aria-label={`Buscar ${groupNoun}`}
          placeholder={`Buscar ${groupNoun}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {mode === "referee" && (
          <select aria-label="Mercado" value={market.slug} onChange={(e) => onMarketChange?.(e.target.value)}>
            {REFEREE_MARKETS.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.title}
              </option>
            ))}
          </select>
        )}


        <select aria-label="Temporada" value={effectiveSeason ?? ""} onChange={(e) => setSeason(e.target.value)}>
          {seasons?.map((s) => (
            <option key={s} value={s}>
              {formatSeason(s)}
            </option>
          ))}
        </select>

        <select
          aria-label="Partidos"
          value={lastN ?? ""}
          onChange={(e) => setLastN(e.target.value ? Number(e.target.value) : null)}
        >
          {LAST_N_OPTIONS.map((o) => (
            <option key={o.label} value={o.value ?? ""}>
              {o.label}
            </option>
          ))}
        </select>

        <select aria-label="Ordenar" value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
          <option value="pct">Ordenar por %</option>
          <option value="name">Ordenar por nombre</option>
        </select>
      </div>

      {mode === "team" && variants.length > 1 && (
        <div className="filters">
          <label className="market-variant">
            <span className="small muted">Estadística</span>
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
              {label && <span className="market-option-label">{label}</span>}
              <div className="tab-group market-options" role="group" aria-label={label ?? "Opción"}>
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
          <div className="tab-group" role="group" aria-label="Vista">
            <button
              type="button"
              className={viewMode === "split" ? "tab-button tab-button-active" : "tab-button"}
              onClick={() => setViewMode("split")}
            >
              Local / Visitante
            </button>
            <button
              type="button"
              className={viewMode === "all" ? "tab-button tab-button-active" : "tab-button"}
              onClick={() => setViewMode("all")}
            >
              Todos los partidos
            </button>
          </div>
        )}
      </div>

      {leagueRate && leagueRate.pct !== null && (
        <p className="small muted market-league-rate">
          Media de la liga en {seasonLabel}: <strong>{Math.round(leagueRate.pct * 100)}%</strong> de los partidos (
          {leagueRate.hits} de {leagueRate.total})
          {market.average && leagueViews && average(leagueViews, market.average.value) !== null && (
            <>
              {" "}
              · {average(leagueViews, market.average.value)!.toFixed(1)} {market.average.label}
            </>
          )}
          .
        </p>
      )}

      {market.note && <p className="small muted intro-note">{market.note}</p>}

      {!loading && !error && rows.length > 0 && withoutReferee > 0 && (
        <p className="small muted intro-note">
          {withoutReferee === 1 ? "1 partido" : `${withoutReferee} partidos`} de {seasonLabel} no{" "}
          {withoutReferee === 1 ? "tiene" : "tienen"} árbitro en las fuentes de datos y no{" "}
          {withoutReferee === 1 ? "cuenta" : "cuentan"} para ningún árbitro: sus cifras pueden estar incompletas.
        </p>
      )}

      {loading && <LoadingView label="Cargando partidos..." />}
      {error && <ErrorView message={`No se pudo conectar con la API: ${error}`} />}
      {!loading && !error && rows.length === 0 && (
        <EmptyView
          message={
            mode === "referee" && results && results.length > 0
              ? `No hay datos de árbitro para esta liga en ${seasonLabel}. Fuera de la Premier League, los árbitros vienen de ESPN, que no los tiene antes de la 21/22.`
              : "No hay partidos jugados para esta liga y temporada."
          }
        />
      )}

      {!loading && !error && rows.length > 0 && visible.length === 0 && (
        <EmptyView message={`Ningún ${groupNoun} de esta liga coincide con «${query.trim()}». Prueba en otra liga.`} />
      )}

      {comparing.length > 0 && (
        <p className="small market-compare-note">
          {comparing.length === 2
            ? `Comparando ${comparing.map((k) => rows.find((r) => r.group.key === k)!.group.name).join(" y ")}.`
            : `Marca otro ${groupNoun} para compararlo con ${rows.find((r) => r.group.key === comparing[0])!.group.name}.`}{" "}
          <button type="button" className="link-button" onClick={() => setPicked([])}>
            Quitar
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
          Verde: se cumplió «{option.label}». Rojo: no se cumplió.
          {market.detail && ` La columna de la derecha es: ${market.detail.label.toLowerCase()} (local - visitante).`}
          {hasMissing && " Gris: el partido no tiene ese dato y no cuenta en el porcentaje."} Con menos de{" "}
          {LOW_SAMPLE} partidos el porcentaje de un {groupNoun} aparece atenuado: es poco fiable, tómalo como
          orientativo.
        </p>
      )}
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
  checked: boolean;
  onToggle: () => void;
  domestic?: DomesticState;
}) {
  const all = take(group.all);
  const avg = market.average ? average(all, market.average.value) : null;

  return (
    <section className="market-team">
      <header className="market-team-header">
        <div>
          {/* Por equipo, con su escudo; por arbitro, solo el nombre. */}
          <h2>{group.teamId !== null ? <TeamName team={group.name} league={league} size="md" /> : group.name}</h2>
          <label className="market-compare small">
            <input type="checkbox" checked={checked} onChange={onToggle} /> Comparar
          </label>
          {avg !== null && market.average && (
            <p className="small muted market-average">
              {avg.toFixed(1)} {market.average.label}
            </p>
          )}
        </div>
        <RateBar rate={overall} />
      </header>

      <GroupMatches group={group} market={market} option={option} view={view} take={take} />

      {domestic && <DomesticMatches state={domestic} market={market} option={option} view={view} take={take} />}
    </section>
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
  if (view === "all") {
    return <MatchList views={take(group.all)} market={market} option={option} teamId={group.teamId} />;
  }
  return (
    <div className="market-team-split">
      <MatchColumn title="Local" views={take(group.home)} market={market} option={option} teamId={group.teamId} />
      <MatchColumn title="Visitante" views={take(group.away)} market={market} option={option} teamId={group.teamId} />
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
  const { group } = state;
  const league = group?.all[0]?.match.league_code;
  const avg = group && market.average ? average(take(group.all), market.average.value) : null;
  return (
    <details className="market-domestic" onToggle={(e) => e.currentTarget.open && state.onOpen()}>
      <summary>Ver en su liga{league ? `: ${leagueName(league)}` : ""}</summary>
      {state.error ? (
        <p className="small muted">No se pudieron cargar sus partidos de liga: {state.error}</p>
      ) : state.loading ? (
        <p className="small muted">Cargando sus partidos de liga...</p>
      ) : !group ? (
        <p className="small muted">No tenemos su liga en los datos, o aún no ha jugado partidos de liga esta temporada.</p>
      ) : (
        <>
          <div className="market-domestic-total">
            <div>
              <h3>Total en {leagueName(league!)}</h3>
              {avg !== null && market.average && (
                <p className="small muted market-average">
                  {avg.toFixed(1)} {market.average.label}
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
  if (rate.pct === null) {
    return <div className="rate-bar rate-bar-empty">{rate.missing > 0 ? "Sin datos" : "Sin partidos"}</div>;
  }

  const yes = Math.round(rate.pct * 100);
  const low = rate.total < LOW_SAMPLE;
  const summary = `${rate.hits} de ${rate.total} partidos${rate.missing > 0 ? ` (${rate.missing} sin datos)` : ""}`;
  return (
    <div className={low ? "rate rate-low" : "rate"} title={summary}>
      <div className="rate-bar" aria-label={`${yes}%: ${summary}`}>
        <div className="rate-bar-yes" style={{ width: `${yes}%` }}>
          {yes >= 15 && `${yes}%`}
        </div>
        <div className="rate-bar-no" style={{ width: `${100 - yes}%` }}>
          {100 - yes >= 15 && `${100 - yes}%`}
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
  if (views.length === 0) {
    return <p className="small muted market-empty">Sin partidos.</p>;
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
  if (!count) return null;
  return (
    <span className="red-card" title={count === 1 ? "Expulsión" : `${count} expulsiones`}>
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
