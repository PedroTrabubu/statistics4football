/** Formato común de "Mis apuestas". */

import { currentLocale, t } from "../../i18n";
import { formatFixed, withPercent } from "../format";

/** Por debajo de este número de apuestas, cualquier cifra se marca como poco fiable. */
export const LOW_SAMPLE = 10;

/** Por debajo de medio céntimo es 0: nunca "−0,00 €". */
export function noNegativeZero(n: number): number {
  return Math.abs(n) < 0.005 ? 0 : n;
}

export function euro(n: number | null, signed = false): string {
  if (n === null) return "—";
  const v = noNegativeZero(n);
  const s = v.toLocaleString(currentLocale(), { style: "currency", currency: "EUR" });
  return signed && v > 0 ? `+${s}` : s;
}

/** Cifra del eje de una gráfica: sin decimales si es entera ("0 €", "250 €"), nunca "−0". */
export function axisEuro(value: number): string {
  const n = noNegativeZero(value);
  return n.toLocaleString(currentLocale(), {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
  });
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

/** "+12 %"; lo que se redondea a 0 sin serlo, "≈ 0 %" (nunca "-0 %"). */
export function roiPct(roi: number | null, digits = 0): string {
  if (roi === null) return "—";
  const v = roi * 100;
  if (Number(Math.abs(v).toFixed(digits)) === 0) {
    const zero = withPercent(formatFixed(0, digits));
    return v === 0 ? zero : `≈ ${zero}`;
  }
  return withPercent(`${v > 0 ? "+" : ""}${formatFixed(v, digits)}`);
}

/** "+12,30 € por cada 100 € apostados". */
export function roiPer100(roi: number | null): string {
  return roi === null ? "—" : t("mybets:format.roiPer100", { amount: euro(roi * 100, true) });
}
