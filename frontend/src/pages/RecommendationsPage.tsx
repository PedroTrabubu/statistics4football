import { useState } from "react";
import { Link } from "react-router-dom";
import { getLeagues, getRecommendationHistory, getRecommendations } from "../api/client";
import type { RiskLevel } from "../api/types";
import { EvValue } from "../components/EvValue";
import { OutcomeBadge } from "../components/OutcomeBadge";
import { RiskBadge } from "../components/RiskBadge";
import { SampleBadge } from "../components/SampleBadge";
import { EmptyView, ErrorView, LoadingView } from "../components/StatusView";
import { formatDateTime, formatPercent, formatPnl, formatRoiPct, marketLabel, selectionLabel } from "../lib/format";
import { useApi } from "../lib/useApi";

type Tab = "upcoming" | "history";

function roiClass(value: number | null): string {
  if (value === null) return "";
  return value >= 0 ? "ev-positive" : "ev-negative";
}

export function RecommendationsPage() {
  const [tab, setTab] = useState<Tab>("upcoming");
  const [leagueId, setLeagueId] = useState<number | undefined>(undefined);
  const { data: leagues } = useApi(() => getLeagues(), []);

  return (
    <div>
      <h1>Recomendaciones</h1>
      <p className="muted">
        Esto es una herramienta de análisis, no una promesa de ganancia — fíjate siempre en la muestra y el
        riesgo, no solo en el EV.
      </p>

      <div className="tab-group tab-group-spaced">
        <button
          className={tab === "upcoming" ? "tab-button tab-button-active" : "tab-button"}
          onClick={() => setTab("upcoming")}
        >
          Próximas
        </button>
        <button
          className={tab === "history" ? "tab-button tab-button-active" : "tab-button"}
          onClick={() => setTab("history")}
        >
          Histórico
        </button>
      </div>

      {tab === "upcoming" ? (
        <UpcomingRecommendations leagueId={leagueId} setLeagueId={setLeagueId} leagues={leagues} />
      ) : (
        <RecommendationHistory leagueId={leagueId} setLeagueId={setLeagueId} leagues={leagues} />
      )}
    </div>
  );
}

interface LeagueFilterProps {
  leagueId: number | undefined;
  setLeagueId: (id: number | undefined) => void;
  leagues: { id: number; name: string }[] | null;
}

