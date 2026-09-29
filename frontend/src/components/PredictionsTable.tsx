import { useState } from "react";
import type { Prediction } from "../api/types";
import { EvValue } from "./EvValue";
import { formatEv, formatOdds, formatPercent, marketLabel, selectionLabel } from "../lib/format";
import { fairOdds, impliedProbability, manualEv, parseOddsInput } from "../lib/oddsMath";
import { SampleBadge } from "./SampleBadge";
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
  // Cuota que el usuario introduce manualmente, por seleccion. Solo vive en
  // el navegador: nunca se envia ni se guarda (ver seccion "Cuotas y valor
  // estadistico" de la especificacion — guardar historico propio es V1).
  const [manualOdds, setManualOdds] = useState<Record<string, string>>({});

  if (predictions.length === 0) {
    return <p className="muted">No hay estadísticas suficientes para generar predicciones de este partido.</p>;
  }

  const byMarket = new Map<string, Prediction[]>();
  for (const p of predictions) {
    const list = byMarket.get(p.market) ?? [];
    list.push(p);
    byMarket.set(p.market, list);
  }

  return (
    <div className="predictions">
      {Array.from(byMarket.entries()).map(([market, preds]) => {
        // Partidos futuros sin cuotas ingeridas: "Prob. mercado"/"EV mercado"
        // salen null en las 2-3 filas del mercado. En vez de una tabla llena
        // de guiones, se ocultan esas dos columnas para este mercado.
        const hasMarketData = preds.some((p) => p.prob_market_implied !== null);

        return (
          <div key={market} className="predictions-market">
            <h4>{marketLabel(market)}</h4>
            <div className="table-scroll">
              <table className="predictions-table">
                <thead>
                  <tr>
                    <th>Selección</th>
                    {hasMarketData && <th>Prob. mercado</th>}
                    <th>Prob. modelo</th>
                    <th>Cuota justa</th>
                    {hasMarketData && <th>EV mercado</th>}
                    <th>Muestra</th>
                    <th>Riesgo</th>
                    <th>Tu cuota</th>
                    <th>Tu EV</th>
                  </tr>
                </thead>
                <tbody>
                  {preds.map((p) => {
                    const label = selectionLabel(p.market, p.selection, homeTeam, awayTeam);
                    const key = `${p.market}-${p.selection}`;
                    const raw = manualOdds[key] ?? "";
                    const odds = parseOddsInput(raw);
                    const yourEv = odds !== null ? manualEv(p.prob_model, odds) : null;
                    const yourImplied = odds !== null ? impliedProbability(odds) : null;

                    return (
                      <tr key={p.selection} className={p.is_recommended ? "row-recommended" : undefined}>
                        <td>
                          {label}
                          {p.is_recommended && <span className="value-tag">VALOR</span>}
                        </td>
                        {hasMarketData && <td>{formatPercent(p.prob_market_implied)}</td>}
                        <td>{formatPercent(p.prob_model)}</td>
                        <td className="num">{formatOdds(fairOdds(p.prob_model))}</td>
                        {hasMarketData && (
                          <td>
                            <EvValue ev={p.ev} />
                          </td>
                        )}
                        <td>
                          <SampleBadge matchesUsed={p.matches_used} />
                        </td>
                        <td>
                          <RiskBadge level={p.risk_level} />
                        </td>
                        <td>
                          <input
                            type="text"
                            inputMode="decimal"
                            className="odds-input"
                            placeholder="ej. 1.80"
                            value={raw}
                            onChange={(e) => setManualOdds((prev) => ({ ...prev, [key]: e.target.value }))}
                            aria-label={`Tu cuota para ${label}`}
                          />
                        </td>
                        <td>
                          {odds === null ? (
                            <span className="muted">—</span>
                          ) : (
                            <>
                              <span className={yourEv !== null && yourEv >= 0 ? "ev-positive" : "ev-negative"}>
                                {formatEv(yourEv)}
                              </span>
                              <div className="small muted">implícita {formatPercent(yourImplied)}</div>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      <p className="small muted odds-disclaimer">
        "Cuota justa" y "Tu EV" son estimaciones a partir de la frecuencia histórica del modelo, no una garantía de
        resultado. La cuota que introduces no se guarda ni se envía a ningún sitio.
      </p>
    </div>
  );
}
