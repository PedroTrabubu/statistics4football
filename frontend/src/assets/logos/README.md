# Logos de equipos y ligas

La web los encuentra al compilar (`src/lib/logos.ts`), así que basta con dejar el fichero en su carpeta. Están en el repositorio, y en el build cada uno va como fichero aparte: el navegador solo descarga los que se ven.

- `leagues/`: un logo por liga.
- `teams/<liga>/`: los escudos, una subcarpeta por liga.

## Formato

- **SVG o PNG**, el que encuentres. Si hay los dos, se usa el SVG. Los PNG, con fondo transparente, cuadrados y de unos 256×256 px.
- Ligero, a ser posible: el escudo se ve a 24-88 px. Un SVG con una imagen rasterizada dentro puede pesar megas (ver «Ficheros a revisar»).
- No hace falta tenerlos todos: un equipo sin escudo sale con uno neutro con sus iniciales.

## Ligas (`leagues/`)

| Liga | Fichero (.svg o .png) |
|---|---|
| Premier League | `eng-premier-league` |
| LaLiga | `esp-la-liga` |
| LaLiga Hypermotion | `esp-la-liga-2` |
| Ligue 1 | `fra-ligue-1` |
| Bundesliga | `ger-bundesliga` |
| Serie A | `ita-serie-a` |
| Champions League | `int-champions-league` |

## Equipos (`teams/<liga>/`)

| Liga | Carpeta |
|---|---|
| Premier League | `en-premierleague` |
| LaLiga | `esp-laliga1` |
| LaLiga Hypermotion | `esp-laliga2` |
| Ligue 1 | `fr-ligue1` |
| Bundesliga | `bundesliga` |
| Serie A | `serieA` |
| Champions League | `championsleague` (solo los equipos de fuera de nuestras ligas) |

Una liga nueva necesita su carpeta y una entrada en `TEAM_FOLDERS` de `src/lib/logos.ts`. En la Champions, los equipos de nuestras ligas usan su escudo de siempre (se busca en todas las carpetas).

### Cómo se encuentra el escudo de un equipo

1. El nombre del fichero se normaliza: sin el prefijo de país ni el sufijo de football-logos.cc, en minúsculas, sin acentos ni apóstrofos y con guiones. `spain_athletic-club.football-logos.cc.svg` → `athletic-club`.
2. El nombre del equipo en la API (el de Football-Data.co.uk, ej. `Ath Bilbao`) se normaliza igual: `ath-bilbao`. Si hay un fichero con ese nombre, es ese, así que también vale llamarlo directamente `ath-bilbao.svg`.
3. Si no, se busca su alias en `TEAM_ALIASES` de `src/lib/logos.ts`: `ath-bilbao` → `athletic-club`.
4. Se busca primero en la carpeta de la liga del partido y después en todas. Así un ascendido tiene escudo también en los partidos de su liga anterior.

Al añadir un escudo cuyo nombre no coincide con el de la API, añade su alias. Los nombres de la API se pueden ver en `GET /teams`.

### Equipos sin escudo

- **Temporada 26/27:** ninguno (también los 36 de la Champions).
- **Filiales:** Celta B, Sociedad B y Villarreal B usan el escudo de su primer equipo.
- **Solo en el histórico:**
  - Premier League: Burnley, Leicester, Luton, Norwich, Sheffield United, Southampton, Watford, West Brom, West Ham y Wolves.
  - LaLiga Hypermotion: Alcorcon, Amorebieta, Cartagena, Cultural Leonesa, Ferrol, Fuenlabrada, Huesca, Ibiza, Logrones, Lugo, Mirandes, Ponferradina y Zaragoza.
  - Champions League 25/26: Ajax, Benfica, FC Copenhague, Kairat Almaty, Olympiacos, Pafos, Qarabag y Union Saint-Gilloise.
  - Bundesliga: Bielefeld, Bochum, Darmstadt, Greuther Furth, Heidenheim, Hertha, Holstein Kiel, St Pauli y Wolfsburg.
  - Serie A: Benevento, Cremonese, Crotone, Empoli, Pisa, Salernitana, Sampdoria, Spezia y Verona.
  - Ligue 1: Ajaccio, Bordeaux, Clermont, Dijon, Metz, Montpellier, Nantes, Nimes, Reims y St Etienne.

### Ficheros a revisar

- `esp-laliga1/spain_deportivo.football-logos.cc.svg` es el escudo del **Deportivo Alavés**, no del Deportivo de La Coruña (ese es `spain_deportivo-la-coruna`). Funciona por el alias `alaves` → `deportivo`.
- Muy pesados para lo que se muestran:

| Fichero | Peso | Por qué |
|---|---|---|
| `fr-ligue1/france_troyes…svg` | 2 MB | lleva una imagen rasterizada dentro |
| `esp-laliga1/spain_sevilla…svg` | 1,3 MB | más de 7.000 trazados |
| `esp-laliga1/spain_getafe…svg` | 613 KB | lleva una imagen rasterizada dentro |
| `esp-laliga2/spain_las-palmas…svg` | 288 KB | muchos trazados |
| `en-premierleague/england_coventry-city…svg` | 253 KB | lleva una imagen rasterizada dentro |
| `serieA/italy_roma…svg` | 242 KB | |
| `fr-ligue1/france_nice…svg` | 152 KB | |
