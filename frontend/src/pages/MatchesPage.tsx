import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getLeagues } from "../api/client";
import { LeagueSwitch } from "../components/LeagueSwitch";
import { MatchdayBrowser } from "../components/MatchdayBrowser";
import { leagueParam, orderLeagues, parseLeagueParam, useSelectedLeagueCode } from "../lib/leagues";
import { useApi } from "../lib/useApi";

export function MatchesPage() {
  const [storedCode, setStoredCode] = useSelectedLeagueCode();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: leagues } = useApi(() => getLeagues(), []);

  // La URL manda: con un ?liga= valido se ve esa liga; sin el, o con uno que
  // no vale, la elegida en el resto de la web (como antes).
  const param = searchParams.get("liga");
  const fromUrl = leagues ? parseLeagueParam(param, leagues) : undefined;
  const leagueCode = fromUrl !== undefined ? fromUrl : storedCode;
  const league = leagues?.find((l) => l.code === leagueCode);

  const writeParam = (value: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("liga", value);
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
      <h1>Partidos</h1>
      <p className="intro-note small muted">
        Los porcentajes que ves aquí son <strong>frecuencia histórica</strong>, no una promesa de lo que va a pasar:
        cuentan cuántas veces ocurrió algo antes, siempre junto al número de partidos usado. No es lo mismo que una
        probabilidad garantizada. <Link to="/glosario">Más sobre cómo leerlos →</Link>
      </p>

      <LeagueSwitch leagues={leagues} value={leagueCode} onChange={changeLeague} allowAll />

      {/* La key reinicia temporada y jornada al cambiar de liga. */}
      {league && <MatchdayBrowser key={league.id} league={league} />}
      {leagues && leagueCode === null &&
        orderLeagues(leagues).map((l) => <MatchdayBrowser key={l.id} league={l} showTitle />)}
    </div>
  );
}
