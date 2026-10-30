import { useEffect } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { QUERY, ROUTES } from "../lib/routes";
import { getLeagues } from "../api/client";
import { LeagueSwitch } from "../components/LeagueSwitch";
import { MatchdayBrowser } from "../components/MatchdayBrowser";
import { NextMatchesCard } from "../components/NextMatchesCard";
import { PageHero } from "../components/PageHero";
import { leagueName, leagueParam, orderLeagues, parseLeagueParam, useSelectedLeagueCode } from "../lib/leagues";
import { useApi } from "../lib/useApi";

export function MatchesPage() {
  const { t } = useTranslation();
  const [storedCode, setStoredCode] = useSelectedLeagueCode();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: leagues } = useApi(() => getLeagues(), []);

  // La URL manda: con un ?league= valido se ve esa liga; sin el, o con uno que
  // no vale, la elegida en el resto de la web (como antes).
  const param = searchParams.get(QUERY.league);
  const fromUrl = leagues ? parseLeagueParam(param, leagues) : undefined;
  const leagueCode = fromUrl !== undefined ? fromUrl : storedCode;
  const league = leagues?.find((l) => l.code === leagueCode);

  const writeParam = (value: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(QUERY.league, value);
        return next;
      },
      // Cambiar de liga no deja una entrada nueva en el historial.
      { replace: true },
    );

  // La liga del enlace pasa a ser la elegida en toda la web, y la URL refleja
  // siempre la que se ve: asi se mantiene al recargar o abrir otra pestaña.
  useEffect(() => {
    if (!leagues) return;
    if (leagueCode !== storedCode) setStoredCode(leagueCode);
    const wanted = leagueCode === null ? leagueParam(null) : league ? leagueParam(league) : null;
    if (wanted !== null && param !== wanted) writeParam(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagues, leagueCode, storedCode, league, param]);

  const changeLeague = (code: string | null) => {
    setStoredCode(code);
    const next = code === null ? null : leagues?.find((l) => l.code === code);
    if (next !== undefined) writeParam(leagueParam(next));
  };

  return (
    <div>
      <PageHero
        eyebrow={leagueCode === null ? t("common:league.all") : leagueName(leagueCode)}
        title={t("nav:matches")}
        accentWords={0}
        lead={
          <p>
            <Trans
              i18nKey="matches:page.intro"
              components={{ bold: <strong />, anchor: <Link to={ROUTES.glossary} /> }}
            />
          </p>
        }
        aside={league ? <NextMatchesCard league={league} /> : undefined}
      />

      <LeagueSwitch leagues={leagues} value={leagueCode} onChange={changeLeague} allowAll />

      {/* La key reinicia temporada y jornada al cambiar de liga. */}
      {league && <MatchdayBrowser key={league.id} league={league} />}
      {leagues && leagueCode === null &&
        orderLeagues(leagues).map((l) => <MatchdayBrowser key={l.id} league={l} showTitle />)}
    </div>
  );
}
