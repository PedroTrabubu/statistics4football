import { formatEv } from "../lib/format";
import { isEvOutlier } from "../lib/sampleLevel";

export function EvValue({ ev }: { ev: number | null }) {
  if (ev === null) return <>—</>;

  return (
    <>
      <span className={ev >= 0 ? "ev-positive" : "ev-negative"}>{formatEv(ev)}</span>
      {isEvOutlier(ev) && (
        <span
          className="ev-flag"
          title="Un EV tan alto casi siempre indica que el modelo discrepa mucho del mercado (muestra pequeña, equipo con poco histórico...), no una oportunidad segura. Revisa la muestra antes de fiarte de este número."
        >
          revisar
        </span>
      )}
    </>
  );
}
