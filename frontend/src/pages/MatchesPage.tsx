import { useState } from "react";
import { getLeagues, getMatches } from "../api/client";
import type { MatchStatus } from "../api/types";
import { MatchRow } from "../components/MatchRow";
import { EmptyView, ErrorView, LoadingView } from "../components/StatusView";
import { useApi } from "../lib/useApi";

const PAGE_SIZE = 20;

export function MatchesPage() {
  const [leagueId, setLeagueId] = useState<number | undefined>(undefined);
  const [status, setStatus] = useState<MatchStatus | undefined>(undefined);
  const [page, setPage] = useState(0);

  const { data: leagues } = useApi(() => getLeagues(), []);
  const {
    data: matches,
    loading,
    error,
  } = useApi(
    () =>
      getMatches({
        league_id: leagueId,
        status,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    [leagueId, status, page],
  );

  return (
    <div>
      <h1>Partidos</h1>

      <div className="filters">
        <select
          value={leagueId ?? ""}
          onChange={(e) => {
            setPage(0);
            setLeagueId(e.target.value ? Number(e.target.value) : undefined);
          }}
        >
          <option value="">Todas las ligas</option>
          {leagues?.map((league) => (
            <option key={league.id} value={league.id}>
              {league.name}
            </option>
          ))}
        </select>

        <select
          value={status ?? ""}
          onChange={(e) => {
            setPage(0);
            setStatus((e.target.value || undefined) as MatchStatus | undefined);
          }}
        >
          <option value="">Todos los estados</option>
          <option value="historical">Jugados</option>
          <option value="scheduled">Programados</option>
        </select>
      </div>

      {loading && <LoadingView label="Cargando partidos..." />}
      {error && <ErrorView message={`No se pudo conectar con la API: ${error}`} />}
      {!loading && !error && matches?.length === 0 && (
        <EmptyView message="No hay partidos con estos filtros." />
      )}

      {!loading && !error && matches && matches.length > 0 && (
        <>
          <div className="match-list">
            {matches.map((match) => (
              <MatchRow key={match.id} match={match} />
            ))}
          </div>

          <div className="pagination">
            <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              ← Anteriores
            </button>
            <span>Página {page + 1}</span>
            <button disabled={matches.length < PAGE_SIZE} onClick={() => setPage((p) => p + 1)}>
              Siguientes →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
