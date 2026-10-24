import { useId, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { Match, MatchHistory, MatchResult } from "../api/types";
import { t } from "../i18n";
import { formatSeason, withPercent } from "../lib/format";
import { leagueName } from "../lib/leagues";
import { cornerDuelForecast } from "../lib/cornerDuel";
import { PredictabilityChip } from "./Predictability";
import { MatchPickBlock } from "./MatchPick";
import {
  cornerDuelPicks,
  evidenceText,
  isModelMarket,
  MAX_PICKS,
  pickOutcome,
  priorMatches,
  probablePicks,
  RIVAL_STATE_LABEL,
  strengthLabel,
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

/** Acierto de los picks ya jugados de la temporada, por nivel de fuerza. */
interface SeasonRecord {
  /** "LaLiga" y "26/27": el ambito de las cifras. */
  league: string;
  season: string;
  /** Partido ya jugado: las cifras son las de antes de este partido. */
  played: boolean;
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
  const { t } = useTranslation();
  const picks = useMemo(() => (history ? probablePicks(match, history.matches, undefined, history.context ?? []) : []), [match, history]);
  const played = history?.played ?? null;
  // Nuevo: duelo de córners, aparte de los picks y de sus cifras.
  const duel = useMemo(
    () => (history ? cornerDuelForecast(match, priorMatches(match, history.matches)) : null),
    [match, history],
  );
  const duelPicks = useMemo(
    () =>
      history
        ? cornerDuelPicks(match, history.matches, history.context ?? []).map((pick) => ({
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
    league: leagueName(match.league_code),
    season: formatSeason(match.season),
    played: played !== null,
    byStrength: check.results ? summarizeByStrength(check.results) : null,
    byTeam,
  };
  const outcomes = played ? picks.map((pick) => pickOutcome(pick, played)) : [];
  const hits = outcomes.filter((o) => o === true).length;
  const decided = outcomes.filter((o) => o !== null).length;

  return (
    <div className="probable-picks">
      <p className="muted">{played ? t("picks:probable.introPlayed") : t("picks:probable.intro", { max: MAX_PICKS })}</p>
      {history && (
        <p className="predictability-line">
          <PredictabilityChip match={match} picks={picks} history={history.matches} showNote />
        </p>
      )}
      <MatchPickBlock match={match} />
      {played && picks.length > 0 && (
        <p className="picks-played-summary">
          <Trans i18nKey="picks:probable.playedSummary" values={{ hits, decided }} components={{ bold: <strong /> }} />
        </p>
      )}

      {loading && !history && <LoadingView label={t("picks:probable.loading")} />}
      {history?.context && history.context.length > 0 && <p className="small muted">{t("picks:probable.championsNote")}</p>}
      {error && <ErrorView message={t("picks:probable.error", { error })} />}
      {history && picks.length === 0 && <EmptyView message={t("picks:probable.empty")} />}

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
        <summary>{t("picks:probable.method.title")}</summary>
        <ul>
          <li>{t("picks:probable.method.pattern")}</li>
          <li>{t("picks:probable.method.contexts")}</li>
          <li>{t("picks:probable.method.lines")}</li>
          <li>{t("picks:probable.method.rival")}</li>
          <li>{t("picks:probable.method.strength")}</li>
        </ul>
      </details>

      <p className="small muted picks-disclaimer">
        {t("picks:probable.disclaimer")} <Link to="/picks-probables">{t("picks:probable.historyLink")}</Link>
      </p>
    </div>
  );
}

const OUTCOME_KEYS = { hit: "hit", miss: "miss", unknown: "unknown" } as const;

/** Marca del resultado de un pick: un circulo con ✓, ✗ o un guion. */
function OutcomeIcon({ outcome }: { outcome: keyof typeof OUTCOME_KEYS }) {
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
  const { t } = useTranslation();
  const { rate, rival } = pick;
  const perfect = rate.hits === rate.total;
  const hit = played ? pickOutcome(pick, played) : undefined;
  const outcome = hit === undefined ? null : hit === null ? "unknown" : hit ? "hit" : "miss";

  return (
    <li className={outcome ? `pick pick-${pick.strength} pick-played` : `pick pick-${pick.strength}`}>
      {outcome && (
        <p className={`pick-outcome pick-outcome-${outcome}`}>
          <OutcomeIcon outcome={outcome} />
          {t(`picks:outcome.${OUTCOME_KEYS[outcome]}`)}
        </p>
      )}
      <div className="pick-head">
        <TeamName team={pick.team} league={league} size="md" />
        <span className="pick-head-strength">
          <span className={`pick-strength pick-strength-${pick.strength}`} title={t("picks:strength.hint")}>
            {strengthLabel(pick.strength)}
          </span>
          <StrengthInfo record={record} level={pick.strength} />
        </span>
      </div>
      <TeamRecordLine record={record} teamId={pick.teamId} />

      <p className="pick-statement">
        {pick.text}
        {perfect && <span className="pick-perfect">{withPercent("100")}</span>}
      </p>
      <p className="pick-evidence">
        {evidenceText(rate.hits, rate.total, pick.context)}.
        {sampleTier(rate.total) === "low" && <SampleBadge matchesUsed={rate.total} />}
      </p>
      {pick.leagueRate !== null && (
        <p className="pick-league small muted">{t("picks:probable.leagueRate", { pct: pct(pick.leagueRate) })}</p>
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
          {t("picks:probable.modelLink")}
        </a>
      )}
    </li>
  );
}

const pct = (x: number | null) => (x === null ? "—" : withPercent(String(Math.round(x * 100))));

/** Acierto de los picks del equipo esta temporada, en fuerza alta y media,
 * siempre con cuantos picks hay detras. */
function TeamRecordLine({ record, teamId }: { record: SeasonRecord; teamId: number }) {
  const { t } = useTranslation();
  if (record.byTeam === null) return <p className="pick-team-record small muted">{t("picks:teamRecord.calculating")}</p>;
  const team = record.byTeam.get(teamId);
  const scope = { season: record.season };
  if (!team || team.top.total === 0) {
    return (
      <p className="pick-team-record small muted">
        {t(record.played ? "picks:teamRecord.nonePlayed" : "picks:teamRecord.none", scope)}
      </p>
    );
  }
  const level = (key: "high" | "medium", s: PicksSummary) =>
    s.total === 0 ? (
      <span>{t(`picks:teamRecord.${key}None`)}</span>
    ) : (
      <span>
        <Trans
          i18nKey={`picks:teamRecord.${key}`}
          values={{ pct: pct(s.rate), total: s.total }}
          components={{ bold: <strong /> }}
        />
      </span>
    );
  return (
    <p className="pick-team-record small">
      <span className="muted">{t(record.played ? "picks:teamRecord.prefixPlayed" : "picks:teamRecord.prefix", scope)}</span>{" "}
      {level("high", team.alta)}
      <span className="muted"> · </span>
      {level("medium", team.media)}
    </p>
  );
}

/** La "i" junto a la fuerza: cuanto llevan acertado esta temporada los picks
 * de fuerza alta y media (y baja, si el pick es de ese nivel). Con raton se
 * abre al pasar por encima; en tactil y con teclado, al pulsarla. */
function StrengthInfo({ record, level }: { record: SeasonRecord; level: Strength }) {
  const { t } = useTranslation();
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
        aria-label={t("picks:strengthInfo.label")}
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
          <span className="pick-info-title">
            {t(record.played ? "picks:strengthInfo.titlePlayed" : "picks:strengthInfo.title", {
              league: record.league,
              season: record.season,
            })}
          </span>
          {by === null ? (
            <span className="pick-info-row">{t("picks:strengthInfo.calculating")}</span>
          ) : by.total.total === 0 ? (
            <span className="pick-info-row">{t("picks:strengthInfo.none")}</span>
          ) : (
            levels.map((l) => (
              <span key={l} className={l === level ? "pick-info-row pick-info-current" : "pick-info-row"}>
                <span>{strengthLabel(l)}</span>
                <strong>{pct(by[l].rate)}</strong>
                <span className="pick-info-n">{t("picks:strengthInfo.count", { hits: by[l].hits, total: by[l].total })}</span>
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
  if (!rival.crossable) return t("picks:rivalSentence.notCrossable");
  if (!rival.rate || !rival.context || rival.rate.total === 0) return t("picks:rivalSentence.noMatches");
  const sentence = pick.matchLevel
    ? t("picks:rivalSentence.match", { evidence: evidenceText(rival.rate.hits, rival.rate.total, rival.context) })
    : t("picks:rivalSentence.team", {
        event: rival.text,
        evidence: evidenceText(rival.rate.hits, rival.rate.total, rival.context, true),
      });
  return rival.state === "none" ? `${sentence} ${t("picks:rivalSentence.fewMatches")}` : sentence;
}
