import { getMatchPicks } from "../api/client";
import type { Match, MatchPick, MatchPickKind, MatchPicksResponse } from "../api/types";
import { MATCH_PICK_NOTE } from "../lib/matchPick";
import { useApi } from "../lib/useApi";
import { LoadingView } from "./StatusView";

const pct = (x: number) => `${Math.round(x * 100)} %`;
const pts = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}`;

function kindSentence(kind: MatchPickKind | undefined): string | null {
  if (!kind) return null;
  return `${kind.label}: acertó el ${pct(kind.hit_rate)} frente al ${pct(kind.base)} habitual en la liga (${pts(kind.edge)} pts, IC ${pts(kind.low)} a ${pts(kind.high)}; ${kind.n} partidos de 25/26 y 26/27, cada uno calculado antes de jugarse).`;
}

function Outcome({ hit }: { hit: boolean | null }) {
  if (hit === null) return null;
  return <span className={hit ? "edge-up" : "edge-down"}>{hit ? "✓ Se cumplió" : "✗ No se cumplió"}</span>;
}

/** Bloque de la ficha de partido. */
export function MatchPickBlock({ match }: { match: Match }) {
  const { data, loading, error } = useApi(() => getMatchPicks([match.id]), [match.id]);
  const entry = data?.matches[String(match.id)];
  return (
    <section className="match-pick">
      <h3>Pick del partido</h3>
      {loading && !data && <LoadingView label="Calculando el pick del partido..." />}
      {error && <p className="small muted">No se pudo calcular: {error}</p>}
      {entry?.status === "uncalibrated" && (
        <p className="small muted">Champions: el modelo no está calibrado para esta competición, sin pick del partido.</p>
      )}
      {entry?.status === "none" && (
        <p className="small muted">Sin pick del partido: ningún candidato llega al 65 % sin ser algo que ya pasa casi siempre en la liga.</p>
      )}
      {entry?.status === "pick" && entry.pick && <MatchPickBody pick={entry.pick} kinds={data!.kinds} played={match.status === "historical"} />}
      <p className="small muted match-pick-note">{MATCH_PICK_NOTE}</p>
    </section>
  );
}

function MatchPickBody({ pick, kinds, played }: { pick: MatchPick; kinds: MatchPicksResponse["kinds"]; played: boolean }) {
  const kind = kindSentence(kinds[pick.kind]);
  return (
    <>
      <p className="match-pick-text">
        <strong>{pick.text}</strong> {played && <Outcome hit={pick.hit} />}
      </p>
      <p className="small">
        Probabilidad del modelo: <strong>{pct(pick.p)}</strong> · Base de la liga: {pct(pick.base)}
        {played && " · calculado antes del partido"}
      </p>
      {kind && <p className="small muted">{kind}</p>}
    </>
  );
}

/** Una linea en las tarjetas de Picks probables. */
export function MatchPickLine({
  entry,
  kinds,
}: {
  entry: MatchPicksResponse["matches"][string] | undefined;
  kinds: MatchPicksResponse["kinds"];
}) {
  if (!entry || entry.status === "uncalibrated") return null;
  if (entry.status === "none" || !entry.pick) {
    return <p className="small muted match-pick-line">Pick del partido: ninguno</p>;
  }
  const { pick } = entry;
  const title = [kindSentence(kinds[pick.kind]), MATCH_PICK_NOTE].filter(Boolean).join("\n");
  return (
    <p className="small match-pick-line" title={title}>
      <span className="match-pick-label">Pick del partido:</span> <strong>{pick.text}</strong> · {pct(pick.p)}{" "}
      <span className="muted">(liga {pct(pick.base)})</span>{" "}
      {pick.hit !== null && <span className={pick.hit ? "edge-up" : "edge-down"}>{pick.hit ? "✓" : "✗"}</span>}
    </p>
  );
}
