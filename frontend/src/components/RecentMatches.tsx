import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { Match, MatchRecent } from "../api/types";
import { formatNumber, formatPercent, formatSeason, formatShortDate } from "../lib/format";
import { leagueName } from "../lib/leagues";
import { cards, type TeamMatchView } from "../lib/markets";
import {
  headToHeadSummary,
  OUTCOME_LABEL,
  OUTCOME_LETTER,
  outcomeOf,
  RECENT_SHOWN,
  teamRecent,
  type Venue,
} from "../lib/recentMatches";
import { LeagueLogo } from "./LeagueLogo";
import { TeamName } from "./TeamCrest";

type Scope = "all" | "venue";

/** "6-3"; "—" si falta alguna de las dos cifras. */
function pair(a: number | null | undefined, b: number | null | undefined): string {
  return a == null || b == null ? "—" : `${a}-${b}`;
}

function ScopeTabs({
  scope,
  onChange,
  venueLabel,
  label,
}: {
  scope: Scope;
  onChange: (scope: Scope) => void;
  venueLabel: string;
  label: string;
}) {
  const { t } = useTranslation();
  const tab = (value: Scope, text: string) => (
    <button
      type="button"
      className={scope === value ? "tab-button tab-button-active" : "tab-button"}
      aria-pressed={scope === value}
      onClick={() => onChange(value)}
    >
      {text}
    </button>
  );
  return (
    <div className="tab-group" role="group" aria-label={label}>
      {tab("all", t("matches:recent.scopeAll"))}
      {tab("venue", venueLabel)}
    </div>
  );
}

/** La competición, solo si no es la de la ficha (un recién ascendido, o la
 * liga de cada equipo en la Champions). */
function OtherLeague({ code, current }: { code: string; current: string }) {
  if (code === current) return null;
  return (
    <span className="recent-league" title={leagueName(code)}>
      <LeagueLogo code={code} />
      <span className="recent-league-name">{leagueName(code)}</span>
    </span>
  );
}

