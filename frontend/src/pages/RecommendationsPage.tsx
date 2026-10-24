import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { PageHero } from "../components/PageHero";
import { Link } from "react-router-dom";
import { getLeagues, getRecommendationHistory, getRecommendations } from "../api/client";
import type { RecommendationStrategy, RiskLevel } from "../api/types";
import { LeagueSwitch } from "../components/LeagueSwitch";
import { EvValue } from "../components/EvValue";
import { OutcomeBadge } from "../components/OutcomeBadge";
import { RiskBadge } from "../components/RiskBadge";
import { SampleBadge } from "../components/SampleBadge";
import { EmptyView, ErrorView, LoadingView } from "../components/StatusView";
import { MatchTeams } from "../components/TeamCrest";
import {
  formatDateTime,
  formatFixed,
  formatLocaleNumber,
  formatMatchday,
  formatPercent,
  formatPnl,
  formatRoiPct,
  marketLabel,
  joinParts,
  selectionLabel,
  withPercent,
} from "../lib/format";
import { leagueName, onlyValidated, useSelectedLeagueCode } from "../lib/leagues";
import { useApi } from "../lib/useApi";

type Tab = "upcoming" | "history";

/** Estrategias y la clave de sus textos en recommendations:strategy. */
const STRATEGIES: [RecommendationStrategy, string][] = [
  ["alta_probabilidad", "highProbability"],
  ["valor", "value"],
];

/** Un porcentaje que la API ya da redondeado (0-100): "74.8%". */
const apiPct = (value: number | null) => (value !== null ? withPercent(formatLocaleNumber(value)) : "—");

/** Diferencia en puntos porcentuales con signo: "+3.2 pp". */
const signedPp = (pp: number) => `${pp > 0 ? "+" : ""}${formatFixed(pp, 1)} pp`;

function roiClass(value: number | null): string {
  if (value === null) return "";
  return value >= 0 ? "ev-positive" : "ev-negative";
}

/** Diferencia en puntos porcentuales entre dos probabilidades 0-1. */
function formatEdge(model: number, market: number | null): string {
  if (market === null) return "—";
  return signedPp((model - market) * 100);
}

