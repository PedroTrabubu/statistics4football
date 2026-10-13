import { leagueLogo } from "../lib/logos";

/** Logo de una liga en una caja de tamaño fijo (lo pone el CSS de cada sitio).
 * Siempre va junto al nombre de la liga, así que es decorativo (alt=""). Sin
 * logo no pinta nada y queda solo el nombre. */
export function LeagueLogo({ code }: { code: string }) {
  const src = leagueLogo(code);
  if (!src) return null;
  return (
    <span className="league-logo">
      <img src={src} alt="" decoding="async" draggable={false} />
    </span>
  );
}
