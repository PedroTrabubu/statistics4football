import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { PageHero } from "../components/PageHero";
import { Link } from "react-router-dom";
import { getLeagues, getPicks, getPicksHistory } from "../api/client";
import type { PickCombo, PickKind, PickLeg } from "../api/types";
import { LeagueSwitch } from "../components/LeagueSwitch";
import { OutcomeBadge } from "../components/OutcomeBadge";
import { EmptyView, ErrorView, LoadingView } from "../components/StatusView";
import { MatchTeams } from "../components/TeamCrest";
import { currentLocale, t } from "../i18n";
import {
  formatDateTime,
  formatFixed,
  formatLocaleNumber,
  formatMatchday,
  formatRoiPct,
  joinParts,
  withPercent,
} from "../lib/format";
import { leagueName, onlyValidated, useSelectedLeagueCode } from "../lib/leagues";
import { ODDS_KIND_TITLES, PICK_KIND_LABELS, TIER_KINDS, oneInN, pickLegLabel, pickLegUnit } from "../lib/picks";
import { useApi } from "../lib/useApi";

type Tab = "upcoming" | "history";

/** Lo que es cada nivel: picks:tierHint.<nivel>. */
const TIER_HINT_KEYS: Record<PickKind, string> = {
  segura: "safe",
  fiable: "reliable",
  media: "medium",
  alta: "high",
  bomba: "bomb",
  mismo_partido: "sameMatch",
};
const tierHint = (kind: PickKind) => t(`picks:tierHint.${TIER_HINT_KEYS[kind]}`);

function pct(prob: number): string {
  return withPercent(String(Math.round(prob * 100)));
}

