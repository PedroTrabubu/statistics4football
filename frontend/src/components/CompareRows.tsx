import type { ReactNode } from "react";
import { TeamName } from "./TeamCrest";

export type Seg = { value: number; kind: "hit" | "neutral" | "miss" };

/** Barra de una fila: proporcional a la mayor de las dos cifras (`width`), o
 * partida en tramos (`segs`: victorias/empates/derrotas, a favor/en contra).
 * Las dos salen del centro hacia los lados: la del local, en espejo. */
function Bar({ side, width, segs }: { side: "home" | "away"; width?: number; segs?: Seg[] }) {
  const total = segs?.reduce((a, s) => a + s.value, 0) ?? 0;
  return (
    <span className={`compare-bar compare-bar-${side}`} aria-hidden="true">
      {segs && total > 0
        ? segs.map((seg, i) =>
            seg.value > 0 ? (
              <span key={i} className={`compare-seg is-${seg.kind}`} style={{ width: `${(seg.value / total) * 100}%` }} />
            ) : null,
          )
        : width !== undefined && <span className="compare-fill" style={{ width: `${width}%` }} />}
    </span>
  );
}

/** Una estadística: la cifra de cada equipo con su nombre en medio y, debajo,
 * las dos barras juntas en el centro. */
export function CompareRow({
  label,
  home,
  away,
  values,
  homeSegs,
  awaySegs,
}: {
  label: ReactNode;
  home: ReactNode;
  away: ReactNode;
  /** Cifras para la barra proporcional (null: sin barra). */
  values?: [number | null | undefined, number | null | undefined];
  homeSegs?: Seg[];
  awaySegs?: Seg[];
}) {
  const [h, a] = values ?? [null, null];
  const max = Math.max(h ?? 0, a ?? 0);
  const pct = (v: number | null | undefined) => (v == null || max <= 0 ? 0 : (v / max) * 100);
  const bars = values !== undefined || homeSegs !== undefined;
  return (
    <tbody className="compare-stat">
      <tr>
        <td className="stats-value compare-home">{home}</td>
        <td className="stats-label" colSpan={2}>
          {label}
        </td>
        <td className="stats-value compare-away">{away}</td>
      </tr>
      {bars && (
        <tr aria-hidden="true">
          <td className="compare-bars" colSpan={4}>
            <span className="compare-bars-pair">
              <Bar side="home" width={values ? pct(h) : undefined} segs={homeSegs} />
              <Bar side="away" width={values ? pct(a) : undefined} segs={awaySegs} />
            </span>
          </td>
        </tr>
      )}
    </tbody>
  );
}

/** Tabla en espejo: cada equipo encabeza la mitad, su cifra va en la columna
 * de fuera (estrecha) y el nombre de la estadística en las dos de dentro.
 * `children`: sus CompareRow. */
export function CompareTable({
  id,
  homeTeam,
  awayTeam,
  league,
  caption,
  children,
}: {
  id?: string;
  homeTeam: string;
  awayTeam: string;
  league?: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <table id={id} className="stats-table compare-table">
      <caption className="visually-hidden">{caption}</caption>
      <colgroup>
        <col className="compare-col-num" />
        <col />
        <col />
        <col className="compare-col-num" />
      </colgroup>
      <thead>
        <tr>
          <th colSpan={2} scope="col">
            <TeamName team={homeTeam} league={league} />
          </th>
          <th colSpan={2} scope="col">
            <TeamName team={awayTeam} league={league} />
          </th>
        </tr>
      </thead>
      {children}
    </table>
  );
}
