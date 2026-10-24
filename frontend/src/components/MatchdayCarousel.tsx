import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { getMatches } from "../api/client";
import type { Match } from "../api/types";
import { formatKickoff, formatMatchday } from "../lib/format";
import { CHAMPIONS_LEAGUE_CODE } from "../lib/leagues";
import { useApi } from "../lib/useApi";
import { ErrorView, LoadingView } from "./StatusView";
import { TeamName } from "./TeamCrest";

/** Los demas partidos de la jornada, en fila: se deslizan con el dedo o con
 * las flechas, y cada tarjeta abre ese partido. */
export function MatchdayCarousel({ match }: { match: Match }) {
  const { t } = useTranslation();
  const titleId = useId();
  const { data, loading, error } = useApi(
    () =>
      match.matchday !== null
        ? getMatches({ league_id: match.league_id, season: match.season, matchday: match.matchday, limit: 50 })
        : Promise.resolve([]),
    [match.league_id, match.season, match.matchday],
  );
  const others = (data ?? [])
    .filter((m) => m.id !== match.id && m.league_id === match.league_id && m.matchday === match.matchday)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Si la fila esta al principio o al final (para desactivar cada flecha).
  const track = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  }, []);
  // Tambien al cambiar de tamaño (giro del movil, ventana) o al llegar los partidos.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, others.length]);

  const scroll = (direction: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: reduced ? "auto" : "smooth" });
  };

  if (match.matchday === null) return null;

  return (
    <section className="detail-section matchday-carousel" id="otros-partidos" aria-labelledby={titleId}>
      <div className="section-head">
        <h2 id={titleId}>
          {match.league_code === CHAMPIONS_LEAGUE_CODE
            ? t("matches:carousel.titleRound", { round: formatMatchday(match.matchday, match.league_code) })
            : t("matches:carousel.title", { n: match.matchday })}
        </h2>
        {!(edges.start && edges.end) && (
          <div className="carousel-buttons">
            <button type="button" aria-label={t("matches:carousel.previous")} disabled={edges.start} onClick={() => scroll(-1)}>
              ←
            </button>
            <button type="button" aria-label={t("matches:carousel.next")} disabled={edges.end} onClick={() => scroll(1)}>
              →
            </button>
          </div>
        )}
      </div>

      {loading && !data && <LoadingView label={t("matches:carousel.loading")} />}
      {error && <ErrorView message={t("matches:carousel.error", { error })} />}
      {data && others.length === 0 && <p className="muted">{t("matches:carousel.empty")}</p>}

      {others.length > 0 && (
        <ul className="carousel-track" ref={track} onScroll={measure}>
          {others.map((m) => (
            <li key={m.id}>
              <CarouselCard match={m} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CarouselCard({ match }: { match: Match }) {
  const { t } = useTranslation();
  const played = match.status === "historical" && match.home_goals !== null && match.away_goals !== null;
  const winner = !played ? null : match.home_goals! > match.away_goals! ? "home" : match.home_goals! < match.away_goals! ? "away" : null;
  const row = (side: "home" | "away") => {
    const team = side === "home" ? match.home_team : match.away_team;
    const goals = side === "home" ? match.home_goals : match.away_goals;
    const className = winner === null ? "carousel-team" : winner === side ? "carousel-team carousel-winner" : "carousel-team carousel-loser";
    return (
      <span className={className}>
        <TeamName team={team} league={match.league_code} />
        {played && <span className="carousel-score">{goals}</span>}
      </span>
    );
  };

  return (
    <Link
      to={`/matches/${match.id}`}
      className="carousel-card"
      aria-label={
        played
          ? t("matches:carousel.cardPlayed", { home: match.home_team, away: match.away_team, homeGoals: match.home_goals, awayGoals: match.away_goals })
          : t("matches:carousel.cardScheduled", { home: match.home_team, away: match.away_team })
      }
    >
      <span className="carousel-date">{formatKickoff(match.date)}</span>
      {row("home")}
      {row("away")}
      <span className={`status-pill status-${match.status}`}>{played ? t("matches:status.played") : t("matches:status.scheduled")}</span>
    </Link>
  );
}
