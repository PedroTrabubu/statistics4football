import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getLeagueMatchdays, getMatches } from "../api/client";
import type { League } from "../api/types";
import { formatDateRange, formatMatchday, formatSeason, matchDay } from "../lib/format";
import { leagueName } from "../lib/leagues";
import { useApi } from "../lib/useApi";
import { MatchRow } from "./MatchRow";
import { EmptyView, ErrorView, LoadingView } from "./StatusView";

/** Filas que suelen verse sin scroll: sus escudos se cargan sin esperar. */
const EAGER_ROWS = 6;

/** Partidos de una liga por temporada y jornada; se abre en la jornada actual. */
export function MatchdayBrowser({ league, showTitle = false }: { league: League; showTitle?: boolean }) {
  const { t } = useTranslation();
  const [season, setSeason] = useState<string | undefined>(undefined);
  const [matchday, setMatchday] = useState<number | undefined>(undefined);

  const calendar = useApi(() => getLeagueMatchdays(league.id, season), [league.id, season]);
  const info = calendar.data;
  const selected = matchday ?? info?.current ?? undefined;
  const index = info?.matchdays.findIndex((m) => m.matchday === selected) ?? -1;
  const current = index >= 0 ? info?.matchdays[index] : undefined;

  const matches = useApi(
    () =>
      info?.season && selected !== undefined
        ? getMatches({ league_id: league.id, season: info.season, matchday: selected, limit: 50 })
        : Promise.resolve([]),
    [league.id, info?.season, selected],
  );
  const ordered = [...(matches.data ?? [])].sort((a, b) => a.date.localeCompare(b.date));

  const goTo = (i: number) => setMatchday(info?.matchdays[i]?.matchday);

  // Los partidos de la jornada, por día (en orden: ya vienen ordenados por fecha).
  const days: { key: string; label: string; matches: typeof ordered }[] = [];
  for (const match of ordered) {
    const day = matchDay(match.date);
    const last = days[days.length - 1];
    if (last && last.key === day.key) last.matches.push(match);
    else days.push({ ...day, matches: [match] });
  }

  return (
    <section className="matchday-browser">
      {showTitle && <h2>{leagueName(league.code)}</h2>}

      {calendar.error && <ErrorView message={t("common:error.api", { error: calendar.error })} />}
      {info && (
        <div className="filters matchday-nav">
          <select
            aria-label={t("matches:browser.season")}
            value={info.season ?? ""}
            onChange={(e) => {
              setMatchday(undefined);
              setSeason(e.target.value);
            }}
          >
            {info.seasons.map((s) => (
              <option key={s} value={s}>
                {t("matches:browser.seasonOption", { season: formatSeason(s) })}
              </option>
            ))}
          </select>

          {/* Temporada a la izquierda; la jornada, con sus flechas, a la derecha. */}
          <div className="matchday-nav-group">
            {current && (
              <span className="matchday-progress">
                <span className="small muted num">
                  {t("matches:browser.played", { played: current.played, total: current.total })}
                </span>
                <span className="matchday-progress-track" aria-hidden="true">
                  <span style={{ width: `${current.total ? (current.played / current.total) * 100 : 0}%` }} />
                </span>
              </span>
            )}
            <button type="button" disabled={index <= 0} onClick={() => goTo(index - 1)} aria-label={t("matches:browser.previous")}>
              ←
            </button>
            <select
              aria-label={t("matches:browser.matchday")}
              value={selected ?? ""}
              onChange={(e) => setMatchday(Number(e.target.value))}
            >
              {info.matchdays.map((m) => (
                <option key={m.matchday} value={m.matchday}>
                  {formatMatchday(m.matchday, league.code)} · {formatDateRange(m.start, m.end)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={index < 0 || index >= info.matchdays.length - 1}
              onClick={() => goTo(index + 1)}
              aria-label={t("matches:browser.next")}
            >
              →
            </button>
          </div>
        </div>
      )}
      {info?.estimated && (
        <p className="small muted matchday-note">{t("matches:browser.estimated")}</p>
      )}

      {(calendar.loading || matches.loading) && <LoadingView label={t("common:loading.matches")} />}
      {matches.error && <ErrorView message={t("common:error.api", { error: matches.error })} />}
      {!calendar.loading && !matches.loading && !matches.error && info && ordered.length === 0 && (
        <EmptyView message={t("matches:browser.empty")} />
      )}
      {!matches.loading &&
        days.map((day, d) => (
          <section key={day.key} className="match-day" aria-label={day.label}>
            <div className="match-day-head">
              <h3>{day.label}</h3>
              <span className="match-day-count">{day.matches.length}</span>
            </div>
            <div className="match-list">
              {day.matches.map((match, i) => (
                <MatchRow key={match.id} match={match} eager={d === 0 && i < EAGER_ROWS} />
              ))}
            </div>
          </section>
        ))}
    </section>
  );
}
