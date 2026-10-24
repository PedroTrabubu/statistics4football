import { useTranslation } from "react-i18next";
import type { League } from "../api/types";
import { leagueCountry, leagueName, leagueShortName, orderLeagues } from "../lib/leagues";
import { LeagueLogo } from "./LeagueLogo";

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
  const { t } = useTranslation();
  if (!leagues) return <div className="league-switch league-switch-loading" />;

  return (
    <div className="league-switch" role="group" aria-label={t("common:league.label")}>
      {orderLeagues(leagues).map((league) => (
        <button
          key={league.id}
          type="button"
          aria-pressed={value === league.code}
          className={value === league.code ? "league-button league-button-active" : "league-button"}
          onClick={() => onChange(league.code)}
        >
          <LeagueLogo code={league.code} />
          <span className="league-button-text">
            <span className="league-button-name">
              <span className="league-name-full">{leagueName(league.code)}</span>
              <span className="league-name-short">{leagueShortName(league.code)}</span>
            </span>
            {leagueCountry(league.code) && <span className="league-button-country">{leagueCountry(league.code)}</span>}
          </span>
        </button>
      ))}
      {allowAll && (
        <button
          type="button"
          aria-pressed={value === null}
          className={value === null ? "league-button league-button-all league-button-active" : "league-button league-button-all"}
          onClick={() => onChange(null)}
        >
          <span className="league-button-name">{leagues.length === 2 ? t("common:league.both") : t("common:league.all")}</span>
        </button>
      )}
    </div>
  );
}
