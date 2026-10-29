import { type MouseEvent, Suspense, lazy, useState } from "react";
import { AppMark } from "../components/AppMark";
import { Trans, useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { getLeagues, getUpcomingMatches } from "../api/client";
import type { League } from "../api/types";
import type { AccordionGalleryItem } from "../components/AccordionGallery";
import { Accent } from "../components/Accent";
import { HeroPreview } from "../components/HeroPreview";
import { LeagueLogo } from "../components/LeagueLogo";
import { MatchRow } from "../components/MatchRow";
import { SiteFooter } from "../components/SiteFooter";
import { LanguageSwitch } from "../components/LanguageSwitch";
import { EmptyView, ErrorView } from "../components/StatusView";
import { ThemeSwitch } from "../components/ThemeSwitch";
import { LANDING_LEAGUES, STAT_CATEGORIES } from "../lib/landing";
import { leagueCountry, leagueName, leagueParam, useSelectedLeagueCode } from "../lib/leagues";
import { leagueLogo } from "../lib/logos";
import { MARKET_GROUPS, type MarketGroup, marketGroupLabel } from "../lib/markets";
import { withPercent } from "../lib/format";
import { useApi } from "../lib/useApi";

// La galeria trae gsap: en su propio chunk, para no cargarlo en el resto de
// la web (y para que el bundle principal no pase de 500 kB).
const AccordionGallery = lazy(() => import("../components/AccordionGallery"));

const PREVIEW_SIZE = 5;

/** /partidos con esa liga en la URL (se mantiene al recargar o abrir otra
 * pestaña). Mientras no han llegado las ligas de la API, sin ?liga=: la
 * pagina abre igualmente la liga elegida aqui. */
function matchesLink(leagues: League[] | null, code: string): string {
  const league = leagues?.find((l) => l.code === code);
  return league ? `/partidos?liga=${leagueParam(league)}` : "/partidos";
}

const galleryItems = (leagues: League[] | null): AccordionGalleryItem[] =>
  LANDING_LEAGUES.map(({ code, glow, logoStyle }) => ({
    image: leagueLogo(code) ?? undefined,
    alt: leagueName(code),
    label: [leagueName(code), leagueCountry(code)].filter(Boolean).join(" · "),
    link: matchesLink(leagues, code),
    background: `radial-gradient(circle at 50% 46%, rgba(${glow}, 0.3), transparent 58%), var(--gallery-bg)`,
    imageStyle: logoStyle,
  }));

/** Pasos de "Cómo funciona": sus textos, en landing:steps.<clave>. */
const STEPS = ["chooseMatch", "checkSample", "interpret"];

/** Portada: que es la web, para que sirve y por donde empezar. La
 * herramienta completa (con el sidebar) empieza en /partidos. */
export function LandingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // La liga de la galeria es la elegida en toda la web: la que se abra aqui
  // es la que muestra /partidos. "Todas" (null) no tiene tarjeta: LaLiga.
  const [selectedCode, setSelectedCode] = useSelectedLeagueCode();
  const [group, setGroup] = useState<MarketGroup | null>(null);
  const activeIndex = Math.max(
    0,
    LANDING_LEAGUES.findIndex((l) => l.code === selectedCode),
  );
  const activeCode = LANDING_LEAGUES[activeIndex].code;
  const leagues = useApi(() => getLeagues(), []);

  // Click en la tarjeta ya abierta: a /partidos sin recargar la pagina (al
  // recargar, la liga elegida volveria a LaLiga).
  const openCard = (event: MouseEvent<HTMLElement>, item: AccordionGalleryItem) => {
    if (!item.link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(item.link);
  };

  const stats = STAT_CATEGORIES.filter((category) => group === null || category.group === group);

  return (
    <div className="landing">
      <title>{t("landing:meta.title")}</title>
      <header className="landing-navbar">
        <div className="landing-navbar-inner">
          <Link to="/" className="app-brand" aria-label={t("landing:brandHome")}>
            <AppMark />
            <span className="app-title">Statistics 4 Bets</span>
          </Link>
          <div className="landing-navbar-actions">
            <nav aria-label={t("landing:mainNav")}>
              <Link to="/partidos" className="landing-nav-link">
                {t("nav:matches")}
              </Link>
            </nav>
            <div className="header-switches">
              <LanguageSwitch />
              <ThemeSwitch />
            </div>
            <Link to="/partidos" className="landing-nav-cta">
              {t("landing:seeMatches")}
            </Link>
          </div>
          <span className="scroll-progress" aria-hidden="true" />
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-glow" aria-hidden="true" />
          <div className="landing-hero-inner">
            <div className="landing-hero-text">
              <p className="landing-eyebrow rise">
                <span className="live-dot" aria-hidden="true" />
                {t("landing:hero.eyebrow")}
              </p>
              <h1 id="landing-title">
                <HeroTitle text={t("landing:hero.title")} />
              </h1>
              <p className="landing-lead rise" style={{ animationDelay: "0.25s" }}>
                {t("landing:hero.lead")}
              </p>
              <div className="landing-actions rise" style={{ animationDelay: "0.4s" }}>
                <Link to="/partidos" className="landing-cta">
                  {t("landing:seeMatches")}
                  <IconArrow />
                </Link>
                <a href="#como-leer" className="landing-cta-secondary">
                  {t("landing:hero.howToRead")}
                </a>
              </div>
            </div>
            <div className="landing-hero-visual rise" style={{ animationDelay: "0.3s" }}>
              <PitchLines />
              <div className="landing-hero-card">
                <HeroPreview />
              </div>
            </div>
          </div>
        </section>

        <section className="landing-marquee" aria-label={t("landing:leagues.galleryLabel")}>
          <div className="landing-marquee-track">
            {[0, 1].map((copy) => (
              <ul key={copy} className="landing-marquee-list" aria-hidden={copy === 1}>
                {LANDING_LEAGUES.map((l) => (
                  <li key={l.code}>
                    <LeagueLogo code={l.code} />
                    <span>{leagueName(l.code)}</span>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </section>

        <section className="landing-section reveal" aria-labelledby="ligas-title">
          <div className="landing-section-head">
            <div>
              <span className="landing-section-num">01</span>
              <h2 id="ligas-title" className="mask">
                <Accent text={t("landing:leagues.title")} />
              </h2>
            </div>
            <p>{t("landing:leagues.subtitle")}</p>
          </div>
          <Suspense fallback={<div className="landing-gallery-placeholder" aria-hidden="true" />}>
            <AccordionGallery
              className="landing-gallery"
              ariaLabel={t("landing:leagues.galleryLabel")}
              items={galleryItems(leagues.data)}
              defaultIndex={activeIndex}
              onActiveChange={(index) => setSelectedCode(LANDING_LEAGUES[index].code)}
              onLinkClick={openCard}
              trigger="click"
              fit="contain"
              expandRatio={0.52}
              height={380}
              gap={10}
              radius={22}
              accentColor="var(--green-fill)"
              overlayColor="var(--gallery-bg)"
              textColor="var(--gallery-ink)"
              // Sin gris: el logo de Hypermotion es el de LaLiga en otro color,
              // y en gris las dos tarjetas cerradas serian iguales.
              grayscale={false}
              showLabels
              duration={0.7}
              ease="power3.out"
              parallax={0.2}
              tilt={6}
              stagger={0.06}
              orientation="horizontal"
            />
          </Suspense>
          <UpcomingPreview code={activeCode} leagues={leagues} />
        </section>

        <section className="landing-section reveal" aria-labelledby="analizar-title">
          <div className="landing-section-head">
            <div>
              <span className="landing-section-num">02</span>
              <h2 id="analizar-title" className="mask">
                <Accent text={t("landing:stats.title")} />
              </h2>
            </div>
            <p>{t("landing:stats.subtitle")}</p>
          </div>
          <div className="pill-group landing-stats-filter" role="group" aria-label={t("landing:stats.title")}>
            {[null, ...MARKET_GROUPS].map((value) => (
              <button
                key={value ?? "all"}
                type="button"
                className={group === value ? "pill-button is-active" : "pill-button"}
                aria-pressed={group === value}
                onClick={() => setGroup(value)}
              >
                {value === null ? t("common:league.all") : marketGroupLabel(value)}
              </button>
            ))}
          </div>
          <ul className="landing-stats" key={group ?? "all"}>
            {stats.map((category, i) => (
              <li
                key={category.to}
                className={group === null && (i === 0 || i === 5) ? "stag is-featured" : "stag"}
                style={{ animationRange: `entry ${(i % 4) * 8}% entry ${45 + (i % 4) * 8}%` }}
              >
                <Link to={category.to} className="landing-stat">
                  <span className="landing-stat-top">
                    <span className="landing-stat-group">{marketGroupLabel(category.group)}</span>
                    <span className="landing-stat-arrow" aria-hidden="true">
                      <IconArrowUpRight />
                    </span>
                  </span>
                  <span className="landing-stat-name">{category.label}</span>
                  <span className="landing-stat-blurb">{category.blurb}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="landing-section reveal" aria-labelledby="funciona-title">
          <div className="landing-section-head">
            <div>
              <span className="landing-section-num">03</span>
              <h2 id="funciona-title" className="mask">
                <Accent text={t("landing:steps.title")} />
              </h2>
            </div>
          </div>
          <div className="landing-timeline">
            <div className="landing-timeline-line" aria-hidden="true">
              <span className="line-fill" />
            </div>
            <ol className="landing-steps">
              {STEPS.map((step, i) => (
                <li
                  key={step}
                  className="landing-step slide"
                  style={{ animationRange: `entry ${10 + i * 15}% entry ${60 + i * 15}%` }}
                >
                  <span className={i === STEPS.length - 1 ? "landing-step-num is-last" : "landing-step-num"} aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3>{t(`landing:steps.${step}.title`)}</h3>
                  <p>{t(`landing:steps.${step}.text`)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="como-leer" className="landing-trust reveal" aria-labelledby="leer-title">
          <div className="landing-trust-text">
            <span className="landing-section-num">04</span>
            <h2 id="leer-title" className="mask">
              <Accent text={t("landing:trust.title")} />
            </h2>
            <p>
              <Trans i18nKey="landing:trust.text" components={{ bold: <strong /> }} />
            </p>
            <Link to="/glosario" className="landing-trust-link">
              {t("landing:trust.link")}
            </Link>
          </div>
          <div className="landing-trust-visual">
            <SampleCard hits={3} total={3} faded />
            <SampleCard hits={13} total={16} />
            <p className="landing-trust-claim">{t("legal:claim")}</p>
          </div>
        </section>

        <section className="landing-final" aria-labelledby="final-title">
          <div className="landing-final-inner zoom">
            <svg className="landing-final-ring" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
              <circle cx="100" cy="100" r="90" className="is-hit" />
              <circle cx="100" cy="100" r="90" className="is-miss" />
            </svg>
            <h2 id="final-title">
              <Accent text={t("landing:final.title")} words={2} />
            </h2>
            <Link to="/partidos" className="landing-cta landing-cta-inverse">
              {t("landing:seeMatches")}
              <IconArrow />
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

/** Titular de la portada en tres lineas que entran una tras otra, como en el
 * diseño: el principio partido en dos lineas equilibradas y las dos ultimas
 * palabras en serif cursiva ("Estadísticas de fútbol / para entender /
 * *cada partido*"). Funciona en cualquier idioma sin tocar los textos. */
function HeroTitle({ text }: { text: string }) {
  const words = text.trim().split(/\s+/);
  const accent = words.slice(-2).join(" ");
  const head = words.slice(0, -2);
  // Corte con la primera linea igual o mas larga que la segunda y lo mas
  // parecidas posible ("Estadísticas de fútbol / para entender").
  let cut = Math.max(1, head.length - 1);
  let best = Infinity;
  for (let i = 1; i < head.length; i++) {
    const first = head.slice(0, i).join(" ").length;
    const second = head.slice(i).join(" ").length;
    if (first >= second && first - second < best) {
      best = first - second;
      cut = i;
    }
  }
  const lines = head.length > 1 ? [head.slice(0, cut).join(" "), head.slice(cut).join(" ")] : [head.join(" ")];
  return (
    <>
      {lines.map((line, i) => (
        <span key={i} className="hero-line rise" style={{ animationDelay: `${0.1 + i * 0.12}s` }}>
          {line}{" "}
        </span>
      ))}
      <span className="hero-line rise" style={{ animationDelay: `${0.1 + lines.length * 0.12}s` }}>
        <em className="serif-accent">{accent}</em>
      </span>
    </>
  );
}

/** Ilustracion de "Cómo leer los porcentajes": el mismo tipo de dato con
 * muestras de distinto tamaño, un cuadrito por partido. */
function SampleCard({ hits, total, faded = false }: { hits: number; total: number; faded?: boolean }) {
  const pct = Math.round((hits / total) * 100);
  // Fallos repartidos (no todos al final), como en una racha real.
  const misses = new Set(Array.from({ length: total - hits }, (_, i) => Math.round(((i + 1) * total) / (total - hits + 1)) - 1));
  return (
    <div className={faded ? "sample-card is-faded" : "sample-card"} aria-hidden="true">
      <span className="sample-card-head">
        <span className="num">
          {hits}/{total}
        </span>
        <strong>{withPercent(String(pct))}</strong>
      </span>
      <span className="sample-card-cells">
        {Array.from({ length: 16 }, (_, i) =>
          i < total ? <span key={i} className={misses.has(i) ? "reveal is-miss" : "reveal is-hit"} /> : <span key={i} />,
        )}
      </span>
    </div>
  );
}

function IconArrow() {
  return (
    <svg className="icon-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function IconArrowUpRight() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17L17 7M8 7h9v9" />
    </svg>
  );
}

/** Proximos partidos de la liga abierta en la galeria, con la misma fila que
 * /partidos. Mientras carga la nueva liga se queda la lista anterior
 * atenuada, y el hueco mide siempre al menos lo que la lista completa. */
function UpcomingPreview({
  code,
  leagues,
}: {
  code: string;
  leagues: { data: League[] | null; error: string | null };
}) {
  const { t } = useTranslation();
  const league = leagues.data?.find((l) => l.code === code);
  const upcoming = useApi(
    () =>
      league
        ? getUpcomingMatches({ league_id: league.id, limit: PREVIEW_SIZE }).then((matches) => ({
            code: league.code,
            matches: [...matches].sort((a, b) => a.date.localeCompare(b.date)),
          }))
        : Promise.resolve(null),
    [league?.id],
  );

  const name = leagueName(code);
  const error = leagues.error ?? upcoming.error;
  const shown = upcoming.data;
  const current = shown?.code === code && !upcoming.loading;
  const missingLeague = leagues.data !== null && !league;
  const loading = !error && !missingLeague && !shown;

  return (
    <div className="landing-preview" aria-live="polite" aria-busy={!current && !error && !missingLeague}>
      <h3 className="landing-preview-title">{t("landing:preview.title", { league: name })}</h3>

      <div className="landing-preview-body">
        <PreviewSkeleton visible={loading} />
        {loading && <span className="visually-hidden">{t("common:loading.matches")}</span>}
        {error ? (
          <ErrorView message={t("common:error.api", { error })} />
        ) : missingLeague ? (
          <EmptyView message={t("landing:preview.noData", { league: name })} />
        ) : shown && current && shown.matches.length === 0 ? (
          <EmptyView message={t("landing:preview.noUpcoming", { league: name })} />
        ) : shown && shown.matches.length > 0 ? (
          <div key={shown.code} className={current ? "match-list landing-preview-list" : "match-list landing-preview-list is-stale"}>
            {shown.matches.map((match) => (
              <MatchRow key={match.id} match={match} />
            ))}
          </div>
        ) : null}
      </div>

      <Link to={matchesLink(leagues.data, code)} className="landing-more">
        {t("landing:preview.more")}
      </Link>
    </div>
  );
}

/** Filas vacias con la forma de MatchRow: ocupan el hueco mientras carga y,
 * ocultas, fijan su altura para que la pagina no salte al cambiar de liga. */
function PreviewSkeleton({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={visible ? "match-list landing-skeleton is-visible" : "match-list landing-skeleton"} aria-hidden="true">
      {Array.from({ length: PREVIEW_SIZE }, (_, i) => (
        <div key={i} className="match-row match-row-skeleton">
          <span className="match-row-when">
            <span className="match-row-date">00/00 00:00</span>
            <span className="match-row-league">{t("landing:skeleton.league")}</span>
          </span>
          <span className="match-teams match-row-teams">
            <span className="team-name team-name-lg team-name-reverse">
              <span className="team-crest team-crest-lg" />
              <span className="team-name-text">{t("landing:skeleton.home")}</span>
            </span>
            <span className="match-teams-middle">
              <span className="match-row-score match-row-vs">vs</span>
            </span>
            <span className="team-name team-name-lg">
              <span className="team-crest team-crest-lg" />
              <span className="team-name-text">{t("landing:skeleton.away")}</span>
            </span>
          </span>
          <span className="status-pill">{t("matches:status.scheduled")}</span>
        </div>
      ))}
    </div>
  );
}

/** Lineas de un campo (medio campo y circulo central), solo decorativas. */
function PitchLines() {
  return (
    <svg className="landing-pitch" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      <line x1="200" y1="0" x2="200" y2="400" pathLength={1} />
      <circle cx="200" cy="200" r="120" pathLength={1} />
      <circle cx="200" cy="200" r="4" className="landing-pitch-spot" />
    </svg>
  );
}
