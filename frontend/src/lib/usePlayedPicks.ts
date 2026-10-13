import { useEffect, useState } from "react";
import type { MatchResult } from "../api/types";
import { checkPlayedPicksSteps, type MatchPicksResult } from "./patterns";

/** Trozos de trabajo de este tiempo como mucho, para no congelar la pagina:
 * una temporada entera tarda 1-2 s. */
const SLICE_MS = 16;
/** Temporadas ya comprobadas, mientras dura la sesion. */
const cache = new Map<string, MatchPicksResult[]>();

export interface SeasonData {
  /** Liga y temporada: identifica los datos. */
  key: string;
  played: MatchResult[];
  history: MatchResult[];
}

export interface PlayedPicksState {
  results: MatchPicksResult[] | null;
  done: number;
  total: number;
}

/** Los picks de cada partido jugado de una temporada y si se cumplieron,
 * calculados por trozos (con progreso) y guardados para la sesion. */
export function usePlayedPicks(data: SeasonData | null): PlayedPicksState {
  const [progress, setProgress] = useState<{ key: string; done: number; total: number } | null>(null);
  // Si cambian los partidos jugados (nueva jornada), se vuelve a comprobar.
  const cacheKey = data ? `${data.key}|${data.played.length}` : null;
  const total = data ? data.played.filter((m) => m.status === "historical").length : 0;

  useEffect(() => {
    if (!data || !cacheKey || cache.has(cacheKey)) return;
    let cancelled = false;
    let timer = 0;
    const steps = checkPlayedPicksSteps(data.played, data.history);
    const results: MatchPicksResult[] = [];
    const work = () => {
      if (cancelled) return;
      const start = performance.now();
      while (performance.now() - start < SLICE_MS) {
        const step = steps.next();
        if (step.done) {
          cache.set(cacheKey, results);
          setProgress({ key: cacheKey, done: results.length, total: results.length });
          return;
        }
        results.push(step.value);
      }
      setProgress({ key: cacheKey, done: results.length, total });
      timer = window.setTimeout(work, 0);
    };
    timer = window.setTimeout(work, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [data, cacheKey, total]);

  if (!cacheKey) return { results: null, done: 0, total: 0 };
  const cached = cache.get(cacheKey);
  if (cached) return { results: cached, done: cached.length, total: cached.length };
  return { results: null, done: progress?.key === cacheKey ? progress.done : 0, total };
}
