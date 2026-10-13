/**
 * Lector del historial de apuestas de bet365 (Historial → Apuestas deportivas).
 *
 * bet365 usa clases con nombre estable (h-BetSummary, h-BetSelection,
 * h-BetBuilderSelection, h-StakeReturnSection...), así que el lector se apoya
 * en ellas y en los textos ("Apuesta", "Ganancia", "Créditos de apuesta").
 *
 * Dos diferencias con Winamax:
 * - El resumen no dice si la apuesta se ganó o se perdió: se deduce de lo
 *   cobrado frente a lo que pagaba la cuota (0 € = perdida; lo que pagaba la
 *   cuota o más, con aumentos = ganada; justo el importe = anulada).
 * - No trae referencia: el id sale de la fecha y hora con segundos y del
 *   contenido de la apuesta, así que importar dos veces no la duplica.
 * Las apuestas sencillas solo traen la selección ("Real Madrid"), sin el
 * partido ni el mercado.
 */

import type { BetLeg, BetStatus, BuilderSelection, ImportResult, ParsedBet } from "./types";
import { inferSport, parseAmount } from "./winamax";

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

function text(el: Element | null): string {
  return clean(el?.textContent);
}

function leaves(root: Element): string[] {
  return [...root.querySelectorAll("*")].filter((el) => el.children.length === 0 && text(el) !== "").map(text);
}

/** Cuota vigente y, si se aumentó, la original (la que bet365 pinta en la línea del aumento). */
function readOdds(el: Element | null): { odds: number | null; original: number | null } {
  if (!el) return { odds: null, original: null };
  const spans = [...el.querySelectorAll("span")].filter((s) => s.children.length === 0 && text(s) !== "");
  const boost = spans.filter((s) => s.closest(".h-BetOdds_BoostLine"));
  const current = spans.filter((s) => !s.closest(".h-BetOdds_BoostLine"));
  return {
    odds: current.length ? parseAmount(text(current[current.length - 1])) : null,
    original: boost.length ? parseAmount(text(boost[0])) : null,
  };
}