export function RecommendationsPage() {
  const { t } = useTranslation();
  const [strategy, setStrategy] = useState<RecommendationStrategy>("alta_probabilidad");
  const [tab, setTab] = useState<Tab>("upcoming");
  const [selectedCode, setLeagueCode] = useSelectedLeagueCode();
  const { data: allLeagues } = useApi(() => getLeagues(), []);
  const { leagues, code: leagueCode, pending } = onlyValidated(allLeagues, selectedCode);
  const leagueId = leagues?.find((l) => l.code === leagueCode)?.id;

  return (
    <div>
      <PageHero eyebrow={leagueCode === null ? t("common:league.all") : leagueName(leagueCode)} title={t("nav:recommendations")} accentWords={0} lead={<p>{t("recommendations:lead")}</p>} />

      <LeagueSwitch leagues={leagues} value={leagueCode} onChange={setLeagueCode} allowAll />
      {pending && <p className="small muted">{pending}</p>}

      <div className="tab-group tab-group-spaced">
        {STRATEGIES.map(([key, label]) => (
          <button
            key={key}
            className={strategy === key ? "tab-button tab-button-active" : "tab-button"}
            onClick={() => setStrategy(key)}
          >
            {t(`recommendations:strategy.${label}`)}
          </button>
        ))}
      </div>

      <p className="small muted intro-note">
        <Trans
          i18nKey={strategy === "alta_probabilidad" ? "recommendations:intro.highProbability" : "recommendations:intro.value"}
          components={{ bold: <strong /> }}
        />
      </p>

      <div className="tab-group tab-group-spaced">
        <button
          className={tab === "upcoming" ? "tab-button tab-button-active" : "tab-button"}
          onClick={() => setTab("upcoming")}
        >
          {t("recommendations:tabUpcoming")}
        </button>
        <button
          className={tab === "history" ? "tab-button tab-button-active" : "tab-button"}
          onClick={() => setTab("history")}
        >
          {t("recommendations:tabHistory")}
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
  const { t } = useTranslation();
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
      {loading && <LoadingView label={t("recommendations:loading")} />}
      {error && <ErrorView message={t("common:error.api", { error })} />}
      {!loading && !error && recommendations?.length === 0 && <EmptyView message={t("recommendations:emptyHighProbability")} />}

      {!loading && !error && recommendations && recommendations.length > 0 && (
        <div className="table-scroll">
          <table className="predictions-table recommendations-table">
            <thead>
              <tr>
                <th>{t("recommendations:column.match")}</th>
                <th>{t("recommendations:column.market")}</th>
                <th>{t("recommendations:column.selection")}</th>
                <th>{t("recommendations:column.modelProb")}</th>
                <th>{t("recommendations:column.marketProb")}</th>
                <th>{t("recommendations:column.edge")}</th>
                <th title={t("recommendations:column.evTitle")}>{t("recommendations:column.ev")}</th>
                <th>{t("recommendations:column.sample")}</th>
              </tr>
            </thead>
            <tbody>
              {recommendations.map((rec) => (
                <tr key={`${rec.match_id}-${rec.market}-${rec.selection}`}>
                  <td className="rec-match">
                    <Link to={`/matches/${rec.match_id}`}>
                      <MatchTeams home={rec.home_team} away={rec.away_team} league={rec.league_code} middle="vs" />
                    </Link>
                    <div className="muted small">
                      {joinParts(leagueName(rec.league_code), formatMatchday(rec.matchday), formatDateTime(rec.date))}
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
  const { t } = useTranslation();
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
          <option value="">{t("recommendations:anyRisk")}</option>
          <option value="low">{t("common:risk.low")}</option>
          <option value="medium">{t("common:risk.medium")}</option>
          <option value="high">{t("common:risk.high")}</option>
        </select>

        <label className="filter-inline">
          {t("recommendations:minEv")}
          <input
            type="number"
            step={0.01}
            min={0}
            value={minEv}
            onChange={(e) => setMinEv(Number(e.target.value))}
          />
        </label>
      </div>

      {loading && <LoadingView label={t("recommendations:loading")} />}
      {error && <ErrorView message={t("common:error.api", { error })} />}
      {!loading && !error && recommendations?.length === 0 && <EmptyView message={t("recommendations:emptyValue")} />}

      {!loading && !error && recommendations && recommendations.length > 0 && (
        <div className="table-scroll">
          <table className="predictions-table recommendations-table">
            <thead>
              <tr>
                <th>{t("recommendations:column.match")}</th>
                <th>{t("recommendations:column.market")}</th>
                <th>{t("recommendations:column.selection")}</th>
                <th>{t("recommendations:column.marketProb")}</th>
                <th>{t("recommendations:column.modelProb")}</th>
                <th>{t("recommendations:column.ev")}</th>
                <th>{t("recommendations:column.sample")}</th>
                <th>{t("recommendations:column.risk")}</th>
              </tr>
            </thead>
            <tbody>
              {recommendations.map((rec, i) => (
                <tr key={`${rec.match_id}-${rec.market}-${rec.selection}-${i}`}>
                  <td className="rec-match">
                    <Link to={`/matches/${rec.match_id}`}>
                      <MatchTeams home={rec.home_team} away={rec.away_team} league={rec.league_code} middle="vs" />
                    </Link>
                    <div className="muted small">
                      {joinParts(leagueName(rec.league_code), formatMatchday(rec.matchday), formatDateTime(rec.date))}
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
  const { t } = useTranslation();
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
      {loading && <LoadingView label={t("recommendations:history.loading")} />}
      {error && <ErrorView message={t("common:error.api", { error })} />}

      {!loading && !error && data && data.summary.total === 0 && <EmptyView message={t("recommendations:history.empty")} />}

      {!loading && !error && data && summary && summary.total > 0 && (
        <>
          <div className="stat-tiles">
            <div className="stat-tile">
              <span className="stat-tile-value">{apiPct(summary.hit_rate)}</span>
              <span className="stat-tile-label">{t("recommendations:history.tile.hitRate")}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile-value">{apiPct(summary.market_expected_hit_rate)}</span>
              <span className="stat-tile-label">{t("recommendations:history.tile.marketExpected")}</span>
            </div>
            <div className="stat-tile">
              <span className={`stat-tile-value ${roiClass(margin)}`}>{margin !== null ? signedPp(margin) : "—"}</span>
              <span className="stat-tile-label">{t("recommendations:history.tile.margin")}</span>
            </div>
            <div className="stat-tile">
              <span className={`stat-tile-value ${roiClass(summary.roi)}`}>{formatRoiPct(summary.roi)}</span>
              <span className="stat-tile-label">{t("recommendations:history.tile.roi", { n: summary.with_odds })}</span>
            </div>
            <div className="stat-tile">
              <span className={`stat-tile-value ${roiClass(summary.pnl_units)}`}>{formatPnl(summary.pnl_units)}</span>
              <span className="stat-tile-label">{t("recommendations:history.tile.pnl")}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile-value">
                {summary.won} / {summary.lost}
              </span>
              <span className="stat-tile-label">{t("recommendations:history.tile.wonLost")}</span>
            </div>
          </div>
          <p className="small muted intro-note">
            <Trans
              i18nKey={strategy === "alta_probabilidad" ? "recommendations:history.note.highProbability" : "recommendations:history.note.value"}
              components={{ bold: <strong /> }}
            />
          </p>

          {data.by_market.length > 1 && (
            <div className="table-scroll">
              <table className="predictions-table">
                <thead>
                  <tr>
                    <th>{t("recommendations:column.market")}</th>
                    <th>{t("recommendations:history.column.selections")}</th>
                    <th>{t("recommendations:history.column.hitRate")}</th>
                    <th>{t("recommendations:history.column.marketExpected")}</th>
                    <th>{t("recommendations:history.column.withOdds")}</th>
                    <th>{t("recommendations:column.pnl")}</th>
                    <th>{t("recommendations:history.column.roi")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_market.map((b) => (
                    <tr key={b.key}>
                      <td className="rec-match">{marketLabel(b.key)}</td>
                      <td className="num">{b.total}</td>
                      <td className="num">{apiPct(b.hit_rate)}</td>
                      <td className="num">{apiPct(b.market_expected_hit_rate)}</td>
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
                  <th>{t("recommendations:column.match")}</th>
                  <th>{t("recommendations:column.market")}</th>
                  <th>{t("recommendations:column.selection")}</th>
                  <th>{t("recommendations:column.result")}</th>
                  <th>{t("recommendations:column.modelProb")}</th>
                  <th>{t("recommendations:column.marketProb")}</th>
                  <th>{t("recommendations:column.ev")}</th>
                  <th>{t("recommendations:column.hit")}</th>
                  <th>{t("recommendations:column.pnl")}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((rec, i) => (
                  <tr key={`${rec.match_id}-${rec.market}-${rec.selection}-${i}`}>
                    <td className="rec-match">
                      <Link to={`/matches/${rec.match_id}`}>
                        <MatchTeams home={rec.home_team} away={rec.away_team} league={rec.league_code} middle="vs" />
                      </Link>
                      <div className="muted small">
                        {joinParts(leagueName(rec.league_code), formatMatchday(rec.matchday), formatDateTime(rec.date))}
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
