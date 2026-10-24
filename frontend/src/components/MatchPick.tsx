import { Trans, useTranslation } from "react-i18next";
import { getMatchPicks } from "../api/client";
import type { Match, MatchPick, MatchPickKind, MatchPicksResponse } from "../api/types";
import { t } from "../i18n";
import { formatSignedPoints as pts, withPercent } from "../lib/format";
import { matchPickKindLabel, matchPickNote, matchPickText } from "../lib/matchPick";
import { useApi } from "../lib/useApi";
import { LoadingView } from "./StatusView";

const pct = (x: number) => withPercent(String(Math.round(x * 100)));

function kindSentence(key: string, kind: MatchPickKind | undefined): string | null {
  if (!kind) return null;
  return t("picks:matchPick.kindSentence", {
    kind: matchPickKindLabel(key),
    hitRate: pct(kind.hit_rate),
    base: pct(kind.base),
    edge: pts(kind.edge),
    low: pts(kind.low),
    high: pts(kind.high),
    count: kind.n,
  });
}

function Outcome({ hit }: { hit: boolean | null }) {
  const { t } = useTranslation();
  if (hit === null) return null;
  return <span className={hit ? "edge-up" : "edge-down"}>{hit ? t("picks:matchPick.hit") : t("picks:matchPick.miss")}</span>;
}

/** Bloque de la ficha de partido. */
export function MatchPickBlock({ match }: { match: Match }) {
  const { t } = useTranslation();
  const { data, loading, error } = useApi(() => getMatchPicks([match.id]), [match.id]);
  const entry = data?.matches[String(match.id)];
  return (
    <section className="match-pick">
      <h3>{t("picks:matchPick.title")}</h3>
      {loading && !data && <LoadingView label={t("picks:matchPick.calculating")} />}
      {error && <p className="small muted">{t("picks:matchPick.error", { error })}</p>}
      {entry?.status === "uncalibrated" && <p className="small muted">{t("picks:matchPick.uncalibrated")}</p>}
      {entry?.status === "none" && <p className="small muted">{t("picks:matchPick.none")}</p>}
      {entry?.status === "pick" && entry.pick && (
        <MatchPickBody pick={entry.pick} kinds={data!.kinds} match={match} played={match.status === "historical"} />
      )}
      <p className="small muted match-pick-note">{matchPickNote()}</p>
    </section>
  );
}

function MatchPickBody({
  pick,
  kinds,
  match,
  played,
}: {
  pick: MatchPick;
  kinds: MatchPicksResponse["kinds"];
  match: Match;
  played: boolean;
}) {
  const kind = kindSentence(pick.kind, kinds[pick.kind]);
  return (
    <>
      <p className="match-pick-text">
        <strong>{matchPickText(pick, match.home_team, match.away_team)}</strong> {played && <Outcome hit={pick.hit} />}
      </p>
      <p className="small">
        <Trans
          i18nKey={played ? "picks:matchPick.probabilityPlayed" : "picks:matchPick.probability"}
          values={{ p: pct(pick.p), base: pct(pick.base) }}
          components={{ bold: <strong /> }}
        />
      </p>
      <div className="match-pick-bars" aria-hidden="true">
        <span className="match-pick-bar is-model">
          <span style={{ width: `${Math.round(pick.p * 100)}%` }} />
        </span>
        <span className="match-pick-bar is-base">
          <span style={{ width: `${Math.round(pick.base * 100)}%` }} />
        </span>
      </div>
      {kind && <p className="small muted">{kind}</p>}
    </>
  );
}

/** Una linea en las tarjetas de Picks probables. */
export function MatchPickLine({
  match,
  entry,
  kinds,
}: {
  match: Match;
  entry: MatchPicksResponse["matches"][string] | undefined;
  kinds: MatchPicksResponse["kinds"];
}) {
  const { t } = useTranslation();
  if (!entry || entry.status === "uncalibrated") return null;
  if (entry.status === "none" || !entry.pick) {
    return <p className="small muted match-pick-line">{t("picks:matchPick.lineNone")}</p>;
  }
  const { pick } = entry;
  const title = [kindSentence(pick.kind, kinds[pick.kind]), matchPickNote()].filter(Boolean).join("\n");
  return (
    <p className="small match-pick-line" title={title}>
      <span className="match-pick-label">{t("picks:matchPick.lineLabel")}</span>{" "}
      <strong>{matchPickText(pick, match.home_team, match.away_team)}</strong> · {pct(pick.p)}{" "}
      <span className="muted">{t("picks:matchPick.leagueBase", { base: pct(pick.base) })}</span>{" "}
      {pick.hit !== null && <span className={pick.hit ? "edge-up" : "edge-down"}>{pick.hit ? "✓" : "✗"}</span>}
    </p>
  );
}
