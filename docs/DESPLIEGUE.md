# Despliegue: recursos, opciones y coste

Análisis del 2026-10-15. **No se ha desplegado nada**, no se han creado cuentas ni tocado credenciales. Los precios se
leyeron hoy en la web de cada proveedor (fuente al pie de cada tabla, §4). Las cifras marcadas "cálculo propio" son
cuentas mías a partir de esas fuentes, no frases del proveedor.

**Conclusión:** opción A en Cloudflare. La web y los datos precalculados se sirven como sitio estático, y la ingesta, las
capturas de Pinnacle y los informes siguen en el PC. Cuesta **0 €/mes** con el subdominio gratuito y unos 11 $/año si se
quiere un `.com`. La copia de la BD va a R2 o B2, dentro de su capa gratuita. Plan B: un VPS de OVH a 4,61 €/mes con
IVA (§3).

---

## 1. Perfil de recursos

### 1.1 Stack real

| Pieza | Qué es | Medido hoy |
|---|---|---|
| Frontend | React 19 + TypeScript + Vite 8 + React Router 7, Bootstrap, GSAP. SPA sin SSR | `vite build` en 1,8 s |
| Backend | FastAPI + uvicorn, SQLAlchemy 2, Alembic, pydantic-settings | Python **3.14.6** (venv) |
| Dependencias pesadas | numpy y scipy se cargan al importar la API (2,1 s); pandas solo al calcular; `soccerdata` (arrastra seleniumbase) solo en la ingesta | La API no importa soccerdata: en producción basta un `requirements` reducido |
| Base de datos | SQLite en modo WAL, un fichero | 251 MB + WAL de 126 MB sin volcar (lectores abiertos: uvicorn `--reload` y programador) |
| Programador | `scripts/scheduler.py --loop` como tarea de Windows, con las capturas de Pinnacle | Pico de 216 MB de RAM, 22 s de CPU en 1,5 h |

### 1.2 Frontend: bundle y datos que carga

Build de hoy (en una carpeta temporal, sin tocar `frontend/dist`): **9,3 MB en 153 ficheros**.

| Parte | Tamaño | gzip |
|---|---|---|
| JS (`index` 565 KB + `AccordionGallery` 74 KB) | 623 KB | 172 + 29 KB |
| CSS | 295 KB | 44 KB |
| Escudos SVG (147) | 8,0 MB | se descargan solo los que se ven |

- Escudos más pesados: `france_troyes` 2,1 MB (1,6 MB con gzip, lleva una imagen incrustada), `spain_sevilla` 1,3 MB y
  `spain_getafe` 0,6 MB. `italy_roma` sale dos veces con distinto hash. Optimizarlos no es necesario para desplegar.
- Todos los datos llegan de la API (`src/api/client.ts`, `VITE_API_BASE_URL`). La web no incrusta ningún JSON.

Tamaño de las respuestas, medido con el cliente de pruebas de FastAPI (solo GET que no escriben):

| Datos | Crudo | gzip |
|---|---|---|
| Las 7 ligas públicas, todas sus temporadas (results + season-stats + matchdays + upcoming + context-results) | 9,8 MB | 0,74 MB |
| `/picks/predictability` | 146 KB | 40 KB |
| `data/model_cache/match_pick.json` (histórico del Pick del partido) | 534 KB | — |
| `/picks`, `/picks/history`, `/recommendations`, `/recommendations/history` | 13-50 KB c/u | 2-6 KB |
| `/matches/{id}/history` (un partido) | **144 KB** | 11 KB |
| `/matches/{id}/referee-stats` · `/stats` · `/teams/{id}/season-stats` | 9,7 · 0,9 · 2,1 KB | 1,4 · 0,3 · 0,6 KB |

### 1.3 Base de datos: tamaño y crecimiento

| Tabla | Filas | Nota |
|---|---|---|
| `match_odds` | 1.427.643 | ~99 MB de datos más 3 índices: es casi toda la BD. 287.772 filas son "Pinnacle" / "Pinnacle (closing)" del CSV de Football-Data |
| `pinnacle_odds` · `_match_snapshots` · `_captures` | 65.848 · 1.651 · 107 | Capturas propias desde el 2026-10-10 |
| `team_match_stats` · `model_predictions` · `matches` | 47.142 · 38.721 · 25.497 | 16.053 partidos son de las 7 ligas públicas (1.926 por jugar) |

Tamaños de una copia hecha con la API de backup de SQLite, en una carpeta temporal que borré después:

