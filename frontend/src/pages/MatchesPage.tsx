import { useState } from "react";
import { Link } from "react-router-dom";
import { getLeagues, getMatches } from "../api/client";
import type { MatchStatus } from "../api/types";
import { LeagueSwitch } from "../components/LeagueSwitch";
import { MatchRow } from "../components/MatchRow";
import { EmptyView, ErrorView, LoadingView } from "../components/StatusView";
import { useSelectedLeagueCode } from "../lib/leagues";
import { useApi } from "../lib/useApi";

const PAGE_SIZE = 20;

export function MatchesPage() {
  const [leagueCode, setLeagueCode] = useSelectedLeagueCode();
  const [status, setStatus] = useState<MatchStatus | undefined>("scheduled");
  const [page, setPage] = useState(0);

  const { data: leagues } = useApi(() => getLeagues(), []);
  const leagueId = leagues?.find((l) => l.code === leagueCode)?.id;
  const {
    data: matches,
    loading,
    error,
  } = useApi(
    () =>
      leagues === null
        ? Promise.resolve([])
        : getMatches({
        league_id: leagueId,
        status,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    [leagues, leagueId, status, page],
  );

  return (
    <div>
      <h1>Partidos</h1>
      <p className="intro-note small muted">
        Los porcentajes que ves aquí son <strong>frecuencia histórica</strong>, no una promesa de lo que va a pasar:
        cuentan cuántas veces ocurrió algo antes, siempre junto al número de partidos usado. No es lo mismo que una
        probabilidad garantizada. <Link to="/glosario">Más sobre cómo leerlos →</Link>
      </p>

      <LeagueSwitch
        leagues={leagues}
        value={leagueCode}
        onChange={(code) => {
          setPage(0);
          setLeagueCode(code);
        }}
        allowAll
      />

      <div className="filters">

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
