import { useEffect, useState } from "react";

const reducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Progreso 0 → 1 con salida suave (para contar cifras al aparecer). Empieza
 * cuando `active` pasa a true; con movimiento reducido, directo a 1. */
export function useCountUp(active: boolean, duration = 1400, delay = 200): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!active) return;
    if (reducedMotion() || typeof requestAnimationFrame === "undefined") {
      const id = setTimeout(() => setProgress(1), 0);
      return () => clearTimeout(id);
    }
    let frame = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      setProgress(1 - Math.pow(1 - t, 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, duration, delay]);

  return progress;
}
