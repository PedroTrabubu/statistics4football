import { getMatchPicks } from "../api/client";
import type { Match, MatchPick, MatchPicksResponse } from "../api/types";
import { t } from "../i18n";
import { formatLine } from "./format";
import { useApi } from "./useApi";

/** Texto fijo del protocolo (docs/PICK_DEL_PARTIDO_PROTOCOLO.md). */
export function matchPickNote(): string {
  return t("picks:matchPick.note");
}

/** Clave de cada familia del backend (app/picks/match_pick.py) en picks:matchPick. */
const FAMILY_KEYS: Record<string, string> = {
  "goles-equipo": "teamGoals",
  "goles-rival": "concededGoals",
  goles: "matchGoals",
  "ambos-marcan": "btts",
  resultado: "result",
  corners: "matchCorners",
  "corners-equipo": "teamCorners",
  tarjetas: "matchCards",
  "tarjetas-equipo": "teamCards",
  faltas: "matchFouls",
  "faltas-equipo": "teamFouls",
  tiros: "matchShots",
  "tiros-equipo": "teamShots",
  "tiros-puerta": "matchShotsOnTarget",
  "tiros-puerta-equipo": "teamShotsOnTarget",
};

/** Opciones sueltas del tipo de pick (lo que no es "over"/"under"). */
const KIND_DETAIL: Record<string, string> = {
  over: "over",
  under: "under",
  si: "yes",
  no: "no",
  gana: "win",
  empata: "draw",
  pierde: "lose",
  "no-pierde": "winOrDraw",
};

/** El texto del pick a partir de sus codigos (family, side, option), como lo
 * escribia el backend: "Getafe saca más de 4.5 córners", "Más de 2.5 goles en
 * el partido", "Elche no marca". */
export function matchPickText(pick: Pick<MatchPick, "family" | "side" | "option">, home: string, away: string): string {
  const team = pick.side === "home" ? home : away;
  const key = FAMILY_KEYS[pick.family];
  const line = pick.option.match(/^(over|under)-(\d+(?:\.\d+)?)$/);
  if (!key) return pick.option;
  if (pick.family === "resultado" || pick.family === "ambos-marcan") {
    return t(`picks:matchPick.text.${key}.${KIND_DETAIL[pick.option] ?? pick.option}`, { team });
  }
  if (!line) return pick.option;
  const [, dir, value] = line;
  if ((pick.family === "goles-equipo" || pick.family === "goles-rival") && Number(value) === 0.5) {
    return t(`picks:matchPick.text.${key}.${dir === "over" ? "yes" : "no"}`, { team });
  }
  return t(`picks:matchPick.text.${key}.${dir}`, { team, line: formatLine(Number(value)) });
}

/** "Córners del equipo · más de": el tipo de pick ("familia|sentido"). */
export function matchPickKindLabel(kind: string): string {
  const [family, rest] = kind.split("|");
  const familyLabel = FAMILY_KEYS[family] ? t(`picks:matchPick.kind.${FAMILY_KEYS[family]}`) : family;
  const detail = KIND_DETAIL[rest] ? t(`picks:matchPick.kindDetail.${KIND_DETAIL[rest]}`) : rest;
  return t("picks:matchPick.kindLabel", { family: familyLabel, detail });
}

/** Los picks del partido de una lista de partidos, en una sola peticion. */
export function useMatchPicks(matches: Match[] | null): MatchPicksResponse | null {
  const ids = (matches ?? []).map((m) => m.id);
  const { data } = useApi(() => (ids.length ? getMatchPicks(ids) : Promise.resolve(null)), [ids.join(",")]);
  return data;
}
