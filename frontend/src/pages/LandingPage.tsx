import { type MouseEvent, Suspense, lazy } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getLeagues, getMatches } from "../api/client";
import type { League } from "../api/types";
import type { AccordionGalleryItem } from "../components/AccordionGallery";
import { MatchRow } from "../components/MatchRow";
import { SiteFooter } from "../components/SiteFooter";
import { EmptyView, ErrorView } from "../components/StatusView";
import { LANDING_LEAGUES, STAT_CATEGORIES } from "../lib/landing";
import { leagueCountry, leagueName, leagueParam, useSelectedLeagueCode } from "../lib/leagues";
import { leagueLogo } from "../lib/logos";
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
    background: `radial-gradient(circle at 50% 46%, rgba(${glow}, 0.3), transparent 58%), linear-gradient(160deg, var(--sidebar-bg-alt), var(--sidebar-bg))`,
    imageStyle: logoStyle,
  }));

const STEPS = [
  {
    title: "Elige liga y partido",
    text: "Empieza por la jornada de tu liga y abre el partido que quieras mirar.",
  },
  {
    title: "Mira la estadística y su muestra",
    text: "Cada porcentaje va junto al número de partidos en que se basa, en total, como local y como visitante.",
  },
  {
    title: "Interprétala con cuidado",
    text: "Es lo que pasó antes, no lo que va a pasar. Con pocos partidos, un porcentaje alto dice poco.",
  },
];

/** Portada: que es la web, para que sirve y por donde empezar. La
 * herramienta completa (con el sidebar) empieza en /partidos. */