function TeamRecentList({
  team,
  views,
  league,
  venue,
}: {
  team: string;
  views: TeamMatchView[];
  league: string;
  venue: Venue | null;
}) {
  const { t } = useTranslation();
  const record = { W: 0, D: 0, L: 0 };
  for (const v of views) record[outcomeOf(v)] += 1;
  const place = venue ?? "all";

  return (
    <div className="recent-team">
      <h3 className="recent-team-header">
        <TeamName team={team} league={league} size="md" />
      </h3>
      {views.length === 0 ? (
        <p className="small muted">{t(`matches:recent.none.${place}`)}</p>
      ) : (
        <>
          <p className="small muted recent-record">
            <span>
              <Trans
                i18nKey={`matches:recent.record.${place}`}
                count={views.length}
                values={{ win: record.W, draw: record.D, loss: record.L }}
                components={{ num: <span className="num" /> }}
              />
            </span>
            {/* Racha: del partido mas antiguo al mas reciente. */}
            <span className="recent-strip" aria-hidden="true">
              {[...views].reverse().map((v, i) => (
                <span key={v.match.id} className={`pop form-${outcomeOf(v)}`} style={{ animationDelay: `${0.2 + i * 0.05}s` }} />
              ))}
            </span>
          </p>
          <table className="recent-table">
            <thead>
              <tr>
                <th>
                  <span className="visually-hidden">{t("matches:recent.column.result")}</span>
                </th>
                <th className="recent-date-head">{t("matches:recent.column.date")}</th>
                <th>{t("matches:recent.column.rival")}</th>
                <th className="recent-num">{t("matches:recent.column.goals")}</th>
                <th className="recent-num">{t("matches:recent.column.corners")}</th>
                <th className="recent-num">{t("matches:recent.column.cards")}</th>
              </tr>
            </thead>
            <tbody>
              {views.map((v) => {
                const outcome = outcomeOf(v);
                const { match } = v;
                const rival = v.venue === "home" ? match.away_team : match.home_team;
                return (
                  <tr key={match.id}>
                    <td className="recent-outcome">
                      <span className={`form-dot form-${outcome}`} title={OUTCOME_LABEL[outcome]}>
                        {OUTCOME_LETTER[outcome]}
                      </span>
                    </td>
                    <td className="recent-date">{formatShortDate(match.date)}</td>
                    <td className="recent-rival">
                      <span className="recent-rival-inner">
                        <span
                          className="recent-venue"
                          title={t(`matches:recent.venue.${v.venue}.title`)}
                          aria-label={t(`matches:recent.venue.${v.venue}.label`)}
                        >
                          {t(`matches:recent.venue.${v.venue}.letter`)}
                        </span>
                        <TeamName team={rival} league={match.league_code} />
                        <OtherLeague code={match.league_code} current={league} />
                      </span>
                      {/* En movil la fecha va aqui, bajo el rival, para dejarle sitio. */}
                      <span className="recent-date-inline" aria-hidden="true">
                        {formatShortDate(match.date)}
                      </span>
                    </td>
                    <td className="recent-num recent-score">
                      <Link to={`/matches/${match.id}`} title={t("matches:recent.seeMatch")}>
                        {pair(v.goalsFor, v.goalsAgainst)}
                      </Link>
                    </td>
                    <td className="recent-num">{pair(v.statsFor?.corners, v.statsAgainst?.corners)}</td>
                    <td className="recent-num">{pair(cards(v.statsFor), cards(v.statsAgainst))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/** Últimos partidos de cada equipo, uno a uno: el desglose de la forma
 * reciente, con los corners y las tarjetas de cada partido. */
export function RecentMatches({ match, recent }: { match: Match; recent: MatchRecent }) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<Scope>("all");
  const venue = scope === "venue";
  const list = (matches: MatchRecent["home"], teamId: number, side: Venue) =>
    teamRecent(matches, teamId, venue ? side : null).slice(0, RECENT_SHOWN);

  return (
    <div className="recent-matches">
      <div className="recent-toolbar">
        <h3>{t("matches:recent.title")}</h3>
        <ScopeTabs
          scope={scope}
          onChange={setScope}
          venueLabel={t("matches:recent.scopeVenue")}
          label={t("matches:recent.scopeLabel")}
        />
      </div>
      <p className="small muted">{t("matches:recent.legend")}</p>
      <div className="recent-columns">
        <TeamRecentList
          team={match.home_team}
          league={match.league_code}
          views={list(recent.home, match.home_team_id, "home")}
          venue={venue ? "home" : null}
        />
        <TeamRecentList
          team={match.away_team}
          league={match.league_code}
          views={list(recent.away, match.away_team_id, "away")}
          venue={venue ? "away" : null}
        />
      </div>
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-tile-value">{value}</span>
      <span className="stat-tile-label">{label}</span>
    </div>
  );
}

/** Enfrentamientos directos previos, de todas las temporadas: el balance, lo
 * habitual en goles, corners y tarjetas, y cada partido. "En casa": solo los
 * jugados en el campo de este. */
export function HeadToHead({ match, recent }: { match: Match; recent: MatchRecent }) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<Scope>("all");
  const all = teamRecent(recent.h2h, match.home_team_id);
  const views = scope === "venue" ? all.filter((v) => v.venue === "home") : all;
  const summary = headToHeadSummary(views);

  if (all.length === 0) {
    return <p className="muted">{t("matches:h2h.none")}</p>;
  }

  return (
    <div className="head-to-head">
      <div className="recent-toolbar">
        <p className="muted head-to-head-lead">{t("matches:h2h.lead", { count: all.length })}</p>
        <ScopeTabs
          scope={scope}
          onChange={setScope}
          venueLabel={t("matches:h2h.scopeVenue", { team: match.home_team })}
          label={t("matches:h2h.scopeLabel")}
        />
      </div>

      {views.length === 0 ? (
        <p className="muted">{t("matches:h2h.noneAtHome", { team: match.home_team })}</p>
      ) : (
        <>
          {/* Balance: victorias del local, empates y del visitante. */}
          <div className="h2h-balance" aria-hidden="true">
            {summary.wins > 0 && <span className="is-home" style={{ flexGrow: summary.wins }} />}
            {summary.draws > 0 && <span className="is-draw" style={{ flexGrow: summary.draws }} />}
            {summary.losses > 0 && <span className="is-away" style={{ flexGrow: summary.losses }} />}
          </div>
          <div className="stat-tiles head-to-head-tiles">
            <Tile value={String(summary.wins)} label={t("matches:h2h.tile.wins", { team: match.home_team })} />
            <Tile value={String(summary.draws)} label={t("matches:h2h.tile.draws")} />
            <Tile value={String(summary.losses)} label={t("matches:h2h.tile.wins", { team: match.away_team })} />
            <Tile value={formatNumber(summary.goalsPerMatch, 1)} label={t("matches:h2h.tile.goalsPerMatch")} />
            <Tile value={formatPercent(summary.over25, 0)} label={t("matches:h2h.tile.over25")} />
            <Tile value={formatPercent(summary.btts, 0)} label={t("matches:h2h.tile.btts")} />
            <Tile value={formatNumber(summary.cornersPerMatch, 1)} label={t("matches:h2h.tile.cornersPerMatch")} />
            <Tile value={formatNumber(summary.cardsPerMatch, 1)} label={t("matches:h2h.tile.cardsPerMatch")} />
          </div>

          <table className="recent-table head-to-head-table">
            <thead>
              <tr>
                <th>{t("matches:recent.column.date")}</th>
                <th className="recent-home">
                  <span className="recent-team-head">{t("matches:h2h.column.home")}</span>
                </th>
                <th className="recent-num">
                  <span className="visually-hidden">{t("matches:recent.column.result")}</span>
                </th>
                <th className="recent-away">
                  <span className="recent-team-head">{t("matches:h2h.column.away")}</span>
                </th>
                <th className="recent-num">{t("matches:recent.column.corners")}</th>
                <th className="recent-num">{t("matches:recent.column.cards")}</th>
              </tr>
            </thead>
            <tbody>
              {views.map((v) => {
                const m = v.match;
                const winner = m.home_goals! > m.away_goals! ? "home" : m.home_goals! < m.away_goals! ? "away" : null;
                const ht = m.home_ht_goals !== null && m.away_ht_goals !== null;
                return (
                  <tr key={m.id}>
                    <td className="recent-date">
                      {formatShortDate(m.date)}
                      <span className="recent-season">
                        {m.league_code === match.league_code ? formatSeason(m.season) : leagueName(m.league_code)}
                      </span>
                    </td>
                    <td className={winner === "home" ? "recent-home recent-winner" : "recent-home"}>
                      <TeamName team={m.home_team} league={m.league_code} reverse />
                    </td>
                    <td className="recent-num recent-score">
                      <Link to={`/matches/${m.id}`} title={t("matches:recent.seeMatch")}>
                        {m.home_goals}-{m.away_goals}
                      </Link>
                      {ht && (
                        <span className="recent-ht" title={t("matches:h2h.halfTime")}>
                          ({m.home_ht_goals}-{m.away_ht_goals})
                        </span>
                      )}
                    </td>
                    <td className={winner === "away" ? "recent-away recent-winner" : "recent-away"}>
                      <TeamName team={m.away_team} league={m.league_code} />
                    </td>
                    <td className="recent-num">{pair(m.home_stats?.corners, m.away_stats?.corners)}</td>
                    <td className="recent-num">{pair(cards(m.home_stats), cards(m.away_stats))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="small muted">{t("matches:h2h.legend")}</p>
        </>
      )}
    </div>
  );
}
