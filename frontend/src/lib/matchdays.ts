import type { LeagueMatchdays } from "../api/types";

/** La primera jornada, desde la que Partidos abre por defecto, con partidos
 * aún por jugarse. Una jornada cuyos pendientes ya tenían que haberse jugado
 * (cancelados o aplazados sin nueva fecha) no cuenta: si no, se quedaría ahí.
 * Sin ninguna así, la de por defecto. */
export function nextPendingMatchday(info: LeagueMatchdays, now = Date.now()): number | null {
  const recent = now - 3 * 3_600_000;
  const utc = (d: string) => Date.parse(d.endsWith("Z") ? d : `${d}Z`);
  const pending = info.matchdays.find(
    (m) => m.matchday >= (info.current ?? 0) && m.played < m.total && utc(m.end) >= recent,
  );
  return pending?.matchday ?? info.current ?? null;
}
