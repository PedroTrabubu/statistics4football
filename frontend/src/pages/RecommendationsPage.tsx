import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { getLeagues, getRecommendationHistory, getRecommendations } from "../api/client";
import type {
  League,
  Recommendation,
  RecommendationHistoryBreakdown,
  RecommendationHistoryItem,
  RecommendationHistorySummary,
} from "../api/types";
import { LeagueLogo } from "../components/LeagueLogo";
import { DayTabs } from "../components/DayTabs";
import { LeagueSwitch } from "../components/LeagueSwitch";
import { PageHero } from "../components/PageHero";
import { SampleBadge } from "../components/SampleBadge";
import { EmptyView, ErrorView, LoadingView } from "../components/StatusView";
import { MatchTeams } from "../components/TeamCrest";
import {
  formatDateTime,
  parseApiDate,
  formatFixed,
  formatLocaleNumber,
  formatMatchday,
  formatPercent,
  joinParts,
  marketLabel,
  selectionLabel,
  withPercent,
} from "../lib/format";
import { t as translate } from "../i18n";
import { leagueName, leagueShortName, onlyValidated, orderLeagues, useSelectedLeagueCode } from "../lib/leagues";
import { dayKey, upcomingDays } from "../lib/streaks";
import { useApi } from "../lib/useApi";

type Tab = "proxima" | "jornadas" | "resumen" | "equipos";

/** Las mismas vistas (y sus textos) que Picks probables. */
const VIEWS: { key: Tab; text: string }[] = [
  { key: "proxima", text: "next" },
  { key: "jornadas", text: "played" },
  { key: "resumen", text: "summary" },
  { key: "equipos", text: "teams" },
];

/** Margen sobre el mercado en 22/23–24/25, liga a liga, con su intervalo al
 * 95 % (scripts/report_pattern_by_league.py): en Premier y LaLiga, la
 * validación cruzada de docs/MODELO_PATRONES.md; en Hypermotion y Serie A, el
 * modelo de la web, que no vio esas ligas (docs/LIGAS_NUEVAS.md). El de
 * 25/26–26/27 sale del histórico. */
const EARLIER_MARGIN: Record<string, { margin: number; low: number; high: number; n: number }> = {
  "ENG-Premier League": { margin: -2.4, low: -6.5, high: 1.8, n: 491 },
  "ESP-La Liga": { margin: 2.3, low: -1.5, high: 6.0, n: 518 },
  "ESP-La Liga 2": { margin: 1.7, low: -2.0, high: 5.5, n: 510 },
  "ITA-Serie A": { margin: -1.0, low: -6.5, high: 4.1, n: 272 },
};

/** De dónde sale "el mercado esperaba" en cada mercado (texto en
 * recommendations:origin.<clave>): de la cuota real sin margen (Shin), de
 * sumar la de 1X2 o de un Poisson ajustado a las cuotas. */
const MARKET_ORIGIN: Record<string, string> = {
  "1x2": "real",
  double_chance: "derived",
  "over_under_2.5": "realOverUnder",
};
const originOf = (market: string) => MARKET_ORIGIN[market] ?? "estimated";

/** Un porcentaje que la API ya da redondeado (0-100): "74.8%". */
const apiPct = (value: number | null) => (value !== null ? withPercent(formatLocaleNumber(value)) : "—");

/** Cifra con signo: "+3.2". */
const signed = (value: number) => `${value > 0 ? "+" : ""}${formatFixed(value, 1)}`;

/** Diferencia en puntos (de porcentaje) con signo: "+3.2 pts". */
const pts = (value: number) => translate("recommendations:points", { value: signed(value) });

/** Acierto menos lo que esperaba el mercado, con las cifras ya redondeadas que se muestran. */
function marginOf(b: RecommendationHistorySummary | RecommendationHistoryBreakdown): number | null {
  return b.hit_rate !== null && b.market_expected_hit_rate !== null ? b.hit_rate - b.market_expected_hit_rate : null;
}

/** "IC 95 %: +1,2 a +8,4" (o solo el rango con key="ciRange"). */
function ciText(b: RecommendationHistorySummary | RecommendationHistoryBreakdown, key = "ci"): string | null {
  return b.margin_ci_low !== null && b.margin_ci_high !== null
    ? translate(`recommendations:history.${key}`, { low: signed(b.margin_ci_low), high: signed(b.margin_ci_high) })
    : null;
}

