/** Nombres habituales de los equipos que Football-Data.co.uk abrevia o
 * escribe distinto, para encontrarlos también así en el buscador. */
const ALSO_KNOWN_AS: Record<string, string[]> = {
  "Ath Bilbao": ["Athletic Club", "Athletic Bilbao"],
  "Ath Madrid": ["Atlético de Madrid", "Atleti"],
  Betis: ["Real Betis"],
  Celta: ["Celta de Vigo"],
  "Celta B": ["Celta de Vigo B"],
  Espanol: ["Espanyol"],
  "La Coruna": ["Deportivo de La Coruña", "Dépor"],
  Oviedo: ["Real Oviedo"],
  Santander: ["Racing de Santander"],
  Sociedad: ["Real Sociedad"],
  "Sociedad B": ["Real Sociedad B", "Sanse"],
  "Sp Gijon": ["Sporting de Gijón"],
  Valladolid: ["Real Valladolid"],
  Vallecano: ["Rayo Vallecano"],
  Zaragoza: ["Real Zaragoza"],
  "Man City": ["Manchester City"],
  "Man United": ["Manchester United"],
  "Nott'm Forest": ["Nottingham Forest"],
  Tottenham: ["Spurs", "Tottenham Hotspur"],
  Wolves: ["Wolverhampton"],
  "Paris SG": ["PSG", "Paris Saint-Germain"],
  "St Etienne": ["Saint-Étienne"],
};

/** Sin acentos, mayúsculas ni signos: "Saint-Étienne" -> "saint etienne". */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** ¿Encaja `name` (equipo o árbitro) con lo escrito en el buscador? Vacío: sí. */
export function matchesSearch(name: string, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  return [name, ...(ALSO_KNOWN_AS[name] ?? [])].some((candidate) => normalize(candidate).includes(q));
}
