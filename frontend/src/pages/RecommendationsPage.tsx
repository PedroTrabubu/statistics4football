import { useState } from "react";
import { Link } from "react-router-dom";
import { getLeagues, getRecommendationHistory, getRecommendations } from "../api/client";
import type { RecommendationStrategy, RiskLevel } from "../api/types";
import { LeagueSwitch } from "../components/LeagueSwitch";
import { EvValue } from "../components/EvValue";
import { OutcomeBadge } from "../components/OutcomeBadge";
import { RiskBadge } from "../components/RiskBadge";
import { SampleBadge } from "../components/SampleBadge";
import { EmptyView, ErrorView, LoadingView } from "../components/StatusView";
import { formatDateTime, formatPercent, formatPnl, formatRoiPct, marketLabel, selectionLabel } from "../lib/format";
import { leagueName, useSelectedLeagueCode } from "../lib/leagues";
import { useApi } from "../lib/useApi";

type Tab = "upcoming" | "history";

const STRATEGY_LABELS: Record<RecommendationStrategy, string> = {
  alta_probabilidad: "Alta probabilidad",
  valor: "Valor (EV)",
};

function roiClass(value: number | null): string {
  if (value === null) return "";
  return value >= 0 ? "ev-positive" : "ev-negative";
}

/** Diferencia en puntos porcentuales entre dos probabilidades 0-1. */
function formatEdge(model: number, market: number | null): string {
  if (market === null) return "—";
  const pp = (model - market) * 100;
  return `${pp > 0 ? "+" : ""}${pp.toFixed(1)} pp`;
}

export function RecommendationsPage() {
  const [strategy, setStrategy] = useState<RecommendationStrategy>("alta_probabilidad");
  const [tab, setTab] = useState<Tab>("upcoming");
  const [leagueCode, setLeagueCode] = useSelectedLeagueCode();
  const { data: leagues } = useApi(() => getLeagues(), []);
  const leagueId = leagues?.find((l) => l.code === leagueCode)?.id;

  return (
    <div>
      <h1>Recomendaciones</h1>
      <p className="muted">
        Esto es una herramienta de análisis, no una promesa de ganancia. Compara siempre el acierto con lo que ya
        esperaba el mercado: acertar mucho en apuestas que el mercado ya daba como muy probables no es mérito del
        modelo.
      </p>

      <LeagueSwitch leagues={leagues} value={leagueCode} onChange={setLeagueCode} allowAll />

      <div className="tab-group tab-group-spaced">
        {(Object.keys(STRATEGY_LABELS) as RecommendationStrategy[]).map((key) => (
          <button
            key={key}
            className={strategy === key ? "tab-button tab-button-active" : "tab-button"}
            onClick={() => setStrategy(key)}
          >
            {STRATEGY_LABELS[key]}
          </button>
        ))}
      </div>

      <p className="small muted intro-note">
        {strategy === "alta_probabilidad" ? (
          <>
            <strong>Alta probabilidad:</strong> como máximo una selección por partido, cuando el modelo le da al menos
            un 62% y al menos 3 puntos más que el mercado. Combina las cuotas pre-partido, Dixon-Coles y los patrones
            de cada equipo. En 25/26 y 26/27 acertó un 74.8% cuando el mercado esperaba un 68.5%, pero en las tres
            temporadas anteriores (22/23–24/25) acertó un 68.7%, exactamente lo que esperaba el mercado. Acierta mucho
            porque elige selecciones probables, no porque sepa más que las casas.
          </>
        ) : (
          <>
            <strong>Valor (EV):</strong> selecciones donde Dixon-Coles da más probabilidad que la cuota. Aciertan menos
            a menudo (incluye visitantes y empates) y se juzgan por el ROI, no por el acierto.
          </>
        )}
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

      {leagues &&
        (tab === "upcoming" ? (
          strategy === "valor" ? (
            <UpcomingValue leagueId={leagueId} />
          ) : (
            <UpcomingHighProbability leagueId={leagueId} />
          )
        ) : (
          <RecommendationHistory leagueId={leagueId} strategy={strategy} />
        ))}
    </div>
  );
}

