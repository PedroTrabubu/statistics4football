import { useState } from "react";
import { getLeagueMatchdays, getMatches } from "../api/client";
import type { League } from "../api/types";
import { formatDateRange, formatSeason } from "../lib/format";
import { leagueName } from "../lib/leagues";
import { useApi } from "../lib/useApi";
import { MatchRow } from "./MatchRow";
import { EmptyView, ErrorView, LoadingView } from "./StatusView";

/** Partidos de una liga por temporada y jornada; se abre en la jornada actual. */
export function MatchdayBrowser({ league, showTitle = false }: { league: League; showTitle?: boolean }) {
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

  return (
    <section className="matchday-browser">
      {showTitle && <h2>{leagueName(league.code)}</h2>}

      {calendar.error && <ErrorView message={`No se pudo conectar con la API: ${calendar.error}`} />}
      {info && (
        <div className="filters matchday-nav">
          <select
            aria-label="Temporada"
            value={info.season ?? ""}
            onChange={(e) => {
              setMatchday(undefined);
              setSeason(e.target.value);
            }}
          >
            {info.seasons.map((s) => (
              <option key={s} value={s}>
                Temporada {formatSeason(s)}
              </option>
            ))}
          </select>

          <button type="button" disabled={index <= 0} onClick={() => goTo(index - 1)} aria-label="Jornada anterior">
            ←
          </button>
          <select
            aria-label="Jornada"
            value={selected ?? ""}
            onChange={(e) => setMatchday(Number(e.target.value))}
          >
            {info.matchdays.map((m) => (
              <option key={m.matchday} value={m.matchday}>
                Jornada {m.matchday} · {formatDateRange(m.start, m.end)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={index < 0 || index >= info.matchdays.length - 1}
            onClick={() => goTo(index + 1)}
            aria-label="Jornada siguiente"
          >
            →
          </button>
          {current && (
            <span className="small muted">
              {current.played}/{current.total} jugados
            </span>
          )}
        </div>
      )}
      {info?.estimated && (
        <p className="small muted matchday-note">
          Jornadas deducidas de las fechas: la fuente de esta liga no las da, y en temporadas con muchos aplazados
          alguna puede no coincidir con la oficial.
        </p>
      )}

      {(calendar.loading || matches.loading) && <LoadingView label="Cargando partidos..." />}
      {matches.error && <ErrorView message={`No se pudo conectar con la API: ${matches.error}`} />}
      {!calendar.loading && !matches.loading && !matches.error && info && ordered.length === 0 && (
        <EmptyView message="No hay partidos cargados para esta temporada." />
      )}
      {!matches.loading && ordered.length > 0 && (
        <div className="match-list">
          {ordered.map((match) => (
            <MatchRow key={match.id} match={match} />
          ))}
        </div>
      )}
    </section>
  );
}