export function RecommendationsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("proxima");
  const [selectedCode, setLeagueCode] = useSelectedLeagueCode();
  const { data: allLeagues } = useApi(() => getLeagues(), []);
  const { leagues, code: leagueCode, pending } = onlyValidated(allLeagues, selectedCode, "high_probability");
  const leagueId = leagues?.find((l) => l.code === leagueCode)?.id;

  return (
    <div className="hp-page">
      <PageHero
        eyebrow={leagueCode === null ? t("common:league.all") : leagueName(leagueCode)}
        title={t("nav:highProbability")}
        lead={<p>{t("recommendations:lead")}</p>}
        aside={leagues ? <HeroSummaryCard leagueId={leagueId} onShowHistory={() => setTab("resumen")} /> : undefined}
      >
        <RuleChips />
      </PageHero>

      <LeagueSwitch leagues={leagues} value={leagueCode} onChange={setLeagueCode} allowAll />
      {pending && <p className="small muted">{pending}</p>}

      <div className="hp-toolbar">
        <div className="tab-group picks-tabs" role="tablist" aria-label={t("picks:probablePage.viewLabel")}>
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={tab === v.key}
              className={tab === v.key ? "tab-button tab-button-active" : "tab-button"}
              onClick={() => setTab(v.key)}
            >
              <span className="label-long">{t(`picks:probablePage.view.${v.text}.label`)}</span>
              <span className="label-short">{t(`picks:probablePage.view.${v.text}.short`)}</span>
            </button>
          ))}
        </div>
      </div>

      {leagues &&
        (tab === "proxima" ? (
          <UpcomingHighProbability leagueId={leagueId} onShowHistory={() => setTab("resumen")} />
        ) : (
          <HighProbabilityHistory leagueId={leagueId} view={tab} />
        ))}

      <MarginCallout leagues={leagues} />
    </div>
  );
}

/** Las tres reglas con las que el modelo elige, de un vistazo; el texto
 * completo, desplegable debajo. */
function RuleChips() {
  const { t } = useTranslation();
  return (
    <div className="hp-rules rise" style={{ animationDelay: "0.2s" }}>
      <ul className="hp-rule-chips">
        {(["min", "edge", "one"] as const).map((key) => (
          <li key={key}>
            <Trans i18nKey={`recommendations:rule.${key}`} components={{ bold: <strong className="num" /> }} />
          </li>
        ))}
      </ul>
      <details className="hp-rule-more">
        <summary>{t("recommendations:rule.more")}</summary>
        <p>
          <Trans i18nKey="recommendations:intro.highProbability" components={{ bold: <strong /> }} />
        </p>
      </details>
    </div>
  );
}

/** Tarjeta del hero: cómo les fue a las selecciones ya jugadas. El acierto
 * en un anillo y, al lado, lo que esperaba el mercado y el margen, que es la
 * cifra que importa. */
