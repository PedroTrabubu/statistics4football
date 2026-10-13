import { useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Match, MatchHistory, MatchResult } from "../api/types";
import { formatSeason } from "../lib/format";
import { leagueName } from "../lib/leagues";
import { cornerDuelForecast } from "../lib/cornerDuel";
import {
  cornerDuelPicks,
  evidenceText,
  isModelMarket,
  MAX_PICKS,
  pickOutcome,
  priorMatches,
  probablePicks,
  RIVAL_STATE_LABEL,
  summarizeByStrength,
  summarizeByTeam,
  type PicksSummary,
  type ProbablePick,
  type Strength,
  type TeamPicksRecord,
} from "../lib/patterns";
import { sampleTier } from "../lib/sampleLevel";
import { usePlayedPicks } from "../lib/usePlayedPicks";
import { CornerDuel } from "./CornerDuel";
import { SampleBadge } from "./SampleBadge";
import { EmptyView, ErrorView, LoadingView } from "./StatusView";
import { TeamName } from "./TeamCrest";

const STRENGTH_LABEL: Record<Strength, string> = {
  alta: "Fuerza alta",
  media: "Fuerza media",
  baja: "Fuerza baja",
};

const STRENGTH_HINT =
  "Partidos de los dos equipos juntos, con el límite inferior de Wilson al 95 %. Alta: el rival lo respalda y el límite es al menos 0.75. Media: al menos 0.60 y el rival no lo contradice. Baja: el resto.";

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** Acierto de los picks ya jugados de la temporada, por nivel de fuerza. */
interface SeasonRecord {
  /** "LaLiga 26/27" o, en un partido ya jugado, "LaLiga 25/26, antes de este partido". */
  scope: string;
  /** "en 26/27" o "en 25/26 antes de este partido": para la linea de cada equipo. */
  teamScope: string;
  byStrength: Record<Strength | "total", PicksSummary> | null;
  /** Por equipo (los picks de su historial); null mientras se calcula. */
  byTeam: Map<number, TeamPicksRecord> | null;
}

/** Patrones de alta frecuencia de los dos equipos, contrastados con el rival.
 * Frecuencia historica: nunca una promesa. */
