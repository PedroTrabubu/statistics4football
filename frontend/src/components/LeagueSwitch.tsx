import type { League } from "../api/types";
import { leagueCountry, leagueName, orderLeagues } from "../lib/leagues";

/** Botones grandes para elegir liga (LaLiga siempre primero). Con
 * `allowAll`, un boton mas para ver todas las ligas a la vez (value null). */
export function LeagueSwitch({
  leagues,
  value,
  onChange,
  allowAll = false,
}: {
  leagues: League[] | null;
  value: string | null;
  onChange: (code: string | null) => void;
  allowAll?: boolean;
}) {
  if (!leagues) return <div className="league-switch league-switch-loading" />;

  return (
    <div className="league-switch" role="group" aria-label="Liga">
      {orderLeagues(leagues).map((league) => (
        <button
          key={league.id}
          type="button"
          aria-pressed={value === league.code}
          className={value === league.code ? "league-button league-button-active" : "league-button"}
          onClick={() => onChange(league.code)}
        >
          <span className="league-button-name">{leagueName(league.code)}</span>
          {leagueCountry(league.code) && <span className="league-button-country">{leagueCountry(league.code)}</span>}
        </button>
      ))}
      {allowAll && (
        <button
          type="button"
          aria-pressed={value === null}
          className={value === null ? "league-button league-button-all league-button-active" : "league-button league-button-all"}
          onClick={() => onChange(null)}
        >
          <span className="league-button-name">{leagues.length === 2 ? "Ambas" : "Todas"}</span>
        </button>
      )}
    </div>
  );
}