| Variante | Tamaño |
|---|---|
| Completa, compactada (VACUUM) | 235 MB · **52 MB gzip** (4 s) |
| Sin las tablas de capturas de Pinnacle | 224 MB |
| Y sin las filas Pinnacle de Football-Data | 182 MB |
| Y solo con las casas que lee la web (Market Average/Max, Bet365, Bet&Win, William Hill, VC Bet) | **106 MB · 20 MB gzip** |

Crecimiento:

- **Pinnacle** es lo que más crece. Sus tablas ocupan unos 11 MB tras 5 días: ~2 MB/día, unos 65 MB/mes en temporada
  (cálculo propio). Los crudos de `data/pinnacle_raw/` suman 4,5 MB en 5 días, ~0,9 MB/día.
- **El resto** crece unos pocos MB a la semana: ~100 partidos semanales × ~56 filas de cuotas (cálculo propio).
- Los saltos entre copias (43 MB el 29-sep, 103 MB el 10-oct, 251 MB hoy) vienen de las ligas nuevas y de las tablas de
  Pinnacle, no del ritmo normal.
- La parte pública crece poco, así que el tamaño publicado apenas cambia en una temporada.

### 1.4 Qué ficheros de `data/` hacen falta en producción

| Fichero | ¿En el servidor público? |
|---|---|
| `stadistics4bet.db` | **Nunca el original.** Opción A: ninguno. Opciones B/C/D: una copia pública sin Pinnacle (§1.8) |
| `model_cache/match_pick.json`, `model_cache/predictability.json` | Sí: la API los sirve. Comprobado hoy: no llevan cifras de Pinnacle |
| `model_cache/*.csv` y `*_ligas_nuevas*.json`, `reports/` | No: son datasets e informes de trabajo (`reports/` incluye `picks_vs_pinnacle.csv` y `lines_vs_pinnacle.csv`) |
| `pinnacle_raw/` | **No** (uso privado) |
| `stadistics4bet.backup-*.db` (copias antes de migraciones) | **No**: tienen todo, Pinnacle incluido |
| `soccerdata_cache/`, `espn_cache/`, `arbitros_manual.csv`, `scheduler.lock` | No: solo los usa la ingesta |

### 1.5 Endpoints: cálculo en vivo frente a precalculable

| Endpoint | Coste medido | ¿Precalculable a JSON? |
|---|---|---|
| `GET /picks/match-pick` (próximos) | **13,9 s** LaLiga (21 partidos) y **15,1 s** LaLiga 2 (22) la primera vez en este PC. Después sale de la caché en memoria, que se pierde al reiniciar y caduca al entrar un resultado de la liga | Sí: calcularlo en el export, para todas las ligas a la vez (~1,5 min) |
| `GET /matches/{id}/predictions` | Ajusta Dixon-Coles (1,2 s por liga y día, en memoria) y **escribe en la BD en cada GET** (borra e inserta en `model_predictions` con commit) | Sí: por liga, temporada y jornada. En un servidor con API hay que quitarle la escritura |
| `POST /admin/predictions/generate` | **Sin autenticación** | No exponerlo nunca |
| `GET /matches/{id}/history` | 0,06 s, 144 KB | No partido a partido: serían 16.053 × 144 KB ≈ 2,3 GB. Son los partidos de la liga anteriores a la fecha (su temporada y la anterior), así que se pueden derivar en el navegador de los `results` que ya se publican |
| `/matches/{id}/stats`, `/referee-stats` (season/all) | 0,03-0,05 s | Sí, agrupados por liga, temporada y jornada. Partido a partido superarían el límite de ficheros |
| `/teams/{id}/season-stats` | 0,03 s | Ya está dentro de `/leagues/{id}/season-stats` |
| `/matches?filtros` | 0,03 s | Filtrando en el cliente `results`, `upcoming` y `matchdays` |
| `/leagues/*` (seasons, results, season-stats, matchdays, upcoming, context-results) | 0,01-0,3 s | Sí, uno por liga y temporada |
| `/picks`, `/picks/history`, `/recommendations`, `/recommendations/history` | 0,05-0,5 s | Sí: uno cada uno, con los filtros aplicados en el cliente |
| `/picks/predictability` | 0,01 s (lee un JSON) | Ya es un JSON estático |