/** "14/06/2026 21:05:12" -> placedAt "2026-06-14T21:05" y la marca con segundos para el id. */
export function parseDateTime(raw: string): { placedAt: string; stamp: string } | null {
  const m = clean(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const pad = (n: string) => n.padStart(2, "0");
  const [, d, mo, y, h, mi, s = "00"] = m;
  return { placedAt: `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${mi}`, stamp: `${y}${pad(mo)}${pad(d)}${pad(h)}${mi}${s}` };
}

/** FNV-1a de 32 bits en base 36: corto y estable para el id. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function builderLeg(el: Element): BetLeg {
  const fixture = text(el.querySelector(".h-BetBuilderMultipleSelections_FixtureLabel"));
  const participants = fixture ? fixture.split(/\s+v\s+/).map(clean).filter(Boolean) : [];
  const selections: BuilderSelection[] = [...el.querySelectorAll(".h-BetBuilderSelection")].map((s) => ({
    market: text(s.querySelector(".h-BetBuilderSelection_Description")),
    pick: text(s.querySelector(".h-BetBuilderSelection_SelectionLabel")),
    // El resumen de bet365 no da el resultado de cada selección.
    result: null,
  }));
  const { odds, original } = readOdds(el.querySelector(".h-BetBuilderMultipleSelections_OddsLabel"));
  return {
    eventDate: null,
    participants,
    score: null,
    sport: inferSport(
      selections.flatMap((s) => [s.market, s.pick]),
      false,
      0,
      participants,
    ),
    builder: true,
    market: "Crear apuesta",
    pick: selections.map((s) => s.pick).join(" + "),
    odds,
    originalOdds: original,
    selections,
    insuranceApplied: false,
    promoTitle: null,
    boosted: original !== null,
  };
}

function selectionLeg(el: Element): BetLeg {
  const pick = text(el.querySelector(".h-BetSelection_Name"));
  const { odds, original } = readOdds(el.querySelector(".h-BetSelection_Odds"));
  return {
    eventDate: null,
    participants: [],
    score: null,
    // Sin partido ni mercado: el deporte solo se deduce si la selección es un equipo conocido.
    sport: inferSport([pick], false, 0, [pick]),
    builder: false,
    market: "",
    pick,
    odds,
    originalOdds: original,
    selections: [],
    insuranceApplied: false,
    promoTitle: null,
    boosted: original !== null,
  };
}

const STATUS_LABELS: Record<BetStatus, string> = {
  won: "Ganada",
  lost: "Perdida",
  void: "Anulada",
  cashout: "Cobro parcial",
  pending: "En curso",
  unknown: "Sin estado",
};

/** Apuestas de sistema (varias combinadas en un boleto): ni simple ni combinada. */
const SYSTEM_BET = /^\d+\s*x|trixie|yankee|patent|lucky|heinz|canadian|goliath|\bdobles\b|\btriples\b/i;

function parseSummary(el: Element): ParsedBet {
  const when = parseDateTime(text(el.querySelector(".h-BetSummary_DateAndTime")));
  if (!when) throw new Error("Apuesta sin fecha.");
  const warnings: string[] = [];

  const legs = [...el.querySelectorAll(".h-BetBuilderMultipleSelections, .h-BetSelection")].map((leg) =>
    leg.classList.contains("h-BetSelection") ? selectionLeg(leg) : builderLeg(leg),
  );
  if (legs.length === 0) warnings.push("No se encontraron las selecciones.");

  // "5,00 € Crear apuesta @ 2,05", "4,00 € Sencillo", "1,00 € Doble @ 3,50"...
  const description = text(el.querySelector(".h-StakeDescription_Text"));
  const typeLabel = description.replace(/^[\d.,]+\s*€\s*/, "").replace(/\s*@\s*[\d.,]+$/, "").trim();
  const type = SYSTEM_BET.test(typeLabel) ? "otro" : legs.length > 1 ? "combinada" : "simple";

  const box = el.querySelector(".h-StakeReturnSection, .h-StakeReturnSectionIPOffer");
  const lines = box ? leaves(box) : [];
  const amountAfter = (re: RegExp) => {
    const line = lines.find((l) => re.test(l));
    return line ? parseAmount(line.replace(re, "")) : null;
  };
  const stake = amountAfter(/^Apuesta\s+/i);
  // Sin importe no hay apuesta que guardar (p. ej. el último bloque de un HTML cortado).
  if (stake === null) throw new Error("Apuesta sin importe.");
  const gross = amountAfter(/^Ganancias?\s+(?!neta)/i);
  const net = amountAfter(/^Ganancias? netas?\s+/i);
  const creditsLine = lines.find((l) => /^[\d.,]+\s*€\s*Créditos de apuesta$/i.test(l));
  const credits = creditsLine ? parseAmount(creditsLine.replace(/créditos de apuesta/i, "")) : null;
  const freebet = credits !== null && credits >= stake - 0.005;
  if (credits !== null && !freebet) {
    warnings.push("Pagada en parte con créditos de apuesta: se cuenta como dinero propio.");
  }

  const totalOdds = description.match(/@\s*([\d.,]+)$/);
  const odds = totalOdds
    ? parseAmount(totalOdds[1])
    : legs.length === 1
      ? legs[0].odds
      : legs.length && legs.every((l) => l.odds)
        ? legs.reduce((p, l) => p * (l.odds ?? 1), 1)
        : null;

  let status: BetStatus;
  let refund: number | null = null;
  if (gross === null) {
    status = lines.some((l) => /posibles? ganancias?|ganancias? potencial/i.test(l)) ? "pending" : "unknown";
    if (status === "unknown") warnings.push("No se encontró lo cobrado.");
  } else if (/cash ?out|cerrada/i.test(text(el))) {
    status = "cashout";
  } else if (gross === 0) {
    status = "lost";
  } else if (!freebet && Math.abs(gross - stake) < 0.005) {
    status = "void";
    refund = gross;
  } else if (odds && gross >= stake * odds - 0.011) {
    status = "won";
  } else {
    // Cobró menos de lo que pagaba la cuota: cash out o alguna selección anulada.
    status = "cashout";
    warnings.push("Cobró menos de lo que pagaba la cuota (cash out o alguna selección anulada).");
  }
  if (odds === null && status !== "void") warnings.push("No se encontró la cuota.");

  // Con dinero propio, "Ganancia" es el retorno total; con créditos, solo cuenta el beneficio.
  const returned = gross === null ? null : freebet ? (net ?? Math.max(0, gross - stake)) : gross;

  const promotions = new Set<string>();
  if (el.querySelector(".h-WinningsBoostBadge")) promotions.add("Aumento de ganancias");
  for (const label of el.querySelectorAll(".h-BetBoostLabel")) {
    promotions.add(/super/i.test(text(label)) ? "Superaumento" : "Aumento de apuesta");
  }

  const sports = [...new Set(legs.map((l) => l.sport).filter((s) => s !== "Desconocido"))];
  const content = [description, ...legs.map((l) => `${l.participants.join(" v ")}|${l.pick}|${l.odds}`)].join("·");

  return {
    id: `b365-${when.stamp}-${hash(content)}`,
    bookmaker: "bet365",
    ref: null,
    placedAt: when.placedAt,
    type,
    typeLabel,
    legsCount: legs.length,
    sport: sports.length === 1 ? sports[0] : sports.length > 1 ? "Varios" : "Desconocido",
    status,
    statusLabel: STATUS_LABELS[status],
    stake,
    freebet,
    returned,
    refund,
    odds,
    legs,
    promotions: [...promotions],
    warnings,
  };
}

/** ¿Es un historial de bet365? (para elegir el lector al pegar o subir un HTML). */
export function looksLikeBet365(html: string): boolean {
  return html.includes("h-BetSummary");
}

export function parseBet365History(html: string, parser: DOMParser = new DOMParser()): ImportResult {
  const doc = parser.parseFromString(html, "text/html");
  const bets: ParsedBet[] = [];
  let failed = 0;
  for (const item of doc.querySelectorAll(".h-BetSummary")) {
    try {
      bets.push(parseSummary(item));
    } catch {
      failed += 1;
    }
  }
  return { bets, failed };
}