export function ProbablePicks({
  match,
  history,
  loading,
  error,
}: {
  match: Match;
  history: MatchHistory | null;
  loading: boolean;
  error: string | null;
}) {
  const picks = useMemo(() => (history ? probablePicks(match, history.matches) : []), [match, history]);
  const played = history?.played ?? null;
  // Nuevo: duelo de córners, aparte de los picks y de sus cifras.
  const duel = useMemo(
    () => (history ? cornerDuelForecast(match, priorMatches(match, history.matches)) : null),
    [match, history],
  );
  const duelPicks = useMemo(
    () =>
      history
        ? cornerDuelPicks(match, history.matches).map((pick) => ({
            pick,
            hit: played ? pickOutcome(pick, played) : undefined,
          }))
        : [],
    [match, history, played],
  );

  // Lo que llevan acertado los picks de esta temporada: los partidos ya jugados
  // del historial (todos, si este aun no se ha jugado). Misma cuenta y misma
  // cache que la pagina de historico.
  const seasonData = useMemo(
    () =>
      history
        ? {
            key: `${match.league_id}|${match.season}`,
            played: history.matches.filter((m) => m.season === match.season),
            history: history.matches,
          }
        : null,
    [history, match.league_id, match.season],
  );
  const check = usePlayedPicks(seasonData);
  const byTeam = useMemo(
    () => (check.results ? new Map(summarizeByTeam(check.results).map((r) => [r.teamId, r])) : null),
    [check.results],
  );
  const record: SeasonRecord = {
    scope: `${leagueName(match.league_code)} ${formatSeason(match.season)}${played ? ", antes de este partido" : ""}`,
    teamScope: `en ${formatSeason(match.season)}${played ? " antes de este partido" : ""}`,
    byStrength: check.results ? summarizeByStrength(check.results) : null,
    byTeam,
  };
  const outcomes = played ? picks.map((pick) => pickOutcome(pick, played)) : [];
  const hits = outcomes.filter((o) => o === true).length;
  const decided = outcomes.filter((o) => o !== null).length;

  return (
    <div className="probable-picks">
      <p className="muted">
        {played
          ? "Partido ya jugado: los picks que se mostraban antes, calculados solo con los partidos anteriores, y si se cumplieron."
          : `Lo que más se ha repetido en los partidos anteriores de cada equipo, y si el rival hace probable que se repita. Como mucho ${MAX_PICKS}, de más a menos fuerza.`}
      </p>
      {played && picks.length > 0 && (
        <p className="picks-played-summary">
          Se cumplieron <strong>{hits}</strong> de {decided}.
        </p>
      )}

      {loading && !history && <LoadingView label="Buscando patrones..." />}
      {error && <ErrorView message={`No se pudo cargar el historial de los equipos: ${error}`} />}
      {history && picks.length === 0 && <EmptyView message="No hay patrones con suficiente muestra para este partido." />}

      {picks.length > 0 && (
        <ol className="picks-list">
          {picks.map((pick) => (
            <PickCard
              key={`${pick.side}-${pick.family}-${pick.option.key}`}
              pick={pick}
              league={match.league_code}
              played={played}
              record={record}
            />
          ))}
        </ol>
      )}

      {history && <CornerDuel match={match} forecast={duel} picks={duelPicks} played={played} />}

      <details className="picks-method">
        <summary>Cómo se calcula</summary>
        <ul>
          <li>
            Un patrón es algo que ha pasado al menos en el 80 % de los partidos anteriores de un equipo, en esta misma
            liga: con 5 partidos si pasó en todos y con 8 si no. Nunca cuentan este partido ni los posteriores.
          </li>
          <li>
            Se mira en el campo de este partido y en todos, esta temporada y en sus últimos 10 partidos en ese campo o
            20 en total, que pueden incluir la temporada anterior.
          </li>
          <li>
            De cada estadística solo sale la línea más exigente que se cumple. No sale lo que en toda la liga ya pasa en
            el 80 % de los partidos.
          </li>
          <li>
            El contraste mira lo complementario en el rival, en su campo y con el mismo tipo de periodo: si un equipo
            marca fuera, si el otro encaja en casa. Respaldado: el rival también lo cumple, con muestra suficiente.
            Parcial: lo cumple al menos en la mitad de sus partidos. No respaldado: en menos.
          </li>
          <li>
            Fuerza: se juntan los partidos de los dos equipos y se toma el límite inferior del intervalo de Wilson al
            95 %, que penaliza las muestras pequeñas (5 de 5 da 0.57; 20 de 20, 0.84). Alta: el rival lo respalda y el
            límite es al menos 0.75. Media: al menos 0.60 y el rival no lo contradice. Baja: el resto.
          </li>
        </ul>
      </details>

      <p className="small muted picks-disclaimer">
        Patrones históricos de alta frecuencia. No son predicciones garantizadas ni recomendaciones de apuesta.{" "}
        <Link to="/picks-probables">¿Se cumplen? Mira las jornadas anteriores y el acierto de cada equipo →</Link>
      </p>
    </div>
  );
}

const OUTCOME_LABEL = { hit: "Se cumplió", miss: "No se cumplió", unknown: "Sin dato en el partido" };

/** Marca del resultado de un pick: un circulo con ✓, ✗ o un guion. */
function OutcomeIcon({ outcome }: { outcome: keyof typeof OUTCOME_LABEL }) {
  return (
    <svg className="pick-outcome-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="11" />
      {outcome === "hit" && <path d="M6.8 12.4l3.4 3.4 7-7.4" />}
      {outcome === "miss" && <path d="M8 8l8 8M16 8l-8 8" />}
      {outcome === "unknown" && <path d="M7.5 12h9" />}
    </svg>
  );
}