Todo lo que ve la web se puede publicar como JSON estático. Lo único que exige cambiar código es derivar en el navegador
el historial de cada partido y agrupar los endpoints por partido. Cálculo propio: unos 5.000-6.000 ficheros y 30-40 MB
sin comprimir.

### 1.6 Procesos periódicos

Duraciones medias y máximas sacadas de `ingestion_runs`.

| Proceso | Frecuencia | Duración | Memoria / CPU | ¿Siempre encendido? | ¿Puede seguir en el PC? |
|---|---|---|---|---|---|
| Actualización del programador (`scheduler.update`) | 36, 24, 18, 12 y 6 h antes de cada partido; 3 y 12 h después; a diario hasta tener las estadísticas. 19 pasadas en 5 días | Media 106 s, máx. 231 s | Todo el proceso del programador: pico de 216 MB y poca CPU | Conviene, pero se pone al día al despertar | **Sí** (como ahora) |
| · Football-Data.co.uk (CSV vía soccerdata) | Dentro de cada actualización; el CSV cambia ~2 veces por semana | Media 79 s, máx. 17 min | Red y algo de pandas | No | Sí |
| · football-data.org, Understat, fixtures | En cada actualización | 1-7 s de media | Bajo | No | Sí |
| · ESPN (liga y Champions) y designaciones | En cada actualización | ESPN: media 105 s, máx. 28 min (la carga inicial); Champions 41 s; designaciones 30 s | Bajo | No | Sí |
| **Capturas de Pinnacle** | Por liga: cada 6 h; cada hora a menos de 24 h; cada 12 min en la última hora; una final ~3 min antes (el cierre). Hubo 20-31 pasadas al día | Segundos: 2 peticiones por liga | ~42 KB de crudo por pasada | **Sí**: si el PC duerme, la captura de cierre se pierde y no se recupera | Sí, es la opción más barata. Es la misma restricción de hoy |
| `refresh_predictions.py`, `refresh_picks.py` | A mano | — | — | No | Sí |
| `report_match_pick.py` | A mano. Escribe `match_pick.json` | Minutos, sin medir hoy (~2 s por día de partidos y liga, en paralelo por liga) | Varios núcleos | No | Sí |
| `report_predictability.py` + `npm run export:predictability` / `export:picks` | A mano; necesita la API local en marcha | Sin medir hoy | Bajo | No | Sí |
| `the_odds_api`, ClubElo | A mano (la última el 30-sep y el 6-oct) | 2 s | Bajo | No | Sí |

Ningún proceso tiene que ir en el servidor público. El único que necesita una máquina encendida a horas concretas son las
capturas de Pinnacle, y ya dependen de que el PC esté encendido con la sesión iniciada.

### 1.7 Variables de entorno (solo nombres)

| Dónde | Variables | ¿Secreto? |
|---|---|---|
| `.env` (raíz, backend) | `DATABASE_URL`, `ACTIVE_LEAGUES`, `VALIDATED_LEAGUES`, `HIGH_PROBABILITY_LEAGUES`, `CONTEXT_LEAGUES`, `SOCCERDATA_DIR`, `EV_THRESHOLD`, `ENABLE_EV` (false: modelo de valor retirado), `LOG_LEVEL` | No |
| `.env` (raíz, backend) | `FOOTBALL_DATA_ORG_API_KEY`, `THE_ODDS_API_KEY`, `API_FOOTBALL_RAPIDAPI_KEY` (sin uso) | **Sí** |
| `.env` (raíz, backend) | `LALIGA_SUBSCRIPTION_KEY` (respaldo de una clave pública de laliga.com) | Tratarla como secreto |
| `frontend/.env` | `VITE_API_BASE_URL`, `VITE_SITE_URL` | No. Todo `VITE_*` acaba dentro del bundle público: nunca un secreto ahí |
| `frontend/scripts/export-*.ts` | `API_URL` | No |

En producción ninguna opción necesita las claves de API, porque la ingesta se queda en el PC. Desplegar requerirá
credenciales nuevas, como un token de Cloudflare o claves de R2/B2. Deberán estar solo en el PC, fuera del repo, que es
público.

### 1.8 Restricciones de datos y legales (puntos a comprobar, no es un dictamen)

**No debe llegar al servidor público:**

- Las tablas y vistas `pinnacle_*`, `data/pinnacle_raw/` y las 287.772 filas "Pinnacle" / "Pinnacle (closing)" de
  `match_odds`.
  - Ojo: `INDIVIDUAL_BOOKMAKERS` (en `app/probability/engine.py`) usa esas filas para sanear la "Market Average" en
    `/leagues/{id}/upcoming` y en el motor. Sin ellas el saneado pierde una referencia. Hay que decidir si eso es
    aceptable o si se precalcula en el PC.
