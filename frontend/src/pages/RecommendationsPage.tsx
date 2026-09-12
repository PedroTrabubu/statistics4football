import { useState } from "react";
import { Link } from "react-router-dom";
import { getLeagues, getRecommendations } from "../api/client";
import type { RiskLevel } from "../api/types";
import { RiskBadge } from "../components/RiskBadge";
import { EmptyView, ErrorView, LoadingView } from "../components/StatusView";
import { formatDateTime, formatEv, formatPercent, marketLabel, selectionLabel } from "../lib/format";
import { useApi } from "../lib/useApi";

export function RecommendationsPage() {
  const [leagueId, setLeagueId] = useState<number | undefined>(undefined);
  const [riskLevel, setRiskLevel] = useState<RiskLevel | undefined>(undefined);
  const [minEv, setMinEv] = useState<number>(0.05);

  const { data: leagues } = useApi(() => getLeagues(), []);
  const {
    data: recommendations,
    loading,
    error,
  } = useApi(
    () => getRecommendations({ league_id: leagueId, risk_level: riskLevel, min_ev: minEv, limit: 50 }),
    [leagueId, riskLevel, minEv],
  );

  return (
    <div>
      <h1>Recomendaciones</h1>
      <p className="muted">
        Selecciones con EV por encima del umbral configurado. Esto es una herramienta de análisis,
        no una promesa de ganancia — fíjate siempre en la confianza y el riesgo, no solo en el EV.
      </p>

      <div className="filters">
        <select
          value={leagueId ?? ""}
          onChange={(e) => setLeagueId(e.target.value ? Number(e.target.value) : undefined)}
        >
          <option value="">Todas las ligas</option>
          {leagues?.map((league) => (
            <option key={league.id} value={league.id}>
              {league.name}
            </option>
          ))}
        </select>

        <select
          value={riskLevel ?? ""}
          onChange={(e) => setRiskLevel((e.target.value || undefined) as RiskLevel | undefined)}
        >
          <option value="">Cualquier riesgo</option>
          <option value="low">Riesgo bajo</option>
          <option value="medium">Riesgo medio</option>
          <option value="high">Riesgo alto</option>
        </select>

        <label className="filter-inline">
          EV mínimo
          <input
            type="number"
            step={0.01}
            min={0}
            value={minEv}
            onChange={(e) => setMinEv(Number(e.target.value))}
          />
        </label>
      </div>

      {loading && <LoadingView label="Cargando recomendaciones..." />}
      {error && <ErrorView message={`No se pudo conectar con la API: ${error}`} />}
      {!loading && !error && recommendations?.length === 0 && (
        <EmptyView message="No hay recomendaciones con estos filtros." />
      )}

      {!loading && !error && recommendations && recommendations.length > 0 && (
        <table className="predictions-table recommendations-table">
          <thead>
            <tr>
              <th>Partido</th>
              <th>Mercado</th>
              <th>Selección</th>
              <th>Prob. mercado</th>
              <th>Prob. modelo</th>
              <th>EV</th>
              <th>Confianza</th>
              <th>Riesgo</th>
            </tr>
          </thead>
          <tbody>
            {recommendations.map((rec, i) => (
              <tr key={`${rec.match_id}-${rec.market}-${rec.selection}-${i}`}>
                <td>
                  <Link to={`/matches/${rec.match_id}`}>
                    {rec.home_team} vs {rec.away_team}
                  </Link>
                  <div className="muted small">
                    {rec.league_code} · {formatDateTime(rec.date)}
                  </div>
                </td>
                <td>{marketLabel(rec.market)}</td>
                <td>{selectionLabel(rec.market, rec.selection, rec.home_team, rec.away_team)}</td>
                <td>{formatPercent(rec.prob_market_implied)}</td>
                <td>{formatPercent(rec.prob_model)}</td>
                <td className="ev-positive">{formatEv(rec.ev)}</td>
                <td>{formatPercent(rec.confidence, 0)}</td>
                <td>
                  <RiskBadge level={rec.risk_level} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
