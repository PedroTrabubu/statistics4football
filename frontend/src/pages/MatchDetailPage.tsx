import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { getMatch, getMatchHistory, getMatchPredictions, getMatchStats, getTeamSeasonStatsOrNull } from "../api/client";
import { MatchdayCarousel } from "../components/MatchdayCarousel";
import { PredictionsTable } from "../components/PredictionsTable";
import { ProbablePicks } from "../components/ProbablePicks";
import { RefereePanel } from "../components/RefereePanel";
import { SeasonStatsSummary } from "../components/SeasonStatsSummary";
import { SectionNav } from "../components/SectionNav";
import { ErrorView, LoadingView } from "../components/StatusView";
import { StatsPanel } from "../components/StatsPanel";
import { TeamCrest } from "../components/TeamCrest";
import { formatDateTime, formatMatchday, formatSeason, joinParts } from "../lib/format";
import { leagueName, useSelectedLeagueCode } from "../lib/leagues";
import { useApi } from "../lib/useApi";

/** Accesos directos bajo la cabecera, a cada bloque de la ficha. `short`: en
 * movil, para que quepan en dos filas. */
const SECTIONS = [
  { id: "forma", label: "Forma reciente", short: "Forma" },
  { id: "arbitro", label: "Árbitro", short: "Árbitro" },
  { id: "picks", label: "Picks muy probables", short: "Picks" },
  { id: "probabilidades", label: "Probabilidades y valor esperado", short: "Probabilidades y EV" },
  { id: "otros-partidos", label: "Otros partidos", short: "Otros partidos" },
];

export function MatchDetailPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const [, setLeagueCode] = useSelectedLeagueCode();
  const id = Number(matchId);

  // Al abrir otro partido (por ejemplo, desde el carrusel del final), arriba.
  useEffect(() => {
    if (window.location.hash) return;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [id]);

  const { data: match, loading: loadingMatch, error: matchError } = useApi(() => getMatch(id), [id]);
  const { data: stats, loading: loadingStats, error: statsError } = useApi(
    () => getMatchStats(id),
    [id],
  );
  const {
    data: predictions,
    loading: loadingPredictions,
    error: predictionsError,
  } = useApi(() => getMatchPredictions(id), [id]);
  // Partidos de la liga anteriores a este: patrones de los equipos y lo
  // habitual en la liga (picks muy probables y hechos del arbitro).
  const history = useApi(() => getMatchHistory(id), [id]);
  const { data: seasonStats, loading: loadingSeasonStats } = useApi(
    () =>
      match
        ? Promise.all([
            getTeamSeasonStatsOrNull(match.home_team_id),
            getTeamSeasonStatsOrNull(match.away_team_id),
          ])
        : Promise.resolve(null),
    [match?.home_team_id, match?.away_team_id],
  );

  if (loadingMatch) return <LoadingView label="Cargando partido..." />;
  if (matchError || !match) return <ErrorView message={`No se pudo cargar el partido: ${matchError}`} />;

  const played = match.status === "historical";

  return (
    <div>
      <Link to="/partidos" className="back-link">
        ← Volver a partidos
      </Link>

      <p className="muted match-meta">
        {joinParts(
          leagueName(match.league_code),
          `Temporada ${formatSeason(match.season)}`,
          formatMatchday(match.matchday),
          formatDateTime(match.date),
        )}
      </p>

      {/* Los escudos son los protagonistas de la cabecera. */}
      <h1 className="match-hero">
        <span className="match-hero-team">
          <TeamCrest team={match.home_team} league={match.league_code} size="xl" eager />
          <span className="match-hero-name">{match.home_team}</span>
        </span>{" "}
        <span className={played ? "match-hero-score" : "match-hero-score match-hero-vs"}>
          {played ? `${match.home_goals} - ${match.away_goals}` : "vs"}
        </span>{" "}
        <span className="match-hero-team">
          <TeamCrest team={match.away_team} league={match.league_code} size="xl" eager />
          <span className="match-hero-name">{match.away_team}</span>
        </span>
      </h1>

      <SectionNav
        label="Secciones del partido"
        sections={SECTIONS.filter((s) => s.id !== "otros-partidos" || match.matchday !== null)}
      />

      <section className="detail-section" id="forma">
        {loadingStats && <LoadingView label="Calculando estadísticas..." />}
        {statsError && <ErrorView message={`No se pudieron calcular las estadísticas: ${statsError}`} />}
        {stats && (
          <StatsPanel
            features={stats}
            homeTeam={match.home_team}
            awayTeam={match.away_team}
            league={match.league_code}
          />
        )}
      </section>

      <section className="detail-section">
        <h2>Estadísticas de temporada</h2>
        {loadingSeasonStats && <LoadingView label="Cargando estadísticas de temporada..." />}
        {seasonStats && (
          <SeasonStatsSummary
            homeStats={seasonStats[0]}
            awayStats={seasonStats[1]}
            homeTeam={match.home_team}
            awayTeam={match.away_team}
            leagueId={match.league_id}
            league={match.league_code}
          />
        )}
      </section>

      <section className="detail-section" id="arbitro">
        <h2>
          Árbitro
          {match.referee && (
            <>
              :{" "}
              <Link
                to={`/arbitros?arbitro=${encodeURIComponent(match.referee)}`}
                onClick={() => setLeagueCode(match.league_code)}
                title="Ver sus estadísticas en Árbitros"
              >
                {match.referee}
              </Link>
            </>
          )}
        </h2>
        <RefereePanel match={match} history={history.data?.matches} />
      </section>

      {/* Justo antes del modelo: primero lo que se ha repetido, despues lo que
          estima el modelo para 1X2, más/menos 2.5 y ambos marcan. */}
      <section className="detail-section" id="picks">
        <h2>Picks muy probables</h2>
        <ProbablePicks match={match} history={history.data} loading={history.loading} error={history.error} />
      </section>

      <section className="detail-section" id="probabilidades">
        <h2>Probabilidades y valor esperado (EV)</h2>
        <p className="muted">
          El EV nunca se muestra solo: siempre va acompañado de un nivel de confianza y de riesgo.
        </p>
        {loadingPredictions && <LoadingView label="Generando predicciones..." />}
        {predictionsError && (
          <ErrorView message={`No se pudieron generar las predicciones: ${predictionsError}`} />
        )}
        {predictions && (
          <PredictionsTable
            predictions={predictions}
            homeTeam={match.home_team}
            awayTeam={match.away_team}
          />
        )}
      </section>

      <MatchdayCarousel key={match.id} match={match} />
    </div>
  );
}
