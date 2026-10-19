import { getPredictability } from "../api/client";
import type { PredictabilityData } from "../api/types";
import { useApi } from "./useApi";

// Precalculado (backend/scripts/report_predictability.py): se pide una vez por sesion.
let cached: Promise<PredictabilityData> | null = null;

/** El indice de predecibilidad, o null mientras carga o si aun no se ha calculado. */
export function usePredictability(): PredictabilityData | null {
  const { data } = useApi(() => {
    cached ??= getPredictability().catch((err: unknown) => {
      cached = null;
      throw err;
    });
    return cached;
  }, []);
  return data?.available ? data : null;
}
