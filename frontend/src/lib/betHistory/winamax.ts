/**
 * Lector del historial de apuestas de Winamax ("Mis apuestas" → Finalizadas).
 *
 * Las clases CSS de Winamax (sc-xxxx) se regeneran en cada versión de su web,
 * así que aquí no se usan. El lector se apoya solo en lo estable: los
 * atributos data-testid, las clases semánticas (odds-indicator-value,
 * history-summary-row-value, MyMatchSelection-RightSection...) y los textos
 * ("Importe", "Ganancias", "Ref:"...).
 */

import type { BetLeg, BetStatus, BuilderSelection, ImportResult, ParsedBet, SelectionResult } from "./types";

const STATUS: Record<string, BetStatus> = {
  ganada: "won",
  ganado: "won",
  perdida: "lost",
  perdido: "lost",
  anulado: "void",
  anulada: "void",
  reembolsado: "void",
  reembolsada: "void",
  cancelada: "void",
  cancelado: "void",
  "cash out": "cashout",
  cashout: "cashout",
  retirada: "cashout",
  "en curso": "pending",
  pendiente: "pending",
};

/** Estado a partir del texto del banner. Winamax a veces añade detalle
 * ("Reembolsado - Has cancelado esta apuesta"), así que se mira el principio. */
export function parseStatus(raw: string): BetStatus | null {
  const t = clean(raw).toLowerCase();
  const key = Object.keys(STATUS)
    .sort((a, b) => b.length - a.length)
    .find((k) => t === k || t.startsWith(`${k} `) || t.startsWith(`${k}-`) || t.startsWith(`${k} -`));
  return key ? STATUS[key] : null;
}

const SPORT_ICONS: Record<string, string> = {
  tennis: "Tenis",
  football: "Fútbol",
  soccer: "Fútbol",
  basketball: "Baloncesto",
  handball: "Balonmano",
  volleyball: "Voleibol",
  icehockey: "Hockey hielo",
  americanfootball: "Fútbol americano",
  rugby: "Rugby",
  baseball: "Béisbol",
  esports: "eSports",
  golf: "Golf",
  boxing: "Boxeo",
  mma: "MMA",
  cycling: "Ciclismo",
  darts: "Dardos",
  snooker: "Snooker",
  tabletennis: "Tenis de mesa",
  formula1: "Motor",
  motorsport: "Motor",
};

const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const TEAM_SCORE_DASH = 'svg path[d="M2 2.5H8"]';

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

function text(el: Element | null): string {
  return clean(el?.textContent);
}