function formatWindow(window: string): string {
  const start = new Date(`${window}T00:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString(currentLocale(), { day: "numeric", month: "short" });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function PicksPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [selectedCode, setLeagueCode] = useSelectedLeagueCode();
  const { data: allLeagues } = useApi(() => getLeagues(), []);
  const { leagues, code: leagueCode, pending } = onlyValidated(allLeagues, selectedCode);

  return (
    <div>
      <PageHero eyebrow={leagueCode === null ? t("common:league.all") : leagueName(leagueCode)} title={t("nav:picks")} accentWords={0} lead={<p>{t("picks:page.lead")}</p>} />

      <LeagueSwitch leagues={leagues} value={leagueCode} onChange={setLeagueCode} allowAll />
      {pending && <p className="small muted">{pending}</p>}

      <div className="tab-group tab-group-spaced">
        <button
          className={tab === "upcoming" ? "tab-button tab-button-active" : "tab-button"}
          onClick={() => setTab("upcoming")}
        >
          {t("picks:page.tabUpcoming")}
        </button>
        <button
          className={tab === "history" ? "tab-button tab-button-active" : "tab-button"}
          onClick={() => setTab("history")}
        >
          {t("picks:page.tabHistory")}
        </button>
      </div>

      {tab === "upcoming" ? (
        <UpcomingPicks league={leagueCode ?? undefined} onShowHistory={() => setTab("history")} />
      ) : (
        <PicksHistoryView league={leagueCode ?? undefined} />
      )}
    </div>
  );
}

/** Sin picks todavía, el aviso lleva al histórico. */
function UpcomingPicks({ league, onShowHistory }: { league: string | undefined; onShowHistory: () => void }) {
  const { t } = useTranslation();
  const { data, loading, error } = useApi(() => getPicks(league), [league]);
  const tiers = data?.combos.filter((c) => c.kind !== "mismo_partido") ?? [];
  const sameMatch = data?.combos.filter((c) => c.kind === "mismo_partido") ?? [];

  return (
    <>
      {loading && <LoadingView label={t("picks:page.loading")} />}
      {error && <ErrorView message={t("common:error.api", { error })} />}
      {!loading && !error && data && data.combos.length === 0 && (
        <EmptyView
          message={t("picks:page.empty")}
          action={
            <button type="button" className="link-button" onClick={onShowHistory}>
              {t("picks:page.seeHistory")}
            </button>
          }
        />
      )}

      {!loading && !error && data && data.combos.length > 0 && (
        <>
          <p className="small muted intro-note">
            <Trans
              i18nKey="picks:page.upcomingNote"
              values={{ window: data.window ? formatWindow(data.window) : "" }}
              components={{ bold: <strong />, em: <em /> }}
            />
          </p>

          <h2 className="picks-heading">{t("picks:page.byLevel")}</h2>
          <div className="picks-grid">
            {TIER_KINDS.map((kind) => {
              const combo = tiers.find((c) => c.kind === kind);
              return combo ? (
                <ComboCard key={kind} combo={combo} />
              ) : (
                <div key={kind} className="pick-card pick-card-empty">
                  <h3>{PICK_KIND_LABELS[kind]}</h3>
                  <p className="small muted">{t("picks:page.levelEmpty")}</p>
                </div>
              );
            })}
          </div>

          {sameMatch.length > 0 && (
            <>
              <h2 className="picks-heading">{t("picks:page.sameMatchTitle")}</h2>
              <p className="small muted">{t("picks:page.sameMatchNote", { hint: tierHint("mismo_partido") })}</p>
              <div className="picks-grid picks-grid-small">
                {sameMatch.map((combo) => (
                  <ComboCard key={combo.id} combo={combo} compact />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

const ODDS_KIND_KEYS: Record<string, string> = { real: "real", derivada: "derived", estimada: "estimated" };

function OddsTag({ kind }: { kind: string }) {
  const { t } = useTranslation();
  return (
    <span className={`odds-tag odds-tag-${kind}`} title={ODDS_KIND_TITLES[kind]}>
      {ODDS_KIND_KEYS[kind] ? t(`picks:oddsKindTag.${ODDS_KIND_KEYS[kind]}`) : kind}
    </span>
  );
}

function LegRow({ leg, showMatch, settled }: { leg: PickLeg; showMatch: boolean; settled: boolean }) {
  const { t } = useTranslation();
  const unit = pickLegUnit(leg);
  return (
    <li className={settled ? `pick-leg pick-leg-${leg.outcome}` : "pick-leg"}>
      <div className="pick-leg-main">
        <span className="pick-leg-label">{pickLegLabel(leg)}</span>
        {showMatch && (
          <Link to={`/matches/${leg.match_id}`} className="pick-leg-match small">
            <MatchTeams home={leg.home_team} away={leg.away_team} league={leg.league_code} middle="–" />
            <span>{joinParts(leagueName(leg.league_code), formatMatchday(leg.matchday), formatDateTime(leg.date))}</span>
          </Link>
        )}
        {settled && leg.actual && (
          <span className="small muted">{t("picks:combo.actual", { actual: leg.actual, unit })}</span>
        )}
      </div>
      <div className="pick-leg-numbers">
        <span className="pick-leg-prob">{pct(leg.prob)}</span>
        <span className="pick-leg-odds">
          {formatFixed(leg.odds, 2)} <OddsTag kind={leg.odds_kind} />
        </span>
      </div>
    </li>
  );
}

function ComboCard({ combo, compact = false }: { combo: PickCombo; compact?: boolean }) {
  const { t } = useTranslation();
  const settled = combo.outcome !== "pending";
  const first = combo.legs[0];
  return (
    <article className={`pick-card pick-card-${combo.kind}`}>
      <header className="pick-card-header">
        <div>
          <h3>
            {compact ? (
              <MatchTeams home={first.home_team} away={first.away_team} league={first.league_code} middle="–" size="md" />
            ) : (
              PICK_KIND_LABELS[combo.kind]
            )}
          </h3>
          <p className="small muted">
            {compact ? joinParts(leagueName(first.league_code), formatMatchday(first.matchday), formatDateTime(first.date)) : tierHint(combo.kind)}
          </p>
        </div>
        <div className="pick-card-odds">
          <span className="pick-card-odds-value">{formatFixed(combo.odds, 2)}</span>
          <OddsTag kind={combo.odds_kind} />
        </div>
      </header>
      <p className="pick-card-prob">
        <Trans i18nKey="picks:combo.probability" values={{ pct: pct(combo.prob) }} components={{ bold: <strong /> }} />
        <span className="muted">{t("picks:combo.hits", { oneInN: oneInN(combo.prob) })}</span>
        {settled && (
          <>
            {" "}
            <OutcomeBadge outcome={combo.outcome} />
          </>
        )}
      </p>
      <ul className="pick-legs">
        {combo.legs.map((leg, i) => (
          <LegRow key={i} leg={leg} showMatch={!compact} settled={settled} />
        ))}
      </ul>
    </article>
  );
}

function PicksHistoryView({ league }: { league: string | undefined }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<PickKind | undefined>(undefined);
  const { data, loading, error } = useApi(() => getPicksHistory({ league, kind, limit: 40 }), [league, kind]);

  return (
    <>
      {loading && <LoadingView label={t("picks:history.loading")} />}
      {error && <ErrorView message={t("common:error.api", { error })} />}
      {!loading && !error && data && data.summary.length === 0 && <EmptyView message={t("picks:history.empty")} />}

      {!loading && !error && data && data.summary.length > 0 && (
        <>
          <p className="small muted intro-note">
            <Trans i18nKey="picks:history.note" components={{ bold: <strong /> }} />
          </p>

          <div className="table-scroll">
            <table className="predictions-table">
              <thead>
                <tr>
                  <th>{t("picks:history.column.level")}</th>
                  <th className="num">{t("picks:history.column.combos")}</th>
                  <th className="num">{t("picks:history.column.hitRate")}</th>
                  <th className="num">{t("picks:history.column.promised")}</th>
                  <th className="num">{t("picks:history.column.avgOdds")}</th>
                  <th className="num">{t("picks:history.column.roi")}</th>
                </tr>
              </thead>
              <tbody>
                {data.summary.map((s) => (
                  <tr key={s.kind}>
                    <td className="rec-match">{PICK_KIND_LABELS[s.kind]}</td>
                    <td className="num">{s.total}</td>
                    <td className="num">
                      <strong>{s.hit_rate !== null ? withPercent(formatLocaleNumber(s.hit_rate)) : "—"}</strong>
                      <span className="muted small"> ({s.won}/{s.won + s.lost})</span>
                    </td>
                    <td className="num">{s.predicted_hit_rate !== null ? withPercent(formatLocaleNumber(s.predicted_hit_rate)) : "—"}</td>
                    <td className="num">{s.avg_odds != null ? formatFixed(s.avg_odds, 2) : "—"}</td>
                    <td className={`num ${s.roi_shown_odds !== null && s.roi_shown_odds >= 0 ? "ev-positive" : "ev-negative"}`}>
                      {formatRoiPct(s.roi_shown_odds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="filters">
            <select
              aria-label={t("picks:history.column.level")}
              value={kind ?? ""}
              onChange={(e) => setKind((e.target.value || undefined) as PickKind | undefined)}
            >
              <option value="">{t("picks:history.allLevels")}</option>
              {(Object.keys(PICK_KIND_LABELS) as PickKind[]).map((k) => (
                <option key={k} value={k}>
                  {PICK_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>

          <h2 className="picks-heading">{t("picks:history.latest")}</h2>
          <div className="picks-grid">
            {data.combos.map((combo) => (
              <div key={combo.id}>
                <p className="small muted picks-window">{t("picks:history.window", { window: formatWindow(combo.window) })}</p>
                <ComboCard combo={combo} compact={combo.kind === "mismo_partido"} />
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
