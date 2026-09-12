import type { Prediction } from "../api/types";
import { formatEv, formatPercent, marketLabel, selectionLabel } from "../lib/format";
import { RiskBadge } from "./RiskBadge";

export function PredictionsTable({
  predictions,
  homeTeam,
  awayTeam,
}: {
  predictions: Prediction[];
  homeTeam: string;
  awayTeam: string;
}) {
  if (predictions.length === 0) {
    return (
      <p className="muted">
        No hay cuotas suficientes para este partido (falta la referencia de mercado en algún
        mercado), así que no se generaron predicciones.
      </p>
    );
  }

  const byMarket = new Map<string, Prediction[]>();
  for (const p of predictions) {
    const list = byMarket.get(p.market) ?? [];
    list.push(p);
    byMarket.set(p.market, list);
  }

  return (
    <div className="predictions">
      {Array.from(byMarket.entries()).map(([market, preds]) => (
        <div key={market} className="predictions-market">
          <h4>{marketLabel(market)}</h4>
          <table className="predictions-table">
            <thead>
              <tr>
                <th>Selección</th>
                <th>Prob. mercado</th>
                <th>Prob. modelo</th>
                <th>EV</th>
                <th>Confianza</th>
                <th>Riesgo</th>
              </tr>
            </thead>
            <tbody>
              {preds.map((p) => (
                <tr key={p.selection} className={p.is_recommended ? "row-recommended" : undefined}>
                  <td>
                    {selectionLabel(p.market, p.selection, homeTeam, awayTeam)}
                    {p.is_recommended && <span className="value-tag">VALOR</span>}
                  </td>
                  <td>{formatPercent(p.prob_market_implied)}</td>
                  <td>{formatPercent(p.prob_model)}</td>
                  <td className={p.ev >= 0 ? "ev-positive" : "ev-negative"}>{formatEv(p.ev)}</td>
                  <td>{formatPercent(p.confidence, 0)}</td>
                  <td>
                    <RiskBadge level={p.risk_level} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
