import { Link } from "react-router-dom";
import type { TeamSeasonStats } from "../api/types";
import { formatPct } from "../lib/format";

function Row({ label, home, away }: { label: string; home: string; away: string }) {
  return (
    <tr>
      <td className="stats-value">{home}</td>
      <td className="stats-label">{label}</td>
      <td className="stats-value">{away}</td>
    </tr>
  );
}

export function SeasonStatsSummary({
  homeStats,
  awayStats,
  homeTeam,
  awayTeam,
  leagueId,
}: {
  homeStats: TeamSeasonStats | null;
  awayStats: TeamSeasonStats | null;
  homeTeam: string;
  awayTeam: string;
  leagueId: number;
}) {
  if (homeStats === null && awayStats === null) {
    return (
      <p className="muted">
        Ninguno de los dos equipos tiene partidos jugados registrados todavía (temporada recién
        empezada o equipo recién ascendido).
      </p>
    );
  }

  const season = homeStats?.season ?? awayStats?.season;
  const home = homeStats?.overall;
  const away = awayStats?.overall;

  return (
    <div>
      <p className="muted small">Temporada {season} · datos reales de partidos ya jugados.</p>
      <table className="stats-table">
        <thead>
          <tr>
            <th>{homeTeam}</th>
            <th></th>
            <th>{awayTeam}</th>
          </tr>
        </thead>
        <tbody>
          <Row
            label="Partidos jugados"
            home={home ? String(home.matches_played) : "—"}
            away={away ? String(away.matches_played) : "—"}
          />
          <Row
            label="Puntos por partido"
            home={home?.points_per_game?.toFixed(2) ?? "—"}
            away={away?.points_per_game?.toFixed(2) ?? "—"}
          />
          <Row label="Más de 1.5 goles" home={formatPct(home?.over_1_5_pct ?? null)} away={formatPct(away?.over_1_5_pct ?? null)} />
          <Row label="Más de 2.5 goles" home={formatPct(home?.over_2_5_pct ?? null)} away={formatPct(away?.over_2_5_pct ?? null)} />
          <Row label="Ambos anotan" home={formatPct(home?.btts_pct ?? null)} away={formatPct(away?.btts_pct ?? null)} />
          <Row label="Portería a cero" home={formatPct(home?.clean_sheet_pct ?? null)} away={formatPct(away?.clean_sheet_pct ?? null)} />
        </tbody>
      </table>
      <Link to={`/stats?league=${leagueId}`} className="small">
        Ver tabla completa de la liga →
      </Link>
    </div>
  );
}
