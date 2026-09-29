/** Tres niveles cualitativos de tamano de muestra (ver glosario y
 * especificacion, seccion "Sistema de calculo estadistico"). Deliberadamente
 * NO es un score numerico de "confianza": un porcentaje con pinta cientifica
 * sin metodologia estadistica solida detras (intervalo de confianza real,
 * backtesting validado) es enganoso. */
export type SampleTier = "low" | "moderate" | "wide";

export function sampleTier(matchesUsed: number): SampleTier {
  if (matchesUsed < 10) return "low";
  if (matchesUsed < 30) return "moderate";
  return "wide";
}

const LABELS: Record<SampleTier, string> = {
  low: "Muestra baja",
  moderate: "Muestra moderada",
  wide: "Muestra amplia",
};

export function sampleLabel(matchesUsed: number): string {
  return LABELS[sampleTier(matchesUsed)];
}

/** Un EV puntual muy alto casi siempre delata que el modelo discrepa
 * fuertemente del mercado (muestra pequeña, equipo recien ascendido,
 * cuota rara) mas que una oportunidad real - no debe presentarse igual
 * que un EV moderado. Ver especificacion, seccion "Riesgos legales":
 * nunca dar apariencia de "apuesta segura". */
const EV_OUTLIER_THRESHOLD = 0.4;

export function isEvOutlier(ev: number | null): boolean {
  return ev !== null && Math.abs(ev) >= EV_OUTLIER_THRESHOLD;
}