- Las copias `stadistics4bet.backup-*.db`, `data/reports/` y los CSV de `model_cache/`.
- `.env`.
- Comprobado hoy: ninguna respuesta de la API ni los dos JSON que sirve contienen datos de Pinnacle. Publicar solo
  respuestas de endpoints de una lista blanca garantiza la exclusión por construcción.
- "Mis apuestas" guarda el historial de bet365 solo en el `localStorage` de quien lo importa. Ningún export personal
  debe acabar en `frontend/public/`.

**Fuentes cuyas condiciones conviene leer antes de publicar:**

| Fuente | Qué comprobar |
|---|---|
| Football-Data.co.uk | Si permite mostrar sus resultados, estadísticas y cuotas (Market Average/Max, Bet365...) en una web pública, y qué atribución pide |
| football-data.org (plan gratuito) | Condiciones de uso y de redistribución, y la atribución |
| ESPN (API pública sin clave, no documentada) | Términos de uso de ESPN para calendario, árbitros y estadísticas |
| Understat (xG) y ClubElo, vía soccerdata | Si permiten reutilizar los datos y con qué atribución |
| APIs de laliga.com, premierleague.com y ligue1.com (designaciones) | Son APIs internas de sus webs. Revisar sus términos antes de mostrar los datos |
| the-odds-api.com (si se reactiva) | Si permite mostrar sus cuotas |
| Escudos de football-logos.cc y logos de ligas | La licencia del sitio y que son marcas registradas de clubes y ligas |
| Contenido de apuestas en España | Si picks, recomendaciones y cuotas cuentan como comunicación comercial de juego (Ley 13/2011, RD 958/2020). Como mínimo: sin enlaces de afiliado ni de casas, con aviso +18 y de juego responsable |
| Privacidad | Sin analítica ni cookies propias, en principio no hace falta banner (comprobarlo). El hosting registra IPs: mencionarlo en una nota de privacidad |

---

## 2. Opciones

Precios leídos hoy, 2026-10-15. Hetzner, Render y Cloud Run cargan las cifras con JavaScript, así que las leí en Chrome;
el resto, con lectura directa de la página.

### Precios verificados