function HeroSummaryCard({ leagueId, onShowHistory }: { leagueId: number | undefined; onShowHistory: () => void }) {
  const { t } = useTranslation();
  const { data, loading } = useApi(() => getRecommendationHistory({ league_id: leagueId, limit: 1 }), [leagueId]);

  if (loading && !data) {
    return (
      <div className="hero-card side-card" aria-hidden="true">
        <span className="sk" style={{ width: "50%", height: 14 }} />
        <span className="sk" style={{ height: 96, borderRadius: 14 }} />
        <span className="sk" style={{ height: 52, borderRadius: 12 }} />
      </div>
    );
  }
  const summary = data?.summary;
  if (!summary || summary.total === 0 || summary.hit_rate === null) return null;
  const margin = marginOf(summary);
  const ci = ciText(summary);

  return (
    <div className="hero-card side-card hp-hero-card">
      <span className="hero-card-kicker">
        {t("recommendations:tabHistory")} · {t("recommendations:callout.recent")}
      </span>
      <div className="side-card-league">
        <span
          className="market-ring side-card-ring"
          style={{ "--pct": Math.round(summary.hit_rate) } as CSSProperties}
          aria-hidden="true"
        >
          <strong>{withPercent(String(Math.round(summary.hit_rate)))}</strong>
        </span>
        <div className="hp-hero-figures">
          <span>
            {t("recommendations:history.tile.hitRate")} <strong className="num">{apiPct(summary.hit_rate)}</strong>
          </span>
          <span>
            {t("recommendations:history.tile.marketExpected")}{" "}
            <strong className="num">{apiPct(summary.market_expected_hit_rate)}</strong>
          </span>
        </div>
      </div>
      <ProbDuel
        value={summary.hit_rate / 100}
        mark={summary.market_expected_hit_rate !== null ? summary.market_expected_hit_rate / 100 : null}
      />
      <div className="hp-hero-margin">
        <span className="small muted">{t("recommendations:history.tile.margin")}</span>
        {margin !== null && <MarginPill value={margin} large />}
        {ci && <span className="small muted num">{ci}</span>}
      </div>
      <button type="button" className="side-card-row hp-hero-link" onClick={onShowHistory}>
        <span className="small">
          {t("recommendations:history.tile.wonLost")}{" "}
          <strong className="num">
            <span className="hp-won">{summary.won}</span> / <span className="hp-lost">{summary.lost}</span>
          </strong>
        </span>
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}

/** Barra de probabilidad: relleno verde hasta `value` (0-1) y una marca en
 * lo que esperaba el mercado (`mark`). Verde si lo supera; rojo si no. */
function ProbDuel({ value, mark }: { value: number; mark: number | null }) {
  const good = mark === null || value >= mark;
  return (
    <span className="hp-duel" aria-hidden="true">
      <span className={`hp-duel-fill ${good ? "is-good" : "is-bad"}`} style={{ width: `${value * 100}%` }} />
      {mark !== null && <span className="hp-duel-mark" style={{ left: `${mark * 100}%` }} />}
    </span>
  );
}

function MarginPill({ value, large = false }: { value: number; large?: boolean }) {
  const tone = value > 0 ? "edge-pill-up" : value < 0 ? "edge-pill-down" : "";
  return <span className={`edge-pill ${tone}${large ? " hp-pill-lg" : ""} num`}>{pts(value)}</span>;
}

/** Margen sobre el mercado liga a liga, como un gráfico de intervalos: cada
 * barra es el IC 95 % y el punto, el margen. Si la barra cruza el 0, ese
 * margen no se distingue del azar. Antes (22/23–24/25) y ahora (25/26–26/27). */
function MarginCallout({ leagues }: { leagues: League[] | null }) {
  const { t } = useTranslation();
  const titleId = useId();
  const { data } = useApi(() => getRecommendationHistory({ limit: 1 }), []);
  const recent = new Map((data?.by_league ?? []).map((b) => [b.key, b]));
  if (!leagues || leagues.length === 0) return null;

  const rows = orderLeagues(leagues).map((league) => {
    const before = EARLIER_MARGIN[league.code] ?? null;
    const now = recent.get(league.code);
    const nowMargin = now ? marginOf(now) : null;
    return {
      league,
      before,
      now:
        now && nowMargin !== null
          ? { margin: nowMargin, low: now.margin_ci_low, high: now.margin_ci_high, n: now.total }
          : null,
    };
  });
  // Escala común: de lo más bajo a lo más alto de todos los intervalos, con el 0 siempre dentro.
  const ends = rows.flatMap((r) =>
    [r.before, r.now].flatMap((x) => (x ? [x.low ?? x.margin, x.high ?? x.margin] : [])),
  );
  const min = Math.min(-4, ...ends) - 1;
  const max = Math.max(4, ...ends) + 1;
  const at = (v: number) => `${((v - min) / (max - min)) * 100}%`;

  return (
    <section className="detail-section hp-callout" aria-labelledby={titleId}>
      <div className="section-head">
        <h2 id={titleId}>{t("recommendations:callout.title")}</h2>
        <span className="hp-legend small">
          <span className="hp-legend-item">
            <span className="hp-legend-swatch is-before" />
            {t("recommendations:callout.before")}
          </span>
          <span className="hp-legend-item">
            <span className="hp-legend-swatch is-now" />
            {t("recommendations:callout.recent")}
          </span>
        </span>
      </div>
      <p className="hp-callout-caption">{t("recommendations:callout.definition")}</p>

      <div className="hp-forest" role="table" aria-labelledby={titleId}>
        <div className="hp-forest-row hp-forest-head" role="row">
          <span role="columnheader">{t("common:league.label")}</span>
          <span role="columnheader" className="hp-forest-axis">
            <span style={{ left: at(0) }}>0</span>
          </span>
          <span role="columnheader" className="hp-forest-values-head">
            {t("recommendations:history.column.margin")}
          </span>
        </div>
        {rows.map(({ league, before, now }) => (
          <div className="hp-forest-row" role="row" key={league.code}>
            <span role="rowheader" className="hp-callout-league">
              <LeagueLogo code={league.code} />
              <span className="league-name-full">{leagueName(league.code)}</span>
              <span className="league-name-short">{leagueShortName(league.code)}</span>
            </span>
            <span role="cell" className="hp-forest-plot" aria-hidden="true">
              <span className="hp-forest-zero" style={{ left: at(0) }} />
              {before && <ForestBar kind="before" figure={before} at={at} />}
              {now && <ForestBar kind="now" figure={now} at={at} />}
            </span>
            <span role="cell" className="hp-forest-values">
              <ForestValue label={t("recommendations:callout.before")} figure={before} />
              <ForestValue label={t("recommendations:callout.recent")} figure={now} />
            </span>
          </div>
        ))}
      </div>

      <p className="small muted hp-callout-method">{t("recommendations:callout.method")}</p>
      <p className="hp-callout-notice">{t("recommendations:notice")}</p>
    </section>
  );
}

type MarginFigure = { margin: number; low: number | null; high: number | null; n: number };

function ForestBar({ kind, figure, at }: { kind: "before" | "now"; figure: MarginFigure; at: (v: number) => string }) {
  const low = figure.low ?? figure.margin;
  const high = figure.high ?? figure.margin;
  const crossesZero = low <= 0 && high >= 0;
  const tone = crossesZero ? "is-neutral" : figure.margin > 0 ? "is-up" : "is-down";
  return (
    <span className={`hp-forest-bar is-${kind} ${tone}`}>
      <span className="hp-forest-ci" style={{ left: at(low), width: `calc(${at(high)} - ${at(low)})` }} />
      <span className="hp-forest-dot" style={{ left: at(figure.margin) }} />
    </span>
  );
}

function ForestValue({ label, figure }: { label: string; figure: MarginFigure | null }) {
  const { t } = useTranslation();
  if (!figure) {
    return (
      <span className="hp-forest-value">
        <span className="small muted">{label}</span>
        <span className="muted">—</span>
      </span>
    );
  }
  return (
    <span
      className="hp-forest-value"
      title={
        figure.low !== null && figure.high !== null
          ? t("recommendations:callout.detail", { low: signed(figure.low), high: signed(figure.high), n: figure.n })
          : t("recommendations:callout.detailNoCi", { n: figure.n })
      }
    >
      <span className="small muted">{label}</span>
      <strong className={`num ${figure.margin > 0 ? "edge-up" : figure.margin < 0 ? "edge-down" : ""}`}>
        {pts(figure.margin)}
      </strong>
    </span>
  );
}

interface LeagueFilterProps {
  leagueId: number | undefined;
}

/** Próximos partidos: sin selecciones, el aviso lleva al histórico. */
interface UpcomingProps extends LeagueFilterProps {
  onShowHistory: () => void;
}

function UpcomingHighProbability({ leagueId, onShowHistory }: UpcomingProps) {
  const { t } = useTranslation();
  const {
    data: recommendations,
    loading,
    error,
  } = useApi(() => getRecommendations({ league_id: leagueId, limit: 100 }), [leagueId]);
  // Un dia concreto (clave "2026-10-27") o null: todos.
  const [day, setDay] = useState<string | null>(null);

  if (loading) return <LoadingView label={t("recommendations:loading")} />;
  if (error) return <ErrorView message={t("common:error.api", { error })} />;
  if (!recommendations || recommendations.length === 0) {
    return (
      <EmptyView
        message={t("recommendations:emptyHighProbability")}
        action={
          <button type="button" className="link-button" onClick={onShowHistory}>
            {t("recommendations:seeHistory")}
          </button>
        }
      />
    );
  }

  const sorted = [...recommendations].sort((a, b) => a.date.localeCompare(b.date));
  const dayOf = (iso: string) => dayKey(parseApiDate(iso));
  const counts: Record<string, number> = {};
  for (const rec of sorted) counts[dayOf(rec.date)] = (counts[dayOf(rec.date)] ?? 0) + 1;
  const shown = day === null ? sorted : sorted.filter((rec) => dayOf(rec.date) === day);
  return (
    <>
      <DayTabs
        days={upcomingDays()}
        value={day}
        onChange={setDay}
        allDate={t("recommendations:dayCount", { count: sorted.length })}
        enabled={(key) => (counts[key] ?? 0) > 0}
        title={(key) => t("recommendations:dayCount", { count: counts[key] ?? 0 })}
      />
      <div className="hp-grid">
        {shown.map((rec, i) => (
          <UpcomingCard key={`${rec.match_id}-${rec.market}-${rec.selection}`} rec={rec} index={i} />
        ))}
      </div>
    </>
  );
}

/** Una selección de un partido por jugar: el partido, la selección en grande
 * y la barra modelo frente a mercado, con la ventaja en puntos. */
function UpcomingCard({ rec, index }: { rec: Recommendation; index: number }) {
  const { t } = useTranslation();
  const edge = (rec.prob_model - rec.prob_market_implied) * 100;
  return (
    <article className="hp-card" style={{ animationDelay: `${Math.min(index, 8) * 0.05}s` }}>
      <Link to={`/matches/${rec.match_id}`} className="hp-card-head">
        <span className="num hp-card-date">{formatDateTime(rec.date)}</span>
        <MatchTeams home={rec.home_team} away={rec.away_team} league={rec.league_code} middle="vs" />
        <span className="small muted">{joinParts(leagueName(rec.league_code), formatMatchday(rec.matchday))}</span>
      </Link>
      <div className="hp-card-pick">
        <span className="hp-card-market small muted">{marketLabel(rec.market)}</span>
        <strong className="hp-card-selection">
          {selectionLabel(rec.market, rec.selection, rec.home_team, rec.away_team)}
        </strong>
      </div>
      <ProbDuel value={rec.prob_model} mark={rec.prob_market_implied} />
      <div className="hp-card-figures">
        <span className="hp-figure">
          <span className="small muted">{t("recommendations:column.modelProb")}</span>
          <strong className="num">{formatPercent(rec.prob_model)}</strong>
        </span>
        <span className="hp-figure">
          <span className="small muted">{t("recommendations:column.marketProb")}</span>
          <span className="num">{formatPercent(rec.prob_market_implied)}</span>
        </span>
        <span className="hp-figure hp-figure-edge">
          <span className="small muted">{t("recommendations:column.edge")}</span>
          <MarginPill value={edge} />
        </span>
      </div>
      <div className="hp-card-foot">
        <SampleBadge matchesUsed={rec.matches_used} />
      </div>
    </article>
  );
}

function HighProbabilityHistory({ leagueId, view }: LeagueFilterProps & { view: Tab }) {
  const { t } = useTranslation();
  const { data, loading, error } = useApi(() => getRecommendationHistory({ league_id: leagueId, limit: 100 }), [leagueId]);

  if (loading) return <LoadingView label={t("recommendations:history.loading")} />;
  if (error) return <ErrorView message={t("common:error.api", { error })} />;
  if (!data || data.summary.total === 0) return <EmptyView message={t("recommendations:history.empty")} />;

  const { summary } = data;
  const margin = marginOf(summary);

  if (view === "jornadas") {
    return (
      <section className="detail-section hp-results">
        <h2>{t("recommendations:history.listTitle")}</h2>
        <ul className="hp-result-list">
          {data.items.map((rec, i) => (
            <ResultRow key={`${rec.match_id}-${rec.market}-${rec.selection}-${i}`} rec={rec} />
          ))}
        </ul>
      </section>
    );
  }

  if (view === "equipos") {
    return (
      <Breakdown
        title={t("recommendations:history.column.team")}
        rows={data.by_team}
        label={(b) => b.key}
        details={(b) => data.by_team_market[b.key]}
        hits={(b) => <TeamHits leagueId={leagueId} team={b.key} />}
      />
    );
  }

  return (
    <>
      <section className="detail-section hp-summary">
        <div className="hp-summary-tiles">
          <SummaryTile label={t("recommendations:history.tile.hitRate")} value={apiPct(summary.hit_rate)} strong />
          <SummaryTile
            label={t("recommendations:history.tile.marketExpected")}
            value={apiPct(summary.market_expected_hit_rate)}
          />
          <SummaryTile
            label={t("recommendations:history.tile.margin")}
            value={margin !== null ? <MarginPill value={margin} large /> : "—"}
            sub={ciText(summary)}
          />
          <SummaryTile
            label={t("recommendations:history.tile.wonLost")}
            value={
              <>
                <span className="hp-won">{summary.won}</span>
                <span className="muted"> / </span>
                <span className="hp-lost">{summary.lost}</span>
              </>
            }
            sub={<WonLostBar won={summary.won} lost={summary.lost} />}
          />
        </div>
        <p className="small muted intro-note">
          <Trans i18nKey="recommendations:history.note.highProbability" components={{ bold: <strong /> }} />
        </p>
      </section>

      {leagueId === undefined && data.by_league.length > 0 && (
        <Breakdown
          title={t("common:league.label")}
          rows={data.by_league}
          label={(b) => (
            <span className="hp-callout-league">
              <LeagueLogo code={b.key} />
              {leagueName(b.key)}
            </span>
          )}
        />
      )}

      {data.by_market.length > 1 && (
        <Breakdown
          title={t("recommendations:column.market")}
          rows={data.by_market}
          label={(b) => (
            <>
              {marketLabel(b.key)}
              <span className="small muted hp-break-origin">{t(`recommendations:origin.${originOf(b.key)}`)}</span>
            </>
          )}
        />
      )}

    </>
  );
}

function SummaryTile({
  label,
  value,
  sub,
  strong = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  strong?: boolean;
}) {
  return (
    <div className={strong ? "hp-tile is-strong" : "hp-tile"}>
      <span className="hp-tile-label">{label}</span>
      <span className="hp-tile-value num">{value}</span>
      {sub && <span className="hp-tile-sub small muted num">{sub}</span>}
    </div>
  );
}

function WonLostBar({ won, lost }: { won: number; lost: number }) {
  const total = won + lost;
  if (total === 0) return null;
  return (
    <span className="hp-wl-bar" aria-hidden="true">
      <span className="hp-wl-won" style={{ width: `${(won / total) * 100}%` }} />
    </span>
  );
}

/** Acierto, lo que esperaba el mercado y el margen, fila a fila (por liga o
 * por mercado), con la misma barra que las tarjetas. */
/** Una fila por clave (liga, mercado, equipo). `details`: sus mercados, que
 * se despliegan al pulsar la fila. Pulsando "Margen" se ordena por margen. */
function Breakdown({
  title,
  rows,
  label,
  details,
  hits,
}: {
  title: string;
  rows: RecommendationHistoryBreakdown[];
  label: (b: RecommendationHistoryBreakdown) => ReactNode;
  details?: (b: RecommendationHistoryBreakdown) => RecommendationHistoryBreakdown[] | undefined;
  /** Las selecciones acertadas de la fila, al pulsar su número de selecciones. */
  hits?: (b: RecommendationHistoryBreakdown) => ReactNode;
}) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<"desc" | "asc" | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [openHits, setOpenHits] = useState<string | null>(null);
  const sorted =
    sort === null
      ? rows
      : [...rows].sort((a, b) => {
          const diff = (marginOf(a) ?? -Infinity) - (marginOf(b) ?? -Infinity);
          return sort === "desc" ? -diff : diff;
        });
  const arrow = sort === "desc" ? " ↓" : sort === "asc" ? " ↑" : "";

  return (
    <section className="detail-section hp-breakdown">
      <div className="hp-break-row hp-break-head">
        <span>{title}</span>
        <span className="num">{t("recommendations:history.column.selections")}</span>
        <span>
          {t("recommendations:history.column.hitRate")} · {t("recommendations:history.column.marketExpected")}
        </span>
        <button
          type="button"
          className="hp-break-sort"
          aria-pressed={sort !== null}
          onClick={() => setSort(sort === "desc" ? "asc" : sort === "asc" ? null : "desc")}
        >
          {t("recommendations:history.column.margin")}
          {arrow}
        </button>
      </div>
      {sorted.map((b) => {
        const sub = details?.(b);
        const expanded = open === b.key && sub !== undefined;
        return (
          <div key={b.key}>
            {sub ? (
              <div className="hp-break-row">
                <BreakdownCells
                  b={b}
                  label={
                    <button
                      type="button"
                      className="hp-break-toggle"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : b.key)}
                    >
                      {expanded ? "▾ " : "▸ "}
                      {label(b)}
                    </button>
                  }
                  count={
                    hits ? (
                      <button
                        type="button"
                        className="hp-break-toggle hp-break-count"
                        aria-expanded={openHits === b.key}
                        title={t("recommendations:history.showHits")}
                        onClick={() => setOpenHits(openHits === b.key ? null : b.key)}
                      >
                        {b.total}
                      </button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <div className="hp-break-row">
                <BreakdownCells b={b} label={label(b)} />
              </div>
            )}
            {expanded &&
              sub.map((m) => (
                <div className="hp-break-row hp-break-sub" key={m.key}>
                  <BreakdownCells b={m} label={marketLabel(m.key)} />
                </div>
              ))}
            {hits && openHits === b.key && <div className="hp-break-hits">{hits(b)}</div>}
          </div>
        );
      })}
    </section>
  );
}

