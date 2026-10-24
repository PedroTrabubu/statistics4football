import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  marketOdds = true,
}: {
  predictions: Prediction[];
  homeTeam: string;
  awayTeam: string;
  /** false: la competición no tiene cuotas de mercado; sin EV de mercado ni «Valor». */
  marketOdds?: boolean;
}) {
  const { t } = useTranslation();
  // Cuota que el usuario introduce manualmente, por seleccion. Solo vive en
  // el navegador: nunca se envia ni se guarda (ver seccion "Cuotas y valor
  // estadistico" de la especificacion — guardar historico propio es V1).
  const [manualOdds, setManualOdds] = useState<Record<string, string>>({});

  if (predictions.length === 0) {
    return <p className="muted">{t("matches:predictions.empty")}</p>;
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
        const hasMarketData = marketOdds && preds.some((p) => p.prob_market_implied !== null);

        return (
          <div key={market} className="predictions-market">
            <h4>{marketLabel(market)}</h4>
            <div className="table-scroll">
              <table className="predictions-table">
                <thead>
                  <tr>
                    <th>{t("matches:predictions.column.selection")}</th>
                    {hasMarketData && <th>{t("matches:predictions.column.marketProb")}</th>}
                    <th>{t("matches:predictions.column.modelProb")}</th>
                    <th>{t("matches:predictions.column.fairOdds")}</th>
                    {hasMarketData && <th>{t("matches:predictions.column.marketEv")}</th>}
                    <th>{t("matches:predictions.column.sample")}</th>
                    <th>{t("matches:predictions.column.risk")}</th>
                    <th>{t("matches:predictions.column.yourOdds")}</th>
                    <th>{t("matches:predictions.column.yourEv")}</th>
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
                      <tr key={p.selection} className={marketOdds && p.is_recommended ? "row-recommended" : undefined}>
                        <td>
                          {label}
                          {marketOdds && p.is_recommended && <span className="value-tag">{t("matches:predictions.valueTag")}</span>}
                        </td>
                        {hasMarketData && <td>{formatPercent(p.prob_market_implied)}</td>}
                        <td>
                          <span className="prob-cell">
                            <span className="num">{formatPercent(p.prob_model)}</span>
                            <span className="prob-bar" aria-hidden="true">
                              <span style={{ width: `${Math.round(p.prob_model * 100)}%` }} />
                            </span>
                          </span>
                        </td>
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
                            placeholder={t("matches:predictions.oddsPlaceholder")}
                            value={raw}
                            onChange={(e) => setManualOdds((prev) => ({ ...prev, [key]: e.target.value }))}
                            aria-label={t("matches:predictions.oddsLabel", { selection: label })}
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
                              <div className="small muted">{t("matches:predictions.implied", { value: formatPercent(yourImplied) })}</div>
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
      <p className="small muted odds-disclaimer">{t("matches:predictions.disclaimer")}</p>
    </div>
  );
}
