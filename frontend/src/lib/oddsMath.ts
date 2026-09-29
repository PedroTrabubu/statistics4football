/** Formulas de "cuota justa / valor" (ver especificacion, seccion 11).
 *
 * Se calculan en cliente a partir de `prob_model`, que el backend ya expone
 * en cada `Prediction` (Dixon-Coles). Son las mismas formulas que usa
 * `app/probability/ev.py::compute_ev` en el backend; aqui no se persiste
 * nada, es solo la cuota que el usuario esta mirando en su operador.
 */

/** cuota_justa = 1 / probabilidad_historica (o del modelo, aqui). */
export function fairOdds(probModel: number): number | null {
  if (!Number.isFinite(probModel) || probModel <= 0) return null;
  return 1 / probModel;
}

/** probabilidad_implicita = 1 / cuota */
export function impliedProbability(odds: number): number | null {
  if (!Number.isFinite(odds) || odds <= 1) return null;
  return 1 / odds;
}

/** EV fraccional por unidad apostada: misma formula que compute_ev en el backend. */
export function manualEv(probModel: number, odds: number): number | null {
  if (!Number.isFinite(odds) || odds <= 1) return null;
  return probModel * odds - 1;
}

/** Convierte texto de un <input> (admite coma decimal) a numero de cuota valida, o null. */
export function parseOddsInput(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw.replace(",", "."));
  return Number.isFinite(value) && value > 1 ? value : null;
}
