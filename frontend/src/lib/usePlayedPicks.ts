import { useEffect, useMemo, useState } from "react";
import type { MatchResult } from "../api/types";
import { checkPlayedPicksSteps, type MatchPicksResult } from "./patterns";

/** Trozos de trabajo de este tiempo como mucho, para no congelar la pagina:
 * una temporada entera tarda 1-2 s. */
const SLICE_MS = 16;
/** Temporadas ya comprobadas, mientras dura la sesion. */
const cache = new Map<string, MatchPicksResult[]>();
/** Varias temporadas juntas (misma lista, mismo array: no se recalcula nada). */
const combined = new Map<string, MatchPicksResult[]>();

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

// Si cambian los partidos jugados (nueva jornada), se vuelve a comprobar.
const keyOf = (d: SeasonData) => `${d.key}|${d.played.length}`;
const playedCount = (d: SeasonData) =>
  d.played.filter((m) => m.status === "historical").length;

/** Los picks de cada partido jugado de una temporada y si se cumplieron,
 * calculados por trozos (con progreso) y guardados para la sesion. */
export function usePlayedPicks(data: SeasonData | null): PlayedPicksState {
  return usePlayedPicksMany(useMemo(() => (data ? [data] : null), [data]));
}

/** Lo mismo con varias temporadas, cada una con su historial, una detras de
 * otra; las ya comprobadas salen de la cache. */
export function usePlayedPicksMany(list: SeasonData[] | null): PlayedPicksState {
  const [progress, setProgress] = useState<{ key: string; done: number } | null>(
    null,
  );
  const listKey = list ? list.map(keyOf).join(",") : null;
  const total = list ? list.reduce((n, d) => n + playedCount(d), 0) : 0;

  useEffect(() => {
    if (!list || !listKey) return;
    const pending = list.filter((d) => !cache.has(keyOf(d)));
    if (!pending.length) return;
    let cancelled = false;
    let timer = 0;
    let index = 0;
    let steps: Generator<MatchPicksResult> | null = null;
    let results: MatchPicksResult[] = [];
    const doneBefore = () =>
      list.reduce((n, d) => n + (cache.get(keyOf(d))?.length ?? 0), 0);
    const work = () => {
      if (cancelled) return;
      const start = performance.now();
      while (performance.now() - start < SLICE_MS) {
        const season = pending[index];
        steps ??= checkPlayedPicksSteps(season.played, season.history);
        const step = steps.next();
        if (step.done) {
          cache.set(keyOf(season), results);
          results = [];
          steps = null;
          index += 1;
          if (index === pending.length) {
            setProgress({ key: listKey, done: total });
            return;
          }
          continue;
        }
        results.push(step.value);
      }
      setProgress({ key: listKey, done: doneBefore() + results.length });
      timer = window.setTimeout(work, 0);
    };
    timer = window.setTimeout(work, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [list, listKey, total]);

  if (!list || !listKey) return { results: null, done: 0, total: 0 };
  if (list.every((d) => cache.has(keyOf(d)))) {
    let results = combined.get(listKey);
    if (!results) {
      results =
        list.length === 1
          ? cache.get(keyOf(list[0]))!
          : list.flatMap((d) => cache.get(keyOf(d))!);
      combined.set(listKey, results);
    }
    return { results, done: results.length, total: results.length };
  }
  return {
    results: null,
    done: progress?.key === listKey ? progress.done : 0,
    total,
  };
}