/** "1.234,56 €" -> 1234.56 */
export function parseAmount(raw: string): number | null {
  const s = clean(raw).replace(/[€\s]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function leaves(root: Element): Element[] {
  return [...root.querySelectorAll("*")].filter(
    (el) => el.children.length === 0 && el.namespaceURI !== "http://www.w3.org/2000/svg" && text(el) !== "",
  );
}

/** Cuota vigente: la que no está tachada. */
function currentOdds(root: Element): number | null {
  const values = [...root.querySelectorAll(".odds-indicator-value")].filter(
    (el) => el.closest('[data-variant="striped"]') === null,
  );
  return values.length ? parseAmount(text(values[values.length - 1])) : null;
}

function strikedOdds(root: Element): number | null {
  const el = root.querySelector('[data-variant="striped"] .odds-indicator-value');
  return el ? parseAmount(text(el)) : null;
}

function selectionResult(variant: string | null): SelectionResult {
  const v = (variant ?? "").toLowerCase();
  if (["win", "won", "winning"].includes(v)) return "won";
  if (["lose", "lost", "loss", "losing"].includes(v)) return "lost";
  if (["void", "cancel", "cancelled", "refund"].includes(v)) return "void";
  return null;
}

const FOOTBALL_TEAM =
  /\b(fc|cf|cd|ud|sd|rcd|real|atl[eé]tico|athletic|united|city|racing|sporting|deportivo|celta|sevilla|betis|valencia|osasuna|getafe|espanyol|girona|villarreal|alav[eé]s|mallorca|rayo|elche|levante|oviedo|barcelona|madrid|m[aá]laga|coru[nñ]a|arsenal|chelsea|liverpool|tottenham|everton|newcastle|brighton|fulham|brentford|wolves|villa|bournemouth|nottingham|leeds|burnley|sunderland|juventus|milan|inter|napoli|roma|lazio|bayern|dortmund|psg|marsella|lyon|benfica|oporto|ajax)\b/;

/**
 * Deporte a partir de los textos de mercado/selección, el marcador y los
 * nombres de los participantes. Si no hay pistas suficientes: "Desconocido".
 */
export function inferSport(
  markets: string[],
  teamScoreboard: boolean,
  scoreNumbers: number,
  participants: string[] = [],
): string {
  const all = markets.join(" ").toLowerCase();
  if (/\bset\b|juego|tie.?break|\baces?\b|doble falta/.test(all)) return "Tenis";
  if (
    /c[oó]rner|tarjeta|expulsi|ambos equipos|doble oportunidad|goleador|jugador decisivo|fuera de juego|penalti|porter[ií]a|\bgol(es)?\b|primera mitad|segunda mitad/.test(
      all,
    )
  ) {
    return "Fútbol";
  }
  if (teamScoreboard) return "Fútbol";
  const names = participants.join(" ").toLowerCase();
  if (FOOTBALL_TEAM.test(names)) return "Fútbol";
  if (scoreNumbers >= 4) return "Tenis";
  // Tenis: selección con la inicial del jugador ("N. Djokovic") y dos personas como participantes.
  if (markets.some((m) => /^[A-ZÁÉÍÓÚÑ]\. \S/.test(m.trim())) && participants.length === 2) return "Tenis";
  return "Desconocido";
}

function parseLeg(card: Element): BetLeg {
  const wrapper = card.querySelector('[data-testid="history-outcome-presentation-wrapper"]');
  let eventDate: string | null = null;
  const participants: string[] = [];
  const numbers: string[] = [];
  if (wrapper) {
    for (const leaf of leaves(wrapper)) {
      // En algunas versiones la cabecera del "Crea tu apuesta" (con su cuota)
      // va dentro del bloque del partido: no es un participante.
      if (leaf.closest(".odds-indicator-value, .history-item-outcome-my-match-content-header")) continue;
      const t = text(leaf);
      if (!eventDate && /^\d{2}\/\d{2}$/.test(t)) eventDate = t;
      else if (/^\d+$/.test(t)) numbers.push(t);
      else if (!participants.includes(t)) participants.push(t);
    }
  }
  // Selecciones de promoción ("La Gran Supercuota: Real Madrid - Rayo Vallecano"):
  // no van ligadas a un partido normal, el título hace de cabecera.
  const content = card.querySelector('[data-testid="history-item-outcome-default-content"]');
  const promoTitle =
    leaves(card)
      .filter((el) => !(content?.contains(el) ?? false))
      .map(text)
      .find((t) => /supercuota/i.test(t)) ?? null;
  if (promoTitle && participants.length === 0) {
    const match = promoTitle.split(":").slice(1).join(":").trim();
    participants.push(...match.split(" - ").map((p) => p.trim()).filter(Boolean));
  }
  const teamScoreboard = wrapper?.querySelector(TEAM_SCORE_DASH) != null;
  let score: string | null = null;
  if (numbers.length >= 2) {
    const pairs = [];
    for (let i = 0; i + 1 < numbers.length; i += 2) pairs.push(`${numbers[i]}-${numbers[i + 1]}`);
    score = pairs.join(" ");
  }

  const builderHeader = card.querySelector(".history-item-outcome-my-match-content-header");
  let market = "";
  let pick = "";
  let odds: number | null;
  let originalOdds: number | null = null;
  let selections: BuilderSelection[] = [];
  if (builderHeader) {
    odds = currentOdds(builderHeader);
    selections = [...card.querySelectorAll(".MyMatchSelection-RightSection")].map((section) => {
      const spans = section.querySelectorAll("span");
      return {
        market: text(spans[0] ?? null),
        pick: text(spans[1] ?? null),
        result: selectionResult(section.closest("[data-variant]")?.getAttribute("data-variant") ?? null),
      };
    });
    market = "Crea tu apuesta";
    pick = selections.map((s) => `${s.market}: ${s.pick}`).join(" + ");
  } else {
    market = text(content?.querySelector("span") ?? null);
    pick = text(content?.querySelector("p") ?? null);
    odds = currentOdds(card);
    originalOdds = strikedOdds(card);
  }

  // Las supercuotas no traen mercado, solo la selección ("Real Madrid marca al menos 3 goles").
  const marketsForSport = builderHeader ? selections.map((s) => s.market) : [market, pick];
  return {
    eventDate,
    participants,
    score,
    sport: inferSport(marketsForSport, teamScoreboard, numbers.length, participants),
    builder: builderHeader != null,
    market,
    pick,
    odds,
    originalOdds,
    selections,
    insuranceApplied: /aplicada/i.test(text(card)) && card.querySelector('img[src*="garantie"]') != null,
    promoTitle,
    boosted: card.querySelector('[data-variant="gold"] .odds-indicator-value') != null,
  };
}

/** Etiqueta de la fila de resumen ("Importe", "Ganancias"...) que contiene un valor, en minúsculas. */
function rowLabel(value: Element, summary: Element): string | null {
  return rowLabelText(value, summary)?.toLowerCase() ?? null;
}

/** Igual que rowLabel, pero con el texto tal cual ("Bang to the Moon"). */
function rowLabelText(value: Element, summary: Element): string | null {
  let node: Element | null = value.parentElement;
  while (node && node !== summary.parentElement) {
    const first: Element | null = node.firstElementChild;
    if (first && first !== value && !first.contains(value) && !value.contains(first) && text(first) !== "") {
      return text(first);
    }
    node = node.parentElement;
  }
  return null;
}

function parseDate(raw: string): string | null {
  const m = clean(raw).match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2})\s+([a-záéíóú]+)\s+(\d{4})$/i);
  if (!m) return null;
  const month = MONTHS[m[4].toLowerCase()];
  if (!month) return null;
  const pad = (n: number | string) => String(n).padStart(2, "0");
  return `${m[5]}-${pad(month)}-${pad(m[3])}T${pad(m[1])}:${m[2]}`;
}