function PickCard({
  pick,
  league,
  played,
  record,
}: {
  pick: ProbablePick;
  league: string;
  played: MatchResult | null;
  record: SeasonRecord;
}) {
  const { rate, rival } = pick;
  const perfect = rate.hits === rate.total;
  const hit = played ? pickOutcome(pick, played) : undefined;
  const outcome = hit === undefined ? null : hit === null ? "unknown" : hit ? "hit" : "miss";

  return (
    <li className={outcome ? `pick pick-${pick.strength} pick-played` : `pick pick-${pick.strength}`}>
      {outcome && (
        <p className={`pick-outcome pick-outcome-${outcome}`}>
          <OutcomeIcon outcome={outcome} />
          {OUTCOME_LABEL[outcome]}
        </p>
      )}
      <div className="pick-head">
        <TeamName team={pick.team} league={league} size="md" />
        <span className="pick-head-strength">
          <span className={`pick-strength pick-strength-${pick.strength}`} title={STRENGTH_HINT}>
            {STRENGTH_LABEL[pick.strength]}
          </span>
          <StrengthInfo record={record} level={pick.strength} />
        </span>
      </div>
      <TeamRecordLine record={record} teamId={pick.teamId} />

      <p className="pick-statement">
        {pick.text}
        {perfect && <span className="pick-perfect">100 %</span>}
      </p>
      <p className="pick-evidence">
        {evidenceText(rate.hits, rate.total, pick.context)}.
        {sampleTier(rate.total) === "low" && <SampleBadge matchesUsed={rate.total} />}
      </p>
      {pick.leagueRate !== null && (
        <p className="pick-league small muted">En toda la liga: {Math.round(pick.leagueRate * 100)} %.</p>
      )}

      <div className={`pick-rival pick-rival-${rival.state}`}>
        <span className="pick-rival-state">{RIVAL_STATE_LABEL[rival.state]}</span>
        <p className="pick-rival-text">
          <TeamName team={rival.team} league={league} />
          <span>{rivalSentence(pick)}</span>
        </p>
      </div>

      {isModelMarket(pick) && (
        <a href="#probabilidades" className="pick-ev-link small">
          Ver la probabilidad del modelo para este mercado ↓
        </a>
      )}
    </li>
  );
}

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)} %`);

/** Acierto de los picks del equipo esta temporada, en fuerza alta y media,
 * siempre con cuantos picks hay detras. */
function TeamRecordLine({ record, teamId }: { record: SeasonRecord; teamId: number }) {
  if (record.byTeam === null) return <p className="pick-team-record small muted">Calculando su acierto...</p>;
  const team = record.byTeam.get(teamId);
  if (!team || team.top.total === 0) {
    return <p className="pick-team-record small muted">Sus picks {record.teamScope}: aún ninguno comprobado.</p>;
  }
  const level = (label: string, s: PicksSummary) =>
    s.total === 0 ? (
      <span>{label}: ninguno</span>
    ) : (
      <span>
        {label} <strong>{pct(s.rate)}</strong> de {s.total}
      </span>
    );
  return (
    <p className="pick-team-record small">
      <span className="muted">Sus picks {record.teamScope}:</span> {level("alta", team.alta)}
      <span className="muted"> · </span>
      {level("media", team.media)}
    </p>
  );
}

/** La "i" junto a la fuerza: cuanto llevan acertado esta temporada los picks
 * de fuerza alta y media (y baja, si el pick es de ese nivel). Con raton se
 * abre al pasar por encima; en tactil y con teclado, al pulsarla. */
function StrengthInfo({ record, level }: { record: SeasonRecord; level: Strength }) {
  const [open, setOpen] = useState(false);
  // Abierta por el raton encima: el click no debe cerrarla. En tactil no hay
  // "encima", y el toque la abre o la cierra.
  const hovering = useRef(false);
  const id = useId();
  const levels: Strength[] = level === "baja" ? ["alta", "media", "baja"] : ["alta", "media"];
  const by = record.byStrength;

  return (
    <span
      className="pick-info"
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        hovering.current = true;
        setOpen(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        hovering.current = false;
        setOpen(false);
      }}
    >
      <button
        type="button"
        className="pick-info-button"
        aria-label="Acierto de los picks por nivel de fuerza"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => hovering.current || !v)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        onBlur={() => setOpen(false)}
      >
        i
      </button>
      {open && (
        <span className="pick-info-popover" id={id} role="tooltip">
          <span className="pick-info-title">Acierto en {record.scope}</span>
          {by === null ? (
            <span className="pick-info-row">Calculando...</span>
          ) : by.total.total === 0 ? (
            <span className="pick-info-row">Aún no hay picks comprobados esta temporada.</span>
          ) : (
            levels.map((l) => (
              <span key={l} className={l === level ? "pick-info-row pick-info-current" : "pick-info-row"}>
                <span>{STRENGTH_LABEL[l]}</span>
                <strong>{pct(by[l].rate)}</strong>
                <span className="pick-info-n">
                  {by[l].hits} de {by[l].total}
                </span>
              </span>
            ))
          )}
        </span>
      )}
    </span>
  );
}

/** Lo que hizo el rival, con su muestra. */
function rivalSentence(pick: ProbablePick): string {
  const { rival } = pick;
  if (!rival.crossable) return "No hay una estadística del rival que lo complemente.";
  if (!rival.rate || !rival.context || rival.rate.total === 0) return "Sin partidos anteriores comparables.";
  const evidence = evidenceText(rival.rate.hits, rival.rate.total, rival.context);
  const sentence = pick.matchLevel ? `${evidence}.` : `${rival.text} ${lowerFirst(evidence)}.`;
  return rival.state === "none" ? `${sentence} Muy pocos partidos para contrastarlo.` : sentence;
}
