import { useId } from "react";
import type { Match, MatchResult } from "../api/types";
import type { DuelForecast } from "../lib/cornerDuel";
import { evidenceText, RIVAL_STATE_LABEL, type ProbablePick, type Strength } from "../lib/patterns";

const STRENGTH_LABEL: Record<Strength, string> = { alta: "Fuerza alta", media: "Fuerza media", baja: "Fuerza baja" };

const pct = (p: number) => `${Math.round(p * 100)} %`;

interface DuelPick {
  pick: ProbablePick;
  /** Partido jugado: si se cumplió (null sin dato). */
  hit?: boolean | null;
}

/** El duelo del partido ya jugado: córners de cada uno y quién lo ganó. */
function playedDuel(played: MatchResult | null): { home: number; away: number } | null {
  const home = played?.home_stats?.corners;
  const away = played?.away_stats?.corners;
  return home === null || home === undefined || away === null || away === undefined ? null : { home, away };
}

function DuelPickItem({ pick, hit }: DuelPick) {
  const outcome = hit === undefined ? null : hit === null ? "Sin dato" : hit ? "Se cumplió" : "No se cumplió";
  return (
    <li className={`duel-pick${hit === true ? " duel-pick-hit" : hit === false ? " duel-pick-miss" : ""}`}>
      <div className="duel-pick-head">
        <span className="duel-pick-label">Pick muy probable</span>
        <span className={`pick-strength pick-strength-${pick.strength}`}>{STRENGTH_LABEL[pick.strength]}</span>
        {outcome && <span className="duel-pick-outcome">{outcome}</span>}
      </div>
      <p className="duel-pick-text">
        <strong>{pick.team}</strong>: {pick.text.charAt(0).toLowerCase() + pick.text.slice(1)}
      </p>
      <p className="small muted">
        {evidenceText(pick.rate.hits, pick.rate.total, pick.context)}.{" "}
        {RIVAL_STATE_LABEL[pick.rival.state]}
        {pick.rival.rate && pick.rival.rate.total > 0
          ? `: ${pick.rival.team}, ${pick.rival.text.charAt(0).toLowerCase() + pick.rival.text.slice(1)} en ${pick.rival.rate.hits} de ${pick.rival.rate.total}.`
          : "."}
      </p>
    </li>
  );
}

/** Bloque nuevo: probabilidades del duelo de córners (modelo de
 * lib/cornerDuel.ts) y, si el motor lo detecta, el pick muy probable con su
 * cruce. `compact`: una línea para las tarjetas de la página de picks. */
export function CornerDuel({
  match,
  forecast,
  picks,
  played = null,
  compact = false,
}: {
  match: Pick<Match, "home_team" | "away_team">;
  forecast: DuelForecast | null;
  picks: DuelPick[];
  played?: MatchResult | null;
  compact?: boolean;
}) {
  const titleId = useId();
  const result = playedDuel(played);

  if (compact) {
    return (
      <div className="corner-duel corner-duel-compact">
        <p className="small">
          <strong>Duelo de córners</strong>
          {forecast ? (
            <>
              : {match.home_team} {pct(forecast.home)} · mismos {pct(forecast.draw)} · {match.away_team} {pct(forecast.away)}
            </>
          ) : (
            ": sin datos de córners"
          )}
          {result && (
            <span className="duel-played">
              {" "}
              · córners: {match.home_team} {result.home} - {result.away} {match.away_team}
            </span>
          )}
        </p>
        {picks.length > 0 && (
          <ul className="duel-picks">
            {picks.map((p) => (
              <DuelPickItem key={`${p.pick.side}-${p.pick.option.key}`} {...p} />
            ))}
          </ul>
        )}
      </div>
    );
  }

  const winner = result ? (result.home > result.away ? match.home_team : result.away > result.home ? match.away_team : null) : null;
  return (
    <section className="corner-duel" aria-labelledby={titleId}>
      <div className="corner-duel-head">
        <h3 id={titleId}>Duelo de córners</h3>
      </div>
      {forecast === null ? (
        <p className="small muted">Todavía no hay córners de la liga con los que calcularlo.</p>
      ) : (
        <>
          <div className="duel-bar" aria-hidden="true">
            <span className="duel-bar-home" style={{ width: `${forecast.home * 100}%` }} />
            <span className="duel-bar-draw" style={{ width: `${forecast.draw * 100}%` }} />
            <span className="duel-bar-away" style={{ width: `${forecast.away * 100}%` }} />
          </div>
          <dl className="duel-probs">
            <div>
              <dt>{match.home_team} saca más</dt>
              <dd>{pct(forecast.home)}</dd>
            </div>
            <div>
              <dt>Los mismos</dt>
              <dd>{pct(forecast.draw)}</dd>
            </div>
            <div>
              <dt>{match.away_team} saca más</dt>
              <dd>{pct(forecast.away)}</dd>
            </div>
          </dl>
          <p className="small">
            No pierde el duelo: {match.home_team} {pct(forecast.homeNotLose)} · {match.away_team}{" "}
            {pct(forecast.awayNotLose)}. Córners esperados: {forecast.homeExpected.toFixed(1)} -{" "}
            {forecast.awayExpected.toFixed(1)}.
          </p>
        </>
      )}
      {result && (
        <p className="duel-result">
          Córners del partido: {match.home_team} {result.home} - {result.away} {match.away_team}
          {winner ? `, ganó el duelo ${winner}` : ", empate"}.
        </p>
      )}
      {picks.length > 0 && (
        <ul className="duel-picks">
          {picks.map((p) => (
            <DuelPickItem key={`${p.pick.side}-${p.pick.option.key}`} {...p} />
          ))}
        </ul>
      )}
      <p className="small muted">
        Bloque nuevo, aparte de los picks de arriba y de sus cifras de acierto. Probabilidades de un modelo de córners con
        los partidos anteriores: lo que saca cada equipo en su campo y lo que concede el rival, con más peso a lo reciente y
        acercado a la media de la liga cuando hay pocos partidos. "Pick muy probable" solo cuando el patrón cumple el umbral
        del resto de picks.
        {forecast && ` Muestra: ${forecast.homeMatches} partidos del local en casa y ${forecast.awayMatches} del visitante fuera.`}
      </p>
    </section>
  );
}