function BreakdownCells({ b, label, count }: { b: RecommendationHistoryBreakdown; label: ReactNode; count?: ReactNode }) {
  const m = marginOf(b);
  const ci = ciText(b, "ciRange");
  return (
    <>
      <span className="hp-break-label">{label}</span>
      <span className="num hp-break-n">{count ?? b.total}</span>
      <span className="hp-break-rate">
        {b.hit_rate !== null ? (
          <ProbDuel
            value={b.hit_rate / 100}
            mark={b.market_expected_hit_rate !== null ? b.market_expected_hit_rate / 100 : null}
          />
        ) : (
          <span className="muted">—</span>
        )}
        <span className="small num">
          <strong>{apiPct(b.hit_rate)}</strong> <span className="muted">· {apiPct(b.market_expected_hit_rate)}</span>
        </span>
      </span>
      <span className="hp-break-margin">
        {m !== null ? <MarginPill value={m} /> : <span className="muted">—</span>}
        {ci && <span className="small muted num">{ci}</span>}
      </span>
    </>
  );
}

/** Las selecciones acertadas de un equipo (se piden al abrirlas). */
function TeamHits({ leagueId, team }: { leagueId: number | undefined; team: string }) {
  const { t } = useTranslation();
  const { data, loading, error } = useApi(
    () => getRecommendationHistory({ league_id: leagueId, team, limit: 200 }),
    [leagueId, team],
  );
  if (loading) return <LoadingView label={t("recommendations:history.loading")} />;
  if (error) return <ErrorView message={t("common:error.api", { error })} />;
  const won = (data?.items ?? []).filter((rec) => rec.outcome === "won");
  return (
    <>
      <p className="small muted">{t("recommendations:history.hitsTitle", { team, n: won.length })}</p>
      <ul className="hp-result-list">
        {won.map((rec, i) => (
          <ResultRow key={`${rec.match_id}-${rec.market}-${rec.selection}-${i}`} rec={rec} />
        ))}
      </ul>
    </>
  );
}