| Proveedor | Plan | Precio | Límites que nos afectan |
|---|---|---|---|
| Cloudflare Pages | Free | 0 | 500 builds/mes, 1 a la vez, timeout de 20 min. 20.000 ficheros. 25 MiB por fichero. La página de límites no menciona el ancho de banda. No dice si las subidas directas (`wrangler`) cuentan como build |
| Cloudflare Workers (static assets) | Free / Paid | 0 / mín. 5 $/mes | "Requests to static assets are free and unlimited". 20.000 ficheros por versión. Si se ejecuta código: 100.000 peticiones/día y 10 ms de CPU |
| GitHub Pages | Gratis | 0 | Sitio de 1 GB. 100 GB/mes y 10 builds/h, ambos límites *suaves* (el de builds no aplica con un workflow propio de Actions). No sirve para negocio online |
| Netlify | Free | 0 | 300 créditos; cada despliegue a producción gasta 15. **Máximo 20 despliegues al mes**, así que no cabe una actualización diaria. Personal: 9 $/mes |
| Vercel | Hobby | 0 | Solo uso personal no comercial; afiliados o anuncios cuentan como comerciales. 100 GB/mes y 100 despliegues/día. Si se pasa, hay que esperar 30 días o el proyecto queda en pausa (503) |
| OVHcloud | VPS-1 | **3,81 € + IVA = 4,61 €/mes** ("Desde") | 2 vCores, 4 GB, 40 GB NVMe, tráfico ilimitado, backup diario incluido. El enlace del configurador lleva `pricing=upfront12`: puede exigir 12 meses (no confirmado) |
| Hetzner | CPX02 | Desde 6,49 €/mes (con el selector de IVA al 0 %) | 1 vCPU, 1 GB, 20 GB NVMe, 20 TB de tráfico. La IPv4 cuesta 0,50 €/mes sin IVA según la documentación; la página muestra "Price incl. IPv4" y no queda claro si está incluida. Los Cost-Optimized (CX23/CAX11) figuran como no disponibles |
| Contabo | Cloud VPS 4 | 4,40 €/mes con contrato de 24 meses | 4 vCPU, 8 GB, 100 GB SSD. No queda claro si el precio incluye el IVA |
| Oracle Cloud | Always Free | 0 | Ampere A1 con 2 OCPU y 12 GB en total, 200 GB de disco, 10 TB/mes de salida. **Recupera las instancias inactivas**: 7 días por debajo del 20 % de CPU (p95), red y memoria. Un portfolio con poco tráfico encaja en ese perfil. Hay errores de "out of host capacity" |
| Fly.io | Pago por uso | 256 MB: 2,19 $/mes (iad); 2,28 $ ams, 2,49 $ cdg/lhr, 2,53 $ fra. 512 MB: 3,69 $/mes (iad) | **Sin plan gratuito** para cuentas nuevas; tarjeta obligatoria. Volumen: 0,15 $/GB-mes. Snapshots diarios con 5 días de retención, gratis los 10 primeros GB. IPv4 compartida gratis; salida 0,02 $/GB en Europa |
| Render | Free / 0.5c-512mb | 0 / **7 $/mes** + SSD **0,25 $/GB-mes** | El Free se duerme a los 15 min, tarda ~1 min en despertar y **no admite disco**: el SQLite se pierde. Los cron jobs no acceden al disco |
| Railway | Free / Hobby | 0 (1 $ de crédito) / **5 $/mes** (incluye 5 $ de uso) | Free: 0,5 GB de RAM y volumen de 500 MB como máximo. Uso: 10 $/GB-mes de RAM, 20 $/vCPU-mes, 0,15 $/GB-mes de volumen |
| Koyeb | Free / nano | 0 / 2,68 $/mes | El Free escala a cero tras 1 h y no admite volúmenes. Los volúmenes están en *public preview*, "only suitable for testing". Retención de 29 $ al dar de alta la tarjeta |
| Google Cloud Run | Capa gratuita | 0 | Al mes: 180.000 vCPU-s, 360.000 GiB-s y 2 M de peticiones (precios de us-central1). No verifiqué si exige cuenta de facturación ni el coste de Artifact Registry |
| Cloudflare D1 | Free / Paid | 0 / 5 $/mes (Workers Paid) | Free: **500 MB por BD**, 5 M filas leídas/día y 100.000 escritas/día. Al agotarlo, las consultas fallan hasta las 00:00 UTC |
| Turso | Free / Developer | 0 / 4,99 $/mes | Free: 5 GB, 500 M filas leídas/mes y 10 M escritas/mes. La página anuncia que Turso se une a Supabase |
| Dominio `.com` | Porkbun | **11,08 $/año** registro y renovación (≈0,92 $/mes, cálculo propio) | `.dev`: 8,75 $ el primer año y 12,87 $ después. `.es`: Porkbun no lo vende; precio no verificado. Cloudflare Registrar vende a precio de coste, pero no publica tabla por TLD |
| Copias: Cloudflare R2 | Free | 0 hasta 10 GB-mes | Después 0,015 $/GB-mes. Salida gratis. 1 M de operaciones de escritura al mes gratis |
| Copias: Backblaze B2 | — | 0 hasta 10 GB | Después 6,95 $/TB-mes. Salida gratis hasta 3 veces lo almacenado |

HTTPS en dominio propio: incluido en GitHub Pages (Let's Encrypt automático) y en Cloudflare Pages (Cloudflare emite el
certificado). Porkbun también ofrece Let's Encrypt gratis en sus dominios.

### A. Todo estático (recomendada)

**Cómo funciona:**

1. En el PC, un script nuevo hace una instantánea de la BD con la API de backup de SQLite. Así no molesta al programador
   ni se queda con datos a medias del WAL.
2. Sobre esa instantánea, llama con el cliente de pruebas de FastAPI a una **lista blanca** de endpoints y guarda cada
   respuesta como JSON. Reutiliza la lógica del backend sin duplicarla y deja fuera Pinnacle por construcción.
3. Calcula también el Pick del partido de los próximos partidos.
4. Compila la web y la publica.