export function LandingPage() {
  const navigate = useNavigate();
  // La liga de la galeria es la elegida en toda la web: la que se abra aqui
  // es la que muestra /partidos. "Todas" (null) no tiene tarjeta: LaLiga.
  const [selectedCode, setSelectedCode] = useSelectedLeagueCode();
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

  return (
    <div className="landing">
      <header className="app-navbar landing-navbar">
        <div className="landing-navbar-inner">
          <Link to="/" className="app-brand" aria-label="Statistics 4 Bets, portada">
            <span className="app-mark">S4B</span>
            <span className="app-title">Statistics 4 Bets</span>
          </Link>
          <nav aria-label="Principal">
            <Link to="/partidos" className="landing-nav-link">
              Partidos
            </Link>
          </nav>
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <PitchLines />
          <p className="landing-eyebrow">Análisis estadístico de fútbol</p>
          <h1 id="landing-title">Estadísticas de fútbol para entender cada partido</h1>
          <p className="landing-lead">
            Goles, córners, tarjetas, tiros, faltas y árbitros por equipo y liga, con la frecuencia histórica detrás de
            cada porcentaje.
          </p>
          <div className="landing-actions">
            <Link to="/partidos" className="landing-cta">
              Ver partidos
            </Link>
            <a href="#como-leer" className="landing-cta-secondary">
              Cómo leer las estadísticas
            </a>
          </div>
          <p className="landing-leagues-line">{LANDING_LEAGUES.map((l) => leagueName(l.code)).join(" · ")}</p>
        </section>

        <section className="landing-section" aria-labelledby="ligas-title">
          <div className="landing-section-head">
            <h2 id="ligas-title">Elige una liga</h2>
            <p>Pulsa una tarjeta para ver sus próximos partidos.</p>
          </div>
          <Suspense fallback={<div className="landing-gallery-placeholder" aria-hidden="true" />}>
            <AccordionGallery
              className="landing-gallery"
              ariaLabel="Ligas"
              items={galleryItems(leagues.data)}
              defaultIndex={activeIndex}
              onActiveChange={(index) => setSelectedCode(LANDING_LEAGUES[index].code)}
              onLinkClick={openCard}
              trigger="click"
              fit="contain"
              expandRatio={0.52}
              height={360}
              gap={10}
              radius={16}
              accentColor="#c9a227"
              overlayColor="#0f1e17"
              textColor="#eef3ee"
              // Sin gris: el logo de Hypermotion es el de LaLiga en otro color,
              // y en gris las dos tarjetas cerradas serian iguales.
              grayscale={false}
              showLabels
              duration={0.6}
              ease="power3.out"
              parallax={0.2}
              tilt={6}
              stagger={0.06}
              orientation="horizontal"
            />
          </Suspense>
          <UpcomingPreview code={activeCode} leagues={leagues} />
        </section>

        <section className="landing-section" aria-labelledby="analizar-title">
          <div className="landing-section-head">
            <h2 id="analizar-title">Qué puedes analizar</h2>
            <p>Cada estadística tiene su página, con el porcentaje de cada equipo y los partidos en que se basa.</p>
          </div>
          <ul className="landing-stats">
            {STAT_CATEGORIES.map((category) => (
              <li key={category.to}>
                <Link to={category.to} className="landing-stat">
                  <span className="landing-stat-group">{category.group}</span>
                  <span className="landing-stat-name">{category.label}</span>
                  <span className="landing-stat-blurb">{category.blurb}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="landing-section" aria-labelledby="funciona-title">
          <div className="landing-section-head">
            <h2 id="funciona-title">Cómo funciona</h2>
          </div>
          <ol className="landing-steps">
            {STEPS.map((step, i) => (
              <li key={step.title} className="landing-step">
                <span className="landing-step-num" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="como-leer" className="landing-trust" aria-labelledby="leer-title">
          <div className="landing-trust-text">
            <h2 id="leer-title">Cómo leer los porcentajes</h2>
            <p>
              Los porcentajes de Statistics 4 Bets son <strong>frecuencia histórica</strong>, no una promesa de lo que
              va a pasar: cuentan cuántas veces ocurrió algo antes y deben leerse junto al número de partidos usado. Un
              porcentaje alto sobre pocos partidos dice mucho menos que el mismo porcentaje sobre muchos.
            </p>
            <Link to="/glosario" className="landing-trust-link">
              Más sobre cómo leerlos →
            </Link>
          </div>
          <p className="landing-trust-claim">Análisis estadístico de fútbol. No es una casa de apuestas.</p>
        </section>

        <section className="landing-final" aria-labelledby="final-title">
          <h2 id="final-title">Empieza por la próxima jornada</h2>
          <Link to="/partidos" className="landing-cta">
            Ver partidos
          </Link>
        </section>
      </main>

      <SiteFooter />
    </div>
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
  const league = leagues.data?.find((l) => l.code === code);
  const upcoming = useApi(
    () =>
      league
        ? getMatches({ league_id: league.id, status: "scheduled", limit: PREVIEW_SIZE }).then((matches) => ({
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
      <h3 className="landing-preview-title">Próximos partidos · {name}</h3>

      <div className="landing-preview-body">
        <PreviewSkeleton visible={loading} />
        {loading && <span className="visually-hidden">Cargando partidos...</span>}
        {error ? (
          <ErrorView message={`No se pudo conectar con la API: ${error}`} />
        ) : missingLeague ? (
          <EmptyView message={`Todavía no hay datos de ${name}.`} />
        ) : shown && current && shown.matches.length === 0 ? (
          <EmptyView message={`No hay próximos partidos de ${name} cargados todavía.`} />
        ) : shown && shown.matches.length > 0 ? (
          <div key={shown.code} className={current ? "match-list landing-preview-list" : "match-list landing-preview-list is-stale"}>
            {shown.matches.map((match) => (
              <MatchRow key={match.id} match={match} />
            ))}
          </div>
        ) : null}
      </div>

      <Link to={matchesLink(leagues.data, code)} className="landing-more">
        Ver todos los partidos →
      </Link>
    </div>
  );
}

/** Filas vacias con la forma de MatchRow: ocupan el hueco mientras carga y,
 * ocultas, fijan su altura para que la pagina no salte al cambiar de liga. */
function PreviewSkeleton({ visible }: { visible: boolean }) {
  return (
    <div className={visible ? "match-list landing-skeleton is-visible" : "match-list landing-skeleton"} aria-hidden="true">
      {Array.from({ length: PREVIEW_SIZE }, (_, i) => (
        <div key={i} className="match-row match-row-skeleton">
          <span className="match-row-when">
            <span className="match-row-date">00/00 00:00</span>
            <span className="match-row-league">Liga</span>
          </span>
          <span className="match-teams match-row-teams">
            <span className="team-name team-name-lg team-name-reverse">
              <span className="team-crest team-crest-lg" />
              <span className="team-name-text">Equipo local</span>
            </span>
            <span className="match-teams-middle">
              <span className="match-row-score match-row-vs">vs</span>
            </span>
            <span className="team-name team-name-lg">
              <span className="team-crest team-crest-lg" />
              <span className="team-name-text">Equipo visitante</span>
            </span>
          </span>
          <span className="status-pill">Programado</span>
        </div>
      ))}
    </div>
  );
}

/** Lineas de un campo (medio campo y circulo central), solo decorativas. */
function PitchLines() {
  return (
    <svg className="landing-pitch" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      <circle cx="200" cy="200" r="120" />
      <circle cx="200" cy="200" r="4" className="landing-pitch-spot" />
      <line x1="200" y1="0" x2="200" y2="400" />
    </svg>
  );
}
