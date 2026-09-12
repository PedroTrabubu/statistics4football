import { Link, useParams } from "react-router-dom";
import { getMatch, getMatchPredictions, getMatchStats } from "../api/client";
import { PredictionsTable } from "../components/PredictionsTable";
import { ErrorView, LoadingView } from "../components/StatusView";
import { StatsPanel } from "../components/StatsPanel";
import { formatDateTime } from "../lib/format";
import { useApi } from "../lib/useApi";

export function MatchDetailPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const id = Number(matchId);

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

  if (loadingMatch) return <LoadingView label="Cargando partido..." />;
  if (matchError || !match) return <ErrorView message={`No se pudo cargar el partido: ${matchError}`} />;

  const played = match.status === "historical";

  return (
    <div>
      <Link to="/" className="back-link">
        ← Volver a partidos
      </Link>

      <h1>
        {match.home_team} {played ? `${match.home_goals} - ${match.away_goals}` : "vs"}{" "}
        {match.away_team}
      </h1>
      <p className="muted">
        {match.league_code} · Temporada {match.season} · {formatDateTime(match.date)}
      </p>

      <section className="detail-section">
        {loadingStats && <LoadingView label="Calculando estadísticas..." />}
        {statsError && <ErrorView message={`No se pudieron calcular las estadísticas: ${statsError}`} />}
        {stats && <StatsPanel features={stats} homeTeam={match.home_team} awayTeam={match.away_team} />}
      </section>

      <section className="detail-section">
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
    </div>
  );
}