| Aspecto | Detalle |
|---|---|
| Coste mensual | **0 €** con `*.pages.dev`. Con `.com` en Porkbun, ≈0,92 $/mes. Copias en R2/B2: 0 € (11 copias de 52 MB ≈ 0,6 GB < 10 GB, cálculo propio) |
| Límites gratuitos que pueden afectar | 500 builds/mes: con 2 publicaciones al día son ~60/mes. 20.000 ficheros: se estiman 5.000-6.000. 25 MiB por fichero: el mayor JSON ronda el MB. No hay suspensión por inactividad: es estático |
| Esfuerzo | **20-30 h**: script de export 5-7 h; modo estático de `client.ts` con derivaciones en el cliente 6-10 h; ajustes de páginas 2-4 h; publicación y tarea programada 2-3 h; copias 1-2 h; comprobación automática (estático = API y nada de Pinnacle en `dist`) 2-3 h |
| Cambios de código | Nuevos: `backend/scripts/export_static.py`, `backend/scripts/backup_db.py`, un script de publicación (PowerShell) y una tarea de Windows **aparte** del programador, para no tener que reiniciarlo. Modificados: `frontend/src/api/client.ts`, `pages/MatchDetailPage.tsx`, `components/RefereePanel.tsx`, `components/MatchPick.tsx` / `lib/matchPick.ts`, `frontend/.env.example` |
| Capturas de Pinnacle | No pueden ir en un hosting estático. Siguen en el PC sin cambios |
| Riesgos | Si el PC se apaga, los datos se quedan viejos pero la web sigue arriba: conviene mostrar "datos a fecha X". Lógica derivada en el cliente distinta de la del backend: se mitiga con la comparación automática. Despliegue fallido: queda la versión anterior. BD perdida: copia diaria fuera del PC |

### B. Frontend estático + backend en un VPS barato

| Aspecto | Detalle |
|---|---|
| Coste mensual | **OVH VPS-1: 4,61 €/mes** con IVA. En la práctica hace falta un dominio para el HTTPS de la API: ≈0,92 $/mes más. Total ≈ **5,5 €/mes** (cálculo propio). Hetzner CPX02: 6,49 € + IVA. Oracle Always Free: 0 €, con riesgo de que recupere la instancia. El frontend puede ir gratis en Cloudflare Pages |
| Límites | Ninguno de un plan gratuito, salvo Oracle (recuperación por inactividad, capacidad). Con 1 GB de RAM (Hetzner CPX02) caben la API (~180 MB) y, si se moviera, el programador (~220 MB); OVH tiene 4 GB |
| Esfuerzo | **9-13 h**, más ~1 h/mes de mantenimiento: configuración de producción 2-3 h; servidor con firewall, actualizaciones automáticas, Caddy con HTTPS y systemd 3-4 h; publicación de la BD pública desde el PC 2-3 h; frontend 1 h; copias 1-2 h |
| Cambios de código | `app/main.py`: CORS desde una variable de entorno, sin el router `admin` en producción. `routers/matches.py`: predicciones sin commit, o la BD en solo lectura. `core/config.py`: nuevas variables. Nuevo `requirements-api.txt` sin soccerdata ni seleniumbase. Script que copia la BD, borra Pinnacle, hace VACUUM, la sube y la cambia de forma atómica. Precalentar el Pick del partido al arrancar |
| Capturas de Pinnacle | Podrían ir allí (cron o systemd, poca carga). Pero los datos privados quedarían en una máquina expuesta y las peticiones saldrían desde una IP de centro de datos: revisar las condiciones de Pinnacle y si la bloquea. Recomendado: dejarlas en el PC |
| Riesgos | Mantenimiento y seguridad del servidor a tu cargo. Una sola máquina: si cae, cae la API. Si falla la subida diaria, datos viejos. El Pick en vivo cuesta ~15 s de CPU por liga en una máquina pequeña. Copia: el backup diario de OVH más una copia propia en R2/B2 |

### C. Un contenedor en un PaaS con volumen

| Aspecto | Detalle |
|---|---|
| Coste mensual | **Fly.io** con 512 MB y 1 GB de volumen: ≈3,84 $/mes en iad. En Europa con 256 MB, ≈2,43 $ en ams (cálculo propio), aunque 256 MB es justo para ~180 MB de API. **Railway** Hobby: 5 $/mes. **Render**: 7 $ + 0,25 $ ≈ 7,25 $/mes. Incluyen subdominio propio de la plataforma; con `.com`, +0,92 $/mes |
| Límites | Fly: sin plan gratuito y con tarjeta. Render Free: se duerme y no tiene disco, inservible. Railway Free: 0,5 GB de RAM y volumen de 500 MB, muy justo. Koyeb: volúmenes en preview |
| Esfuerzo | **6-10 h**: Dockerfile con `python:3.14-slim` y `requirements-api.txt`, configuración de la plataforma y del volumen, subida diaria de la BD (o meter la BD en la imagen y redesplegar), más los mismos cambios de producción que en B |
| Cambios de código | Los de B, más `Dockerfile` y la configuración de la plataforma (`fly.toml` o equivalente) |
| Capturas de Pinnacle | Técnicamente sí, con un segundo proceso y la máquina sin auto-parada, pero mezclaría los datos privados con el volumen de la API pública. No recomendado: se quedan en el PC |
| Riesgos | Precio variable (pago por uso). El volumen está atado a una máquina y región: si falla, se restaura del snapshot. Arranque en frío si se activa la auto-parada |

