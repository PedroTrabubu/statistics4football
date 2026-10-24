import { currentLanguage, currentLocale, t, type Language } from "../i18n";

// --- Cifras por idioma ---------------------------------------------------------
// El redondeo es siempre el de toFixed; el idioma solo cambia la presentacion:
// separadores y espacio antes del "%" ("9,8" y "86 %" en español; "9.8" y
// "86%" en inglés; "9,8" y "86 %" en francés).

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string, digits: number): Intl.NumberFormat {
  const key = `${locale}|${digits}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    numberFormats.set(key, format);
  }
  return format;
}

/** `value` con `digits` decimales: "9,80" en español y francés, "9.80" en inglés. */
export function formatFixed(value: number, digits: number): string {
  return numberFormat(currentLocale(), digits).format(Number(value.toFixed(digits)));
}

/** Espacio entre la cifra y el "%" en cada idioma (sin espacio en inglés):
 * espacio fijo en español y espacio fino fijo en francés. */
const PERCENT_SPACE: Record<Language, string> = { es: "\u00a0", en: "", fr: "\u202f" };

/** Signo de porcentaje detras de una cifra ya formateada: "86 %" / "86%" / "86 %". */
export function withPercent(number: string): string {
  return `${number}${PERCENT_SPACE[currentLanguage()]}%`;
}

/** Diferencia en puntos porcentuales con signo y un decimal: "+3,2", "−1,5". */
export function formatSignedPoints(fraction: number): string {
  return `${fraction >= 0 ? "+" : "−"}${formatFixed(Math.abs(fraction * 100), 1)}`;
}

/** Linea de un mercado: "2,5" en español y francés, "2.5" en inglés. */
export function formatLine(line: number): string {
  return line.toLocaleString(currentLocale());
}

/** Cifra con el formato del idioma (toLocaleString): "8,5" / "8.5". */
export function formatLocaleNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(currentLocale(), options);
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null) return "—";
  return withPercent(formatFixed(value * 100, digits));
}

export function formatEv(value: number | null): string {
  if (value === null) return "—";
  const pct = value * 100;
  const sign = pct > 0 ? "+" : "";
  return withPercent(`${sign}${formatFixed(pct, 1)}`);
}

/** Para valores que ya vienen en escala 0-100 (stats de temporada), a
 * diferencia de formatPercent que espera una fraccion 0-1 (probabilidades). */
export function formatPct(value: number | null, digits = 0): string {
  if (value === null) return "—";
  return withPercent(formatFixed(value, digits));
}

export function formatNumber(value: number | null, digits = 2): string {
  if (value === null) return "—";
  return formatFixed(value, digits);
}

/** value ya viene en unidades de porcentaje (p.ej. -4.4 = -4.4%), a
 * diferencia de formatEv que espera una fraccion 0-1. */
export function formatRoiPct(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return withPercent(`${sign}${formatFixed(value, 1)}`);
}

export function formatPnl(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatFixed(value, 2)}u`;
}

export function formatOdds(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return formatFixed(value, 2);
}

// --- Fechas ----------------------------------------------------------------------

/** Las fechas de la API son UTC sin zona ("2026-10-09T19:00:00"): se marcan
 * como UTC para que el navegador las muestre en su hora local. Una fecha sin
 * hora ("2026-10-09") ya se interpreta como UTC. */
export function parseApiDate(iso: string): Date {
  const hasTime = iso.includes("T");
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(iso);
  return new Date(hasTime && !hasZone ? `${iso}Z` : iso);
}

/** football-data.org pone 00:00 UTC a los partidos sin hora fijada todavía. */
function isTimeUnknown(date: Date): boolean {
  return date.getUTCHours() === 0 && date.getUTCMinutes() === 0;
}