const MARK = { won: "✓", lost: "✗", pending: "•" } as const;

/** Una selección ya jugada: ✓/✗, el partido con su marcador y la selección
 * con lo que le daban el modelo y el mercado. */
function ResultRow({ rec }: { rec: RecommendationHistoryItem }) {
  const { t } = useTranslation();
  return (
    <li className={`hp-result is-${rec.outcome}`}>
      <span className="hp-result-mark" role="img" aria-label={t(`common:outcome.${rec.outcome}`)}>
        {MARK[rec.outcome]}
      </span>
      <span className="hp-result-main">
        <Link to={`/matches/${rec.match_id}`} className="hp-result-match">
          <MatchTeams
            home={rec.home_team}
            away={rec.away_team}
            league={rec.league_code}
            middle={
              <span className="match-row-score">
                {rec.home_goals} - {rec.away_goals}
              </span>
            }
          />
        </Link>
        <span className="small muted">
          {joinParts(leagueName(rec.league_code), formatMatchday(rec.matchday), formatDateTime(rec.date))}
        </span>
      </span>
      <span className="hp-result-pick">
        <strong>{selectionLabel(rec.market, rec.selection, rec.home_team, rec.away_team)}</strong>
        <span className="small muted">{marketLabel(rec.market)}</span>
      </span>
      <span className="hp-result-probs small num">
        <span>
          <span className="muted">{t("recommendations:history.modelShort")}</span>
          <strong>{formatPercent(rec.prob_model)}</strong>
        </span>
        <span className="muted">
          <span>{t("recommendations:history.marketShort")}</span>
          {formatPercent(rec.prob_market_implied)}
        </span>
      </span>
    </li>
  );
}