### D. Serverless / gestionado

No encaja bien con la base actual: SQLite en un fichero, cálculo con numpy y scipy, y ~15 s de CPU para el Pick del
partido.

| Variante | Coste | Problema |
|---|---|---|
| Cloud Run con la BD pública dentro de la imagen, en solo lectura | 0 € dentro de la capa gratuita (Artifact Registry sin verificar) | Escala a cero: cada arranque en frío importa numpy y scipy (~2 s) y recalcula la caché (~15 s por liga). Hay que reconstruir la imagen a diario. Cuenta de GCP. Esfuerzo 8-12 h |
| Cloudflare Workers + D1 / Turso | 0 € (Free) o 5 $/mes | Exige reescribir la API: Python Workers corre sobre Pyodide y la documentación no nombra numpy ni scipy; 10 ms de CPU en Free y 128 MB de memoria. D1 Free admite 500 MB por BD (la pública mide 106-182 MB) y corta al pasar de 5 M filas leídas al día. Esfuerzo **60 h o más** |
| Capturas de Pinnacle | — | No caben: no hay proceso permanente |

Si de todos modos hay que precalcular, el resultado es la opción A con más piezas. Descartada.

### Descartada también: servir la API desde el PC con un túnel

Costaría 0 € y casi no habría que tocar código. Pero la web caería cada vez que el PC se apaga o se suspende, y eso no
cumple "disponible casi siempre". No verifiqué el precio del túnel.

### Comparación

| | A. Estático | B. VPS | C. PaaS | D. Serverless |
|---|---|---|---|---|
| Coste/mes (sin dominio / con `.com`) | **0 € / ≈0,92 $** | ≈4,61 € / ≈5,5 € | ≈3,8-7,3 $ / +0,92 $ | 0 € / +0,92 $ |
| Esfuerzo de migración | 20-30 h | 9-13 h + mantenimiento | 6-10 h | 8-12 h (Cloud Run) / 60+ h |
| Disponibilidad | CDN; no depende del PC | Una máquina | Una máquina | Arranques en frío lentos |
| Frescura de los datos | La de las publicaciones desde el PC | Igual (la BD sube desde el PC) | Igual | Igual |
| Capturas de Pinnacle | PC | PC (podrían ir al VPS) | PC | PC |
| Riesgo de publicar datos privados | Mínimo (lista blanca) | Medio (sube una BD) | Medio | Medio |

---

## 3. Recomendación

**Opción A en Cloudflare**, con Pages o Workers con static assets. Es la más barata (0 €/mes) y cumple los cinco requisitos:

| Requisito | Cómo se cumple |
|---|---|
| Disponible casi siempre y carga rápido | Ficheros estáticos en la CDN de Cloudflare, sin servidor de aplicación. La web no depende de que el PC esté encendido. La primera carga baja ~250 KB comprimidos de JS y CSS más los escudos que se ven y los JSON de la liga (~0,1 MB comprimidos) |
| Datos al menos cada día | Tarea de Windows que exporta y publica 2 veces al día, p. ej. por la mañana y tras la última actualización de la noche: ~60 despliegues al mes de un máximo de 500. Se puede añadir una publicación tras cada actualización del programador mientras se quede por debajo de ~16 al día |
| Capturas sin interrupciones | No se tocan: siguen en el programador del PC. El export lee una instantánea y va en una tarea aparte, así que no hay que reiniciar el programador |
| Sin datos privados | Solo se publican respuestas de endpoints de una lista blanca. Ninguno expone Pinnacle (comprobado hoy). Una comprobación automática rechaza la publicación si `dist/` contiene "pinnacle" o algún fichero `.db` o `.csv` |
| Copia de seguridad | Copia diaria con la API de backup de SQLite (no `cp`: la BD está en WAL), comprimida (~52 MB), a R2 o B2. Por ejemplo, 7 diarias y 4 semanales ≈ 0,6 GB, dentro de los 10 GB gratis. Hoy las copias están en el mismo disco que la BD, así que no protegen de un fallo del PC |

