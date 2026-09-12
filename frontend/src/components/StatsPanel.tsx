import type { MatchFeatures } from "../api/types";

function FormRow({ label, home, away }: { label: string; home: string | number; away: string | number }) {
  return (
    <tr>
      <td className="stats-value">{home}</td>
      <td className="stats-label">{label}</td>
      <td className="stats-value">{away}</td>
    </tr>
  );
}

export function StatsPanel({
  features,
  homeTeam,
  awayTeam,
}: {
  features: MatchFeatures;
  homeTeam: string;
  awayTeam: string;
}) {
  const { home_form, away_form, h2h, home_xg_form, away_xg_form, home_elo, away_elo } = features;

  return (
    <div className="stats-panel">
      <h3>Forma reciente (últimos {home_form.matches_played || away_form.matches_played} partidos)</h3>
      <table className="stats-table">
        <thead>
          <tr>
            <th>{homeTeam}</th>
            <th></th>
            <th>{awayTeam}</th>
          </tr>
        </thead>
        <tbody>
          <FormRow label="Puntos" home={home_form.points} away={away_form.points} />
          <FormRow
            label="V-E-D"
            home={`${home_form.wins}-${home_form.draws}-${home_form.losses}`}
            away={`${away_form.wins}-${away_form.draws}-${away_form.losses}`}
          />
          <FormRow
            label="Goles a favor/en contra"
            home={`${home_form.goals_for}/${home_form.goals_against}`}
            away={`${away_form.goals_for}/${away_form.goals_against}`}
          />
          <FormRow
            label="xG a favor (media)"
            home={home_xg_form.avg_xg_for?.toFixed(2) ?? "—"}
            away={away_xg_form.avg_xg_for?.toFixed(2) ?? "—"}
          />
          <FormRow
            label="xG en contra (media)"
            home={home_xg_form.avg_xg_against?.toFixed(2) ?? "—"}
            away={away_xg_form.avg_xg_against?.toFixed(2) ?? "—"}
          />
          <FormRow
            label="Rating Elo"
            home={home_elo !== null ? home_elo.toFixed(0) : "—"}
            away={away_elo !== null ? away_elo.toFixed(0) : "—"}
          />
        </tbody>
      </table>

      <h3>Enfrentamientos directos (últimos {h2h.matches_played})</h3>
      {h2h.matches_played === 0 ? (
        <p className="muted">Sin enfrentamientos previos registrados.</p>
      ) : (
        <p>
          {homeTeam} {h2h.team_a_wins} — {h2h.draws} — {h2h.team_b_wins} {awayTeam}
          {" "}
          <span className="muted">
            (goles {h2h.team_a_goals}-{h2h.team_b_goals})
          </span>
        </p>
      )}
    </div>
  );
}
