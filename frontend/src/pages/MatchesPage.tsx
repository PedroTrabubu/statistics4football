import { Link } from "react-router-dom";
import { getLeagues } from "../api/client";
import { LeagueSwitch } from "../components/LeagueSwitch";
import { MatchdayBrowser } from "../components/MatchdayBrowser";
import { orderLeagues, useSelectedLeagueCode } from "../lib/leagues";
import { useApi } from "../lib/useApi";

export function MatchesPage() {
  const [leagueCode, setLeagueCode] = useSelectedLeagueCode();
  const { data: leagues } = useApi(() => getLeagues(), []);
  const league = leagues?.find((l) => l.code === leagueCode);

  return (
    <div>
      <h1>Partidos</h1>
      <p className="intro-note small muted">
        Los porcentajes que ves aquí son <strong>frecuencia histórica</strong>, no una promesa de lo que va a pasar:
        cuentan cuántas veces ocurrió algo antes, siempre junto al número de partidos usado. No es lo mismo que una
        probabilidad garantizada. <Link to="/glosario">Más sobre cómo leerlos →</Link>
      </p>

      <LeagueSwitch leagues={leagues} value={leagueCode} onChange={setLeagueCode} allowAll />

      {/* La key reinicia temporada y jornada al cambiar de liga. */}
      {league && <MatchdayBrowser key={league.id} league={league} />}
      {leagues && leagueCode === null &&
        orderLeagues(leagues).map((l) => <MatchdayBrowser key={l.id} league={l} showTitle />)}
    </div>
  );
}
