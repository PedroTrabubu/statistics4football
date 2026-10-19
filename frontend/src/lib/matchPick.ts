import { getMatchPicks } from "../api/client";
import type { Match, MatchPicksResponse } from "../api/types";
import { useApi } from "./useApi";

/** Texto fijo del protocolo (docs/PICK_DEL_PARTIDO_PROTOCOLO.md). */
export const MATCH_PICK_NOTE =
  "Es la señal histórica más fuerte del partido según el modelo, no una recomendación; el mercado ya descuenta lo probable.";

/** Los picks del partido de una lista de partidos, en una sola peticion. */
export function useMatchPicks(matches: Match[] | null): MatchPicksResponse | null {
  const ids = (matches ?? []).map((m) => m.id);
  const { data } = useApi(() => (ids.length ? getMatchPicks(ids) : Promise.resolve(null)), [ids.join(",")]);
  return data;
}
