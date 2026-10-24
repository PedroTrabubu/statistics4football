/** Formato común de "Mis apuestas". */

import { currentLocale, t } from "../../i18n";
import { formatFixed, withPercent } from "../format";

/** Por debajo de este número de apuestas, cualquier cifra se marca como poco fiable. */
export const LOW_SAMPLE = 10;

export function euro(n: number | null, signed = false): string {
  if (n === null) return "—";
  const s = n.toLocaleString(currentLocale(), { style: "currency", currency: "EUR" });
  return signed && n > 0 ? `+${s}` : s;
}

export function pct(n: number | null, digits = 0): string {
  return n === null ? "—" : withPercent(formatFixed(n * 100, digits));
}

export function signedPp(n: number | null): string {
  if (n === null) return "—";
  const v = n * 100;
  return `${v > 0 ? "+" : ""}${formatFixed(v, 1)} pp`;
}

export function moneyClass(n: number | null): string {
  return n === null || n === 0 ? "" : n > 0 ? "ev-positive" : "ev-negative";
}

export function roiPct(roi: number | null, digits = 0): string {
  return roi === null ? "—" : withPercent(`${roi > 0 ? "+" : ""}${formatFixed(roi * 100, digits)}`);
}

/** "+12,30 € por cada 100 € apostados". */
export function roiPer100(roi: number | null): string {
  return roi === null ? "—" : t("mybets:format.roiPer100", { amount: euro(roi * 100, true) });
}