export function formatDate(iso: string): string {
  return parseApiDate(iso).toLocaleDateString(currentLocale(), {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** 21/09/26: para listas densas de partidos. */
export function formatShortDate(iso: string): string {
  return parseApiDate(iso).toLocaleDateString(currentLocale(), { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/** "2526" -> "25/26" (formato de temporada de soccerdata). */
export function formatSeason(season: string): string {
  return `${season.slice(0, 2)}/${season.slice(2)}`;
}

/** Eliminatorias de la Champions: siguen a las 8 jornadas de la fase de liga
 * (ver backend/app/ingestion/champions.py). */
const CHAMPIONS_ROUNDS: Record<number, string> = {
  9: "playoffFirstLeg",
  10: "playoffSecondLeg",
  11: "roundOf16FirstLeg",
  12: "roundOf16SecondLeg",
  13: "quarterFinalFirstLeg",
  14: "quarterFinalSecondLeg",
  15: "semiFinalFirstLeg",
  16: "semiFinalSecondLeg",
  17: "final",
};

/** "Jornada 8" (en la Champions, "Octavos · ida"...); null si no se conoce. */
export function formatMatchday(matchday: number | null | undefined, leagueCode?: string | null): string | null {
  if (matchday == null) return null;
  if (leagueCode === "INT-Champions League" && CHAMPIONS_ROUNDS[matchday]) {
    return t(`common:championsRound.${CHAMPIONS_ROUNDS[matchday]}`);
  }
  return t("common:matchday", { n: matchday });
}

/** Las partes que haya, unidas con " · " (liga · jornada · fecha). */
export function joinParts(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" · ");
}

/** "9–12 oct" o "28 sept – 1 oct": fechas de una jornada. */
export function formatDateRange(startIso: string, endIso: string): string {
  const start = parseApiDate(startIso);
  const end = parseApiDate(endIso);
  const locale = currentLocale();
  const day = (d: Date) => d.toLocaleDateString(locale, { day: "numeric" });
  const dayMonth = (d: Date) => d.toLocaleDateString(locale, { day: "numeric", month: "short" });
  if (start.toDateString() === end.toDateString()) return dayMonth(start);
  if (start.getMonth() === end.getMonth()) return `${day(start)}–${dayMonth(end)}`;
  return `${dayMonth(start)} – ${dayMonth(end)}`;
}

/** "sáb, 10 oct · 14:00": el saque de un partido en tarjetas pequeñas. */
export function formatKickoff(iso: string): string {
  const date = parseApiDate(iso);
  const unknown = isTimeUnknown(date);
  const locale = currentLocale();
  const day = date.toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(unknown ? { timeZone: "UTC" } : {}),
  });
  if (unknown) return `${day} · ${t("common:timeToBeConfirmed")}`;
  return `${day} · ${date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
}

export function formatDateTime(iso: string): string {
  const date = parseApiDate(iso);
  const locale = currentLocale();
  if (isTimeUnknown(date)) {
    return `${date.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })} · ${t("common:timeToBeConfirmed")}`;
  }
  return date.toLocaleString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// --- Mercados de las casas -------------------------------------------------------

/** Linea que viene como texto ("2.5"): con coma decimal salvo en inglés. */
function lineText(raw: string): string {
  return currentLanguage() === "en" ? raw : raw.replace(".", ",");
}

const MARKET_KEYS: Record<string, string> = {
  asian_handicap: "asianHandicap",
  btts: "btts",
  double_chance: "doubleChance",
  team_scores: "teamScores",
};
const OVER_UNDER_LABELED = new Set(["over_under_1.5", "over_under_2.5", "over_under_3.5"]);

export function marketLabel(market: string): string {
  if (market === "1x2") return "1X2";
  if (OVER_UNDER_LABELED.has(market)) {
    return t("common:betMarket.overUnder", { line: lineText(market.slice("over_under_".length)) });
  }
  return MARKET_KEYS[market] ? t(`common:betMarket.${MARKET_KEYS[market]}`) : market;
}

export function selectionLabel(market: string, selection: string, homeTeam: string, awayTeam: string): string {
  const teams = { home: homeTeam, away: awayTeam };
  if (market === "1x2") {
    if (selection === "home") return homeTeam;
    if (selection === "away") return awayTeam;
    if (selection === "draw") return t("common:betSelection.draw");
  }
  if (market.startsWith("over_under_")) {
    const line = lineText(market.slice("over_under_".length));
    if (selection === "over") return t("common:betSelection.overGoals", { line });
    if (selection === "under") return t("common:betSelection.underGoals", { line });
  }
  if (market === "double_chance") {
    if (selection === "1X") return t("common:betSelection.homeOrDraw", teams);
    if (selection === "X2") return t("common:betSelection.drawOrAway", teams);
    if (selection === "12") return t("common:betSelection.homeOrAway", teams);
  }
  if (market === "team_scores") {
    if (selection === "home") return t("common:betSelection.teamScores", { team: homeTeam });
    if (selection === "away") return t("common:betSelection.teamScores", { team: awayTeam });
  }
  if (market === "asian_handicap") {
    if (selection === "home") return t("common:betSelection.handicap", { team: homeTeam });
    if (selection === "away") return t("common:betSelection.handicap", { team: awayTeam });
  }
  if (market === "btts") {
    if (selection === "yes") return t("common:yes");
    if (selection === "no") return t("common:no");
  }
  return selection;
}

/** Día de un partido para agrupar listas: clave estable ("2026-10-24") y
 * rótulo largo en el idioma actual ("sábado, 24 de octubre"). Los partidos
 * sin hora (00:00 UTC) van al día UTC, no al anterior por la zona horaria. */
export function matchDay(iso: string): { key: string; label: string } {
  const date = parseApiDate(iso);
  const options: Intl.DateTimeFormatOptions = isTimeUnknown(date) ? { timeZone: "UTC" } : {};
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", ...options }).format(date);
  const label = date.toLocaleDateString(currentLocale(), { weekday: "long", day: "numeric", month: "long", ...options });
  return { key: parts, label };
}
