/** Logos de src/assets/logos/, en SVG o PNG. Vite los encuentra al compilar,
 * así que la web nunca pide uno que no exista: sin logo, undefined/null. */

const TEAM_FILES = import.meta.glob<string>("../assets/logos/teams/**/*.{svg,png}", {
  eager: true,
  query: "?url",
  import: "default",
});
const LEAGUE_FILES = import.meta.glob<string>("../assets/logos/leagues/*.{svg,png}", {
  eager: true,
  query: "?url",
  import: "default",
});

/** Nombre normalizado: minúsculas, sin acentos ni apóstrofos y con guiones
 * en lugar de espacios o signos. "Nott'm Forest" -> "nottm-forest",
 * "ESP-La Liga 2" -> "esp-la-liga-2", "Alavés" -> "alaves". */
export function logoSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Nombre del logo a partir de su fichero. Vale el nombre del README
 * ("ath-bilbao.svg") y el de football-logos.cc, sin el prefijo de país ni el
 * sufijo de la web ("spain_athletic-club.football-logos.cc.svg" -> "athletic-club"). */
export function fileSlug(file: string): string {
  const name = file.slice(file.lastIndexOf("/") + 1);
  const stem = name.slice(0, name.lastIndexOf("."));
  return logoSlug(stem.replace(/\.football-logos\.cc$/, "").replace(/^[a-z]+_/, ""));
}

/** {ruta del fichero: url} -> {carpeta: {nombre: url}}. Si están los dos
 * formatos, el SVG. */
export function indexLogos(files: Record<string, string>): Map<string, Map<string, string>> {
  const byFolder = new Map<string, Map<string, string>>();
  for (const [path, url] of Object.entries(files)) {
    const parts = path.split("/");
    const file = parts[parts.length - 1];
    const folder = parts[parts.length - 2] ?? "";
    const name = fileSlug(file);
    let index = byFolder.get(folder);
    if (!index) byFolder.set(folder, (index = new Map()));
    if (!index.has(name) || file.endsWith(".svg")) index.set(name, url);
  }
  return byFolder;
}

/** Subcarpeta de teams/ de cada liga (código de la API). */
export const TEAM_FOLDERS: Record<string, string> = {
  "ENG-Premier League": "en-premierleague",
  "ESP-La Liga": "esp-laliga1",
  "ESP-La Liga 2": "esp-laliga2",
  "FRA-Ligue 1": "fr-ligue1",
  "INT-Champions League": "championsleague",
};

/** Nombre de la API (Football-Data.co.uk, normalizado) -> nombre del
 * fichero, cuando no coinciden. */
export const TEAM_ALIASES: Record<string, string> = {
  // Premier League
  coventry: "coventry-city",
  hull: "hull-city",
  leeds: "leeds-united",
  "man-city": "manchester-city",
  "man-united": "manchester-united",
  "nottm-forest": "nottingham-forest",
  // LaLiga. El fichero "spain_deportivo" es el escudo del Deportivo Alavés.
  alaves: "deportivo",
  "ath-bilbao": "athletic-club",
  "ath-madrid": "atletico-madrid",
  betis: "real-betis",
  espanol: "espanyol",
  "la-coruna": "deportivo-la-coruna",
  santander: "racing",
  sociedad: "real-sociedad",
  vallecano: "rayo-vallecano",
  // LaLiga Hypermotion. Los filiales llevan el escudo del primer equipo.
  andorra: "fc-andorra",
  "sp-gijon": "sporting-gijon",
  "celta-b": "celta",
  "sociedad-b": "real-sociedad",
  "villarreal-b": "villarreal",
  // Ligue 1
  "le-havre": "le-havre-ac",
  lens: "rc-lens",
  monaco: "as-monaco",
  "paris-sg": "paris-saint-germain",
  strasbourg: "rc-strasbourg-alsace",
  // Champions League (nombres de ESPN)
  "as-roma": "roma",
  "bayern-munich": "bayern-munchen",
  como: "como-1907",
  "feyenoord-rotterdam": "feyenoord",
  internazionale: "inter",
  "lask-linz": "lask",
  "psv-eindhoven": "psv",
  "sabah-fk": "sabah",
  "shakhtar-donetsk": "shakhtar",
  "slavia-prague": "czech-republic-slavia-praha",
  "slovan-bratislava": "s-bratislava",
  "viking-fk": "viking",
  // Nombres de las casas de apuestas (Mis apuestas)
  "athletic-bilbao": "athletic-club",
  "atletico-de-madrid": "atletico-madrid",
  "celta-vigo": "celta",
  "deportivo-de-a-coruna": "deportivo-la-coruna",
  "fc-barcelona": "barcelona",
  psg: "paris-saint-germain",
  "racing-de-santander": "racing",
  "sevilla-fc": "sevilla",
};

/** Busca el escudo primero en la carpeta de la liga y luego en todas (un
 * ascendido sale con la carpeta de su liga actual en partidos de la anterior).
 * Prueba el nombre tal cual y después su alias. */
export function createCrestResolver(
  files: Record<string, string>,
  folders: Record<string, string> = TEAM_FOLDERS,
  aliases: Record<string, string> = TEAM_ALIASES,
) {
  const byFolder = indexLogos(files);
  const all = new Map<string, string>();
  for (const folder of [...byFolder.keys()].sort()) {
    for (const [name, url] of byFolder.get(folder)!) if (!all.has(name)) all.set(name, url);
  }

  return (leagueCode: string | null | undefined, teamName: string): string | undefined => {
    const slug = logoSlug(teamName);
    const preferred = leagueCode ? byFolder.get(folders[leagueCode]) : undefined;
    for (const name of [slug, aliases[slug]]) {
      if (!name) continue;
      const url = preferred?.get(name) ?? all.get(name);
      if (url) return url;
    }
    return undefined;
  };
}

/** Escudo de un equipo, o undefined si no hay (la web usa entonces uno neutro). */
export const getTeamCrest = createCrestResolver(TEAM_FILES);

const LEAGUES = indexLogos(LEAGUE_FILES).get("leagues") ?? new Map<string, string>();

export function leagueLogo(leagueCode: string): string | null {
  return LEAGUES.get(logoSlug(leagueCode)) ?? null;
}

/** Iniciales del escudo neutro: "Tenerife" -> "TE", "West Brom" -> "WB". */
export function teamInitials(teamName: string): string {
  const words = teamName
    .normalize("NFD")
    .replace(/[̀-ͯ']/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return letters.toUpperCase();
}