function parseItem(item: Element, id: string): ParsedBet {
  const cards = [...item.querySelectorAll('a[data-testid="history-item-outcome-card"]')];
  const summary = item.querySelector('[data-testid="history-item-betslip-summary"]');
  const outside = (el: Element) => !cards.some((c) => c.contains(el)) && !(summary?.contains(el) ?? false);
  const warnings: string[] = [];

  const header = [...item.querySelectorAll("p")].find(outside) ?? null;
  const typeLabel = text(header);
  const type = /^simple/i.test(typeLabel) ? "simple" : /^combinada/i.test(typeLabel) ? "combinada" : "otro";
  const legsInLabel = typeLabel.match(/\((\d+)\)/);

  let status: BetStatus = "unknown";
  let statusLabel = "";
  for (const span of item.querySelectorAll("span")) {
    if (!outside(span)) continue;
    const s = parseStatus(text(span));
    if (s) {
      status = s;
      statusLabel = text(span);
      break;
    }
  }
  if (status === "unknown") warnings.push("No se encontró el estado de la apuesta.");

  let stake: number | null = null;
  let freebet = false;
  let returned: number | null = null;
  let refund: number | null = null;
  let totalOdds: number | null = null;
  if (summary) {
    for (const value of summary.querySelectorAll(".history-summary-row-value, .odds-indicator-value")) {
      if (value.closest('[data-variant="striped"]')) continue;
      const label = rowLabel(value, summary);
      const amount = parseAmount(text(value));
      if (label === null || amount === null) continue;
      if (label.startsWith("importe")) stake = amount;
      else if (label.includes("freebet")) {
        stake = amount;
        freebet = true;
      } else if (label.startsWith("ganancia")) returned = amount;
      else if (label.startsWith("cuota")) totalOdds = amount;
      else if (label.startsWith("anulad") || label.includes("reembols")) refund = amount;
      else if (label.includes("cash")) {
        returned = amount;
        status = "cashout";
      }
    }
  }
  // Apuesta cancelada o reembolsada sin fila "Importe": lo devuelto es lo apostado.
  if (stake === null && refund !== null) stake = refund;
  if (stake === null) warnings.push("No se encontró el importe.");

  let ref: string | null = null;
  let placedAt: string | null = null;
  for (const leaf of leaves(item)) {
    if (!outside(leaf)) continue;
    const t = text(leaf);
    const r = t.match(/^Ref:\s*([A-Z0-9]+)/i);
    if (r) ref = r[1];
    placedAt = placedAt ?? parseDate(t);
  }

  const legs = cards.map(parseLeg);

  const promotions = new Set<string>();
  for (const leg of legs) {
    if (leg.promoTitle) promotions.add(clean(leg.promoTitle.split(":")[0]));
    else if (leg.boosted) promotions.add("Supercuota");
  }
  // Filas del resumen sin importe con el logo de una operación o misión ("Bang to the Moon", "Misión Fútbol").
  for (const img of summary?.querySelectorAll("img") ?? []) {
    if (!/operation|mission/i.test(img.getAttribute("alt") ?? "")) continue;
    const label = summary ? rowLabelText(img, summary) : null;
    if (label) promotions.add(label);
  }
  const icons = [...item.querySelectorAll('[role="listitem"] img')]
    .map((img) => (img.getAttribute("src") ?? "").match(/\/media\/([A-Za-z_]+)\./)?.[1]?.toLowerCase().replace(/_/g, ""))
    .filter((name): name is string => Boolean(name))
    .map((name) => SPORT_ICONS[name] ?? name);
  const sports = [...new Set(icons.length ? icons : legs.map((l) => l.sport))];

  const odds =
    totalOdds ?? (legs.length === 1 ? legs[0].odds : legs.every((l) => l.odds) ? legs.reduce((p, l) => p * (l.odds ?? 1), 1) : null);
  if (odds === null && status !== "void") warnings.push("No se encontró la cuota.");

  return {
    id,
    bookmaker: "winamax",
    ref,
    placedAt,
    type,
    typeLabel,
    legsCount: legsInLabel ? Number(legsInLabel[1]) : legs.length,
    sport: sports.length === 1 ? sports[0] : sports.length > 1 ? "Varios" : "Desconocido",
    status,
    statusLabel,
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

export function parseWinamaxHistory(html: string, parser: DOMParser = new DOMParser()): ImportResult {
  const doc = parser.parseFromString(html, "text/html");
  const items = [...doc.querySelectorAll('[data-testid^="history-item-"]')].filter((el) =>
    /^history-item-\d+$/.test(el.getAttribute("data-testid") ?? ""),
  );
  const bets: ParsedBet[] = [];
  let failed = 0;
  for (const item of items) {
    const id = (item.getAttribute("data-testid") ?? "").replace("history-item-", "");
    try {
      bets.push(parseItem(item, id));
    } catch {
      failed += 1;
    }
  }
  return { bets, failed };
}