**Plan B, según qué límite se convierta en problema** (el mensaje original llegó cortado aquí; asumo "un problema"):

1. **500 builds/mes o 20.000 ficheros de Cloudflare**: bajar a una publicación al día o agrupar más los JSON. Si no basta,
   **GitHub Pages**: 1 GB, publicación con un workflow propio de Actions, sin el límite de builds. Hay que comprobar cómo
   resuelve las rutas de una SPA (fallback con `404.html`).
2. **El PC va a estar apagado días, o hace falta API en vivo**: **opción B en OVH VPS-1** (4,61 €/mes, ≈5,5 € con
   dominio). El mismo export alimenta la BD pública del VPS. Si se acepta tener datos privados en un servidor que no es
   público, el programador y las capturas podrían pasar allí más adelante.
3. **20-30 h de migración son demasiadas para empezar**: arrancar con la B (9-13 h) y pasar a la A más tarde. La A
   reutiliza los cambios de producción de la B.

**Antes de publicar, en cualquier opción:**

- Leer las condiciones de las fuentes de §1.8.
- Añadir la atribución de fuentes y el aviso +18 y de juego responsable.
- Decidir el saneado de la Market Average sin las filas de Pinnacle.

---

## 4. Fuentes (consultadas el 2026-10-15)

- Cloudflare Pages, límites: https://developers.cloudflare.com/pages/platform/limits/
- Cloudflare Workers: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ ·
  https://developers.cloudflare.com/workers/platform/limits/ · https://developers.cloudflare.com/workers/platform/pricing/
- Python Workers: https://developers.cloudflare.com/workers/languages/python/
- Cloudflare D1: https://developers.cloudflare.com/d1/platform/pricing/ · https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare R2: https://developers.cloudflare.com/r2/pricing/
- Cloudflare Registrar: https://www.cloudflare.com/products/registrar/
- Cloudflare Pages, dominios propios: https://developers.cloudflare.com/pages/configuration/custom-domains/
- GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits ·
  https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https
- Netlify: https://www.netlify.com/pricing/
- Vercel: https://vercel.com/pricing · https://vercel.com/docs/limits · https://vercel.com/docs/plans/hobby ·
  https://vercel.com/docs/limits/fair-use-guidelines
- OVHcloud: https://www.ovhcloud.com/es-es/vps/
- Hetzner: https://www.hetzner.com/cloud/regular-performance/ (leída en Chrome) · https://docs.hetzner.com/cloud/servers/overview
- Contabo: https://contabo.com/en/vps/
- Oracle Always Free: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
  (https://www.oracle.com/cloud/free/ devolvió 403)
- Fly.io: https://docs.fly.io/about/pricing · https://fly.io/pricing
- Render: https://render.com/pricing (leída en Chrome) · https://render.com/docs/free · https://render.com/docs/disks ·
  https://render.com/docs/cronjobs
- Railway: https://railway.com/pricing
- Koyeb: https://www.koyeb.com/pricing · https://www.koyeb.com/docs/reference/instances ·
  https://www.koyeb.com/docs/reference/volumes · https://www.koyeb.com/docs/faqs/pricing
- Google Cloud Run: https://cloud.google.com/run/pricing (leída en Chrome)
- Turso: https://turso.tech/pricing
- Porkbun: https://porkbun.com/tld/com · https://porkbun.com/tld/dev · https://porkbun.com/tld/es
- Backblaze B2: https://www.backblaze.com/cloud-storage/pricing

## Anexo: cómo se midió (sin cambios en el repo ni en la BD)

- **Bundle:** `vite build --outDir` a una carpeta temporal fuera del repo.
- **Respuestas de la API:** cliente de pruebas de FastAPI sobre la BD real, solo con GET que no escriben. No se llamó a
  `/matches/{id}/predictions` (escribe) ni a `/admin`. El ajuste de Dixon-Coles se cronometró aparte, sin commit.
- **Tamaños de la BD:** copias con la API de backup de SQLite a una carpeta temporal. Se recortaron y comprimieron allí y
  se borraron después.
- **Memoria y CPU del programador:** contadores de Windows del proceso en marcha.
- **Duraciones de la ingesta:** tabla `ingestion_runs`.