interface LeagueFilterProps {
  leagueId: number | undefined;
}

function UpcomingHighProbability({ leagueId }: LeagueFilterProps) {
  const {
    data: recommendations,
    loading,
    error,
  } = useApi(
    () => getRecommendations({ league_id: leagueId, strategy: "alta_probabilidad", limit: 100 }),
    [leagueId],
  );

  return (
    <>
      {loading && <LoadingView label="Cargando recomendaciones..." />}
      {error && <ErrorView message={`No se pudo conectar con la API: ${error}`} />}
      {!loading && !error && recommendations?.length === 0 && (
        <EmptyView message="No hay selecciones de alta probabilidad para los próximos partidos. El modelo necesita las cuotas pre-partido (scripts/refresh_odds.py y luego refresh_predictions.py), y en muchos partidos ninguna selección supera los dos umbrales: es lo esperado, no un error." />
      )}

      {!loading && !error && recommendations && recommendations.length > 0 && (
        <div className="table-scroll">
          <table className="predictions-table recommendations-table">
            <thead>
              <tr>
                <th>Partido</th>
                <th>Mercado</th>
                <th>Selección</th>
                <th>Prob. modelo</th>
                <th>Prob. mercado</th>
                <th>Ventaja</th>
                <th title="Solo en 1X2 y Over/Under 2.5, que tienen cuota real en los datos">EV</th>
                <th>Muestra</th>
              </tr>
            </thead>
            <tbody>
              {recommendations.map((rec) => (
                <tr key={`${rec.match_id}-${rec.market}-${rec.selection}`}>
                  <td className="rec-match">
                    <Link to={`/matches/${rec.match_id}`}>
                      {rec.home_team} vs {rec.away_team}
                    </Link>
                    <div className="muted small">
                      {leagueName(rec.league_code)} · {formatDateTime(rec.date)}
                    </div>
                  </td>
                  <td className="rec-match">{marketLabel(rec.market)}</td>
                  <td className="rec-match">
                    {selectionLabel(rec.market, rec.selection, rec.home_team, rec.away_team)}
                  </td>
                  <td>
                    <strong>{formatPercent(rec.prob_model)}</strong>
                  </td>
                  <td>{formatPercent(rec.prob_market_implied)}</td>
                  <td className="ev-positive">{formatEdge(rec.prob_model, rec.prob_market_implied)}</td>
                  <td>
                    <EvValue ev={rec.ev} />
                  </td>
                  <td>
                    <SampleBadge matchesUsed={rec.matches_used} />
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

function UpcomingValue({ leagueId }: LeagueFilterProps) {
  const [riskLevel, setRiskLevel] = useState<RiskLevel | undefined>(undefined);
  const [minEv, setMinEv] = useState<number>(0.05);

  const {
    data: recommendations,
    loading,
    error,
  } = useApi(
    () => getRecommendations({ league_id: leagueId, risk_level: riskLevel, min_ev: minEv, strategy: "valor", limit: 50 }),
    [leagueId, riskLevel, minEv],
  );

  return (
    <>
      <div className="filters">
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
        <EmptyView message="Todavía no hay recomendaciones de valor para partidos por jugar: calcular el EV requiere una cuota real de mercado. Carga las cuotas pre-partido (scripts/refresh_odds.py) y vuelve a generar las predicciones. Mientras tanto, usa 'Tu cuota' en la ficha de cada partido para comparar tu propia cuota contra el modelo." />
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
                      {leagueName(rec.league_code)} · {formatDateTime(rec.date)}
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

function RecommendationHistory({ leagueId, strategy }: LeagueFilterProps & { strategy: RecommendationStrategy }) {
  const {
    data,
    loading,
    error,
  } = useApi(() => getRecommendationHistory({ league_id: leagueId, strategy, limit: 100 }), [leagueId, strategy]);

  const summary = data?.summary;
  const margin =
    summary && summary.hit_rate !== null && summary.market_expected_hit_rate !== null
      ? summary.hit_rate - summary.market_expected_hit_rate
      : null;

  return (
    <>
      {loading && <LoadingView label="Cargando histórico..." />}
      {error && <ErrorView message={`No se pudo conectar con la API: ${error}`} />}

      {!loading && !error && data && data.summary.total === 0 && (
        <EmptyView message="Todavía no hay recomendaciones resueltas sobre partidos ya jugados para este filtro." />
      )}

      {!loading && !error && data && summary && summary.total > 0 && (
        <>
          <div className="stat-tiles">
            <div className="stat-tile">
              <span className="stat-tile-value">{summary.hit_rate !== null ? `${summary.hit_rate}%` : "—"}</span>
              <span className="stat-tile-label">Acierto</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile-value">
                {summary.market_expected_hit_rate !== null ? `${summary.market_expected_hit_rate}%` : "—"}
              </span>
              <span className="stat-tile-label">El mercado esperaba</span>
            </div>
            <div className="stat-tile">
              <span className={`stat-tile-value ${roiClass(margin)}`}>
                {margin !== null ? `${margin > 0 ? "+" : ""}${margin.toFixed(1)} pp` : "—"}
              </span>
              <span className="stat-tile-label">Margen sobre mercado</span>
            </div>
            <div className="stat-tile">
              <span className={`stat-tile-value ${roiClass(summary.roi)}`}>{formatRoiPct(summary.roi)}</span>
              <span className="stat-tile-label">ROI ({summary.with_odds} con cuota)</span>
            </div>
            <div className="stat-tile">
              <span className={`stat-tile-value ${roiClass(summary.pnl_units)}`}>{formatPnl(summary.pnl_units)}</span>
              <span className="stat-tile-label">PnL (stake=1)</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile-value">
                {summary.won} / {summary.lost}
              </span>
              <span className="stat-tile-label">Acertadas / falladas</span>
            </div>
          </div>
          <p className="small muted intro-note">
            {strategy === "alta_probabilidad" ? (
              <>
                Selecciones del modelo de alta probabilidad sobre 25/26 y 26/27, calculadas con un modelo entrenado
                solo con temporadas anteriores y con los umbrales fijados antes de ver estos partidos.{" "}
                <strong>El margen sobre el mercado es la métrica de mérito</strong>, no el acierto: elegir siempre lo
                que el mercado da como más probable también acierta mucho, y pierde dinero. El ROI solo cuenta 1X2 y
                Over/Under 2.5, los únicos mercados con cuota real en los datos.
              </>
            ) : (
              <>
                Selecciones que el modelo marcó como valor (EV positivo) en partidos ya jugados.{" "}
                <strong>El ROI es la métrica que importa, no el acierto aislado</strong>: una selección de probabilidad
                baja (ej. visitante al 15%) se espera que falle la mayoría de las veces aunque tenga EV positivo real.
              </>
            )}{" "}
            Nunca se excluyen los fallos de esta lista ni de estos cálculos.
          </p>

          {data.by_market.length > 1 && (
            <div className="table-scroll">
              <table className="predictions-table">
                <thead>
                  <tr>
                    <th>Mercado</th>
                    <th>Selecciones</th>
                    <th>Acierto</th>
                    <th>Mercado esperaba</th>
                    <th>Con cuota</th>
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
                      <td className="num">
                        {b.market_expected_hit_rate !== null ? `${b.market_expected_hit_rate}%` : "—"}
                      </td>
                      <td className="num">{b.with_odds}</td>
                      <td className={`num ${roiClass(b.with_odds ? b.pnl_units : null)}`}>
                        {b.with_odds ? formatPnl(b.pnl_units) : "—"}
                      </td>
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
                  <th>Prob. mercado</th>
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
                        {leagueName(rec.league_code)} · {formatDateTime(rec.date)}
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
                    <td>{formatPercent(rec.prob_market_implied)}</td>
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
