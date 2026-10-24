/** Textos de "Mis apuestas" en el idioma de la web. Las categorias se calculan
 * y se ordenan con su texto en español (tramos de cuota, tipos, dias,
 * mercados, deportes...), y algunos textos se guardan con las apuestas
 * (avisos de lectura): aqui se traducen solo al mostrarlos. Lo que viene de
 * la casa (promociones, tipo de apuesta, participantes) se muestra tal cual. */

import { t } from "../../i18n";
import { DAY_PARTS, NO_PROMOTION, ODDS_BUCKETS, STAKE_BUCKETS, TYPE_ORDER, WEEKDAYS } from "./analysis";

/** Se construye al primer uso: analysis.ts tambien importa este modulo. */
let keys: Map<string, string> | null = null;

const buildKeys = () =>
  new Map<string, string>([
    ...ODDS_BUCKETS.map(([, , label], i) => [label, `mybets:bucket.odds.${i}`] as [string, string]),
    ...STAKE_BUCKETS.map(([, , label], i) => [label, `mybets:bucket.stake.${i}`] as [string, string]),
    ...TYPE_ORDER.map((label, i) => [label, `mybets:betType.${i}`] as [string, string]),
    ...WEEKDAYS.map((label, i) => [label, `mybets:weekday.${i}`] as [string, string]),
    ...DAY_PARTS.map((label, i) => [label, `mybets:dayPart.${i}`] as [string, string]),
    [NO_PROMOTION, "mybets:noPromotion"],
    // Familias de mercado (marketFamily).
    ["Crea tu apuesta", "mybets:marketFamily.betBuilder"],
    ["Córners", "mybets:marketFamily.corners"],
    ["Tarjetas", "mybets:marketFamily.cards"],
    ["Ambos marcan", "mybets:marketFamily.btts"],
    ["Doble oportunidad", "mybets:marketFamily.doubleChance"],
    ["Hándicap", "mybets:marketFamily.handicap"],
    ["Goleadores / jugador", "mybets:marketFamily.scorers"],
    ["Por mitades", "mybets:marketFamily.halves"],
    ["Juegos (tenis)", "mybets:marketFamily.tennisGames"],
    ["Sets (tenis)", "mybets:marketFamily.tennisSets"],
    ["Goles", "mybets:marketFamily.goals"],
    ["Resultado / ganador", "mybets:marketFamily.result"],
    ["Otros", "mybets:marketFamily.other"],
    // Deportes que deducen los lectores (winamax.ts, bet365.ts).
    ["Fútbol", "mybets:sport.football"],
    ["Tenis", "mybets:sport.tennis"],
    ["Baloncesto", "mybets:sport.basketball"],
    ["Balonmano", "mybets:sport.handball"],
    ["Voleibol", "mybets:sport.volleyball"],
    ["Hockey hielo", "mybets:sport.iceHockey"],
    ["Fútbol americano", "mybets:sport.americanFootball"],
    ["Rugby", "mybets:sport.rugby"],
    ["Béisbol", "mybets:sport.baseball"],
    ["eSports", "mybets:sport.esports"],
    ["Golf", "mybets:sport.golf"],
    ["Boxeo", "mybets:sport.boxing"],
    ["MMA", "mybets:sport.mma"],
    ["Ciclismo", "mybets:sport.cycling"],
    ["Dardos", "mybets:sport.darts"],
    ["Snooker", "mybets:sport.snooker"],
    ["Tenis de mesa", "mybets:sport.tableTennis"],
    ["Motor", "mybets:sport.motor"],
    ["Desconocido", "mybets:sport.unknown"],
    ["Varios", "mybets:sport.several"],
  ]);

/** Texto de una categoria (o deporte); si no es una de las nuestras, tal cual. */
export function groupLabel(key: string): string {
  keys ??= buildKeys();
  const k = keys.get(key);
  return k ? t(k) : key;
}

/** Dimensiones de "Dónde pierdes más" y su texto. */
export const DIMENSION_KEYS: Record<string, string> = {
  Cuota: "odds",
  "Tipo de apuesta": "betType",
  Deporte: "sport",
  "Mercado (simples)": "market",
  Importe: "stake",
  Día: "weekday",
  Hora: "hour",
  Promoción: "promotion",
};

export function dimensionLabel(dimension: string): string {
  return DIMENSION_KEYS[dimension] ? t(`mybets:dimension.${DIMENSION_KEYS[dimension]}`) : dimension;
}

/** Avisos que dejan los lectores en cada apuesta (se guardan en español). */
const WARNING_KEYS: Record<string, string> = {
  "No se encontraron las selecciones.": "noSelections",
  "Pagada en parte con créditos de apuesta: se cuenta como dinero propio.": "partialCredits",
  "No se encontró lo cobrado.": "noReturn",
  "Cobró menos de lo que pagaba la cuota (cash out o alguna selección anulada).": "lessThanOdds",
  "No se encontró la cuota.": "noOdds",
  "No se encontró el estado de la apuesta.": "noStatus",
  "No se encontró el importe.": "noStake",
};

export function warningLabel(warning: string): string {
  return WARNING_KEYS[warning] ? t(`mybets:warning.${WARNING_KEYS[warning]}`) : warning;
}