function UpcomingRecommendations({ leagueId, setLeagueId, leagues }: LeagueFilterProps) {
  const [riskLevel, setRiskLevel] = useState<RiskLevel | undefined>(undefined);
  const [minEv, setMinEv] = useState<number>(0.05);

  const {
    data: recommendations,
    loading,
    error,
  } = useApi(
    () => getRecommendations({ league_id: leagueId, risk_level: riskLevel, min_ev: minEv, limit: 50 }),
    [leagueId, riskLevel, minEv],
  );

  return (
    <>
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
        <EmptyView message="Todavía no hay recomendaciones para partidos por jugar: calcular el EV requiere una cuota real de mercado, y hoy no tenemos ninguna fuente de cuotas para partidos futuros (solo para los ya jugados). Mientras tanto, usa 'Tu cuota' en la ficha de cada partido para comparar tu propia cuota contra el modelo." />
      )}

      {!loading && !error && recommendations && recommendations.length > 0 && (
        <div className="table-scroll">
          <table className="predictions-table recommendations-table">
            <thead>
              <tr>
                <th>Partido</th>
                <th>Mercado</th>
                <th>Selección</th>
                <th>Prob. mercado</th>
                <th>Prob. modelo</th>
                <th>EV</th>
                <th>Muestra</th>
                <th>Riesgo</th>
              </tr>
            </thead>
            <tbody>
              {recommendations.map((rec, i) => (
                <tr key={`${rec.match_id}-${rec.market}-${rec.selection}-${i}`}>
                  <td className="rec-match">
                    <Link to={`/matches/${rec.match_id}`}>
                      {rec.home_team} vs {rec.away_team}
                    </Link>
                    <div className="muted small">
                      {rec.league_code} · {formatDateTime(rec.date)}
                    </div>
                  </td>
                  <td className="rec-match">{marketLabel(rec.market)}</td>
                  <td className="rec-match">
                    {selectionLabel(rec.market, rec.selection, rec.home_team, rec.away_team)}
                  </td>
                  <td>{formatPercent(rec.prob_market_implied)}</td>
                  <td>{formatPercent(rec.prob_model)}</td>
                  <td>
                    <EvValue ev={rec.ev} />
                  </td>
                  <td>
                    <SampleBadge matchesUsed={rec.matches_used} />
                  </td>
                  <td>
                    <RiskBadge level={rec.risk_level} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function RecommendationHistory({ leagueId, setLeagueId, leagues }: LeagueFilterProps) {
  const {
    data,
    loading,
    error,
  } = useApi(() => getRecommendationHistory({ league_id: leagueId, limit: 100 }), [leagueId]);

  return (
    <>
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
      </div>

      {loading && <LoadingView label="Cargando histórico..." />}
      {error && <ErrorView message={`No se pudo conectar con la API: ${error}`} />}

      {!loading && !error && data && data.summary.total === 0 && (
        <EmptyView message="Todavía no hay recomendaciones resueltas sobre partidos ya jugados para este filtro." />
      )}

      {!loading && !error && data && data.summary.total > 0 && (
        <>
          <div className="stat-tiles">
            <div className="stat-tile">
              <span className={`stat-tile-value ${roiClass(data.summary.roi)}`}>{formatRoiPct(data.summary.roi)}</span>
              <span className="stat-tile-label">ROI</span>
            </div>
            <div className="stat-tile">
              <span className={`stat-tile-value ${roiClass(data.summary.pnl_units)}`}>{formatPnl(data.summary.pnl_units)}</span>
              <span className="stat-tile-label">PnL (stake=1)</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile-value">{data.summary.hit_rate !== null ? `${data.summary.hit_rate}%` : "—"}</span>
              <span className="stat-tile-label">Acierto</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile-value">{data.summary.won}</span>
              <span className="stat-tile-label">Acertadas</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile-value">{data.summary.lost}</span>
              <span className="stat-tile-label">Falladas</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile-value">{data.summary.pending}</span>
              <span className="stat-tile-label">Pendientes</span>
            </div>
          </div>
          <p className="small muted intro-note">
            Historico de las selecciones que el modelo marcó como valor (EV positivo) en partidos que ya se han
            jugado, comparadas con el resultado real. <strong>El ROI es la métrica que importa, no el acierto
            aislado</strong>: una selección de probabilidad baja (ej. visitante al 15%) se espera que falle la
            mayoría de las veces aunque tenga EV positivo real — lo que importa es si lo que se gana cuando acierta
            compensa lo que se pierde el resto. Nunca se excluyen los fallos de esta lista ni de estos cálculos.
          </p>

          {data.by_market.length > 1 && (
            <div className="table-scroll">
              <table className="predictions-table">
                <thead>
                  <tr>
                    <th>Mercado</th>
                    <th>Selecciones</th>
                    <th>Acierto</th>
                    <th>PnL</th>
                    <th>ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_market.map((b) => (
                    <tr key={b.key}>
                      <td className="rec-match">{marketLabel(b.key)}</td>
                      <td className="num">{b.total}</td>
                      <td className="num">{b.hit_rate !== null ? `${b.hit_rate}%` : "—"}</td>
                      <td className={`num ${roiClass(b.pnl_units)}`}>{formatPnl(b.pnl_units)}</td>
                      <td className={`num ${roiClass(b.roi)}`}>{formatRoiPct(b.roi)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="table-scroll">
            <table className="predictions-table recommendations-table">
              <thead>
                <tr>
                  <th>Partido</th>
                  <th>Mercado</th>
                  <th>Selección</th>
                  <th>Resultado</th>
                  <th>Prob. modelo</th>
                  <th>EV</th>
                  <th>¿Acertó?</th>
                  <th>PnL</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((rec, i) => (
                  <tr key={`${rec.match_id}-${rec.market}-${rec.selection}-${i}`}>
                    <td className="rec-match">
                      <Link to={`/matches/${rec.match_id}`}>
                        {rec.home_team} vs {rec.away_team}
                      </Link>
                      <div className="muted small">
                        {rec.league_code} · {formatDateTime(rec.date)}
                      </div>
                    </td>
                    <td className="rec-match">{marketLabel(rec.market)}</td>
                    <td className="rec-match">
                      {selectionLabel(rec.market, rec.selection, rec.home_team, rec.away_team)}
                    </td>
                    <td className="num">
                      {rec.home_goals} - {rec.away_goals}
                    </td>
                    <td>{formatPercent(rec.prob_model)}</td>
                    <td>
                      <EvValue ev={rec.ev} />
                    </td>
                    <td>
                      <OutcomeBadge outcome={rec.outcome} />
                    </td>
                    <td className={`num ${roiClass(rec.pnl_units)}`}>{formatPnl(rec.pnl_units)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
