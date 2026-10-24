import { useId } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { Match, MatchResult } from "../api/types";
import type { DuelForecast } from "../lib/cornerDuel";
import { formatFixed, withPercent } from "../lib/format";
import { duelInlineText, evidenceText, RIVAL_STATE_LABEL, strengthLabel, type ProbablePick } from "../lib/patterns";

const pct = (p: number) => withPercent(String(Math.round(p * 100)));

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
  const { t } = useTranslation();
  const outcome =
    hit === undefined ? null : hit === null ? t("picks:duel.noData") : hit ? t("picks:outcome.hit") : t("picks:outcome.miss");
  const evidence = evidenceText(pick.rate.hits, pick.rate.total, pick.context);
  const state = RIVAL_STATE_LABEL[pick.rival.state];
  return (
    <li className={`duel-pick${hit === true ? " duel-pick-hit" : hit === false ? " duel-pick-miss" : ""}`}>
      <div className="duel-pick-head">
        <span className="duel-pick-label">{t("picks:duel.pickLabel")}</span>
        <span className={`pick-strength pick-strength-${pick.strength}`}>{strengthLabel(pick.strength)}</span>
        {outcome && <span className="duel-pick-outcome">{outcome}</span>}
      </div>
      <p className="duel-pick-text">
        <Trans
          i18nKey="picks:duel.pickText"
          values={{ team: pick.team, text: duelInlineText(pick, false) }}
          components={{ bold: <strong /> }}
        />
      </p>
      <p className="small muted">
        {pick.rival.rate && pick.rival.rate.total > 0
          ? t("picks:duel.evidenceWithRival", {
              evidence,
              state,
              team: pick.rival.team,
              text: duelInlineText(pick, true),
              hits: pick.rival.rate.hits,
              count: pick.rival.rate.total,
            })
          : t("picks:duel.evidenceNoRival", { evidence, state })}
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
  const { t } = useTranslation();
  const titleId = useId();
  const result = playedDuel(played);
  const teams = { home: match.home_team, away: match.away_team };

  if (compact) {
    return (
      <div className="corner-duel corner-duel-compact">
        <p className="small">
          <Trans
            i18nKey={forecast ? "picks:duel.compact" : "picks:duel.compactNoData"}
            values={
              forecast
                ? { ...teams, homePct: pct(forecast.home), drawPct: pct(forecast.draw), awayPct: pct(forecast.away) }
                : undefined
            }
            components={{ bold: <strong /> }}
          />
          {result && (
            <span className="duel-played">
              {" "}
              {t("picks:duel.compactPlayed", { ...teams, homeCorners: result.home, awayCorners: result.away })}
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
        <h3 id={titleId}>{t("picks:duel.title")}</h3>
      </div>
      {forecast === null ? (
        <p className="small muted">{t("picks:duel.empty")}</p>
      ) : (
        <>
          <div className="duel-bar" aria-hidden="true">
            <span className="duel-bar-home" style={{ width: `${forecast.home * 100}%` }} />
            <span className="duel-bar-draw" style={{ width: `${forecast.draw * 100}%` }} />
            <span className="duel-bar-away" style={{ width: `${forecast.away * 100}%` }} />
          </div>
          <dl className="duel-probs">
            <div>
              <dt>{t("picks:duel.teamMore", { team: match.home_team })}</dt>
              <dd>{pct(forecast.home)}</dd>
            </div>
            <div>
              <dt>{t("picks:duel.same")}</dt>
              <dd>{pct(forecast.draw)}</dd>
            </div>
            <div>
              <dt>{t("picks:duel.teamMore", { team: match.away_team })}</dt>
              <dd>{pct(forecast.away)}</dd>
            </div>
          </dl>
          <p className="small">
            {t("picks:duel.summary", {
              ...teams,
              homePct: pct(forecast.homeNotLose),
              awayPct: pct(forecast.awayNotLose),
              homeExpected: formatFixed(forecast.homeExpected, 1),
              awayExpected: formatFixed(forecast.awayExpected, 1),
            })}
          </p>
        </>
      )}
      {result && (
        <p className="duel-result">
          {winner
            ? t("picks:duel.resultWinner", { ...teams, homeCorners: result.home, awayCorners: result.away, winner })
            : t("picks:duel.resultDraw", { ...teams, homeCorners: result.home, awayCorners: result.away })}
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
        {t("picks:duel.note")}
        {forecast && ` ${t("picks:duel.noteSample", { home: forecast.homeMatches, away: forecast.awayMatches })}`}
      </p>
    </section>
  );
}
