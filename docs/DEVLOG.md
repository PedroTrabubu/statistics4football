# Diario de desarrollo

> Registro fase a fase de cómo se construyó el proyecto (cuando aún se llamaba Stadistics4bet), con los bugs reales encontrados y las decisiones de diseño que explican. Para una presentación del proyecto, ver el [README](../README.es.md).

## Stadistics4bet

Plataforma de estadisticas de futbol: cruza historico + cuotas de mercado para
estimar la probabilidad real de eventos de un partido (1X2, over/under, BTTS,
handicaps) y detectar valor (EV) frente a las casas de apuestas.

Metodologia: vig-stripping de la cuota de mercado -> probabilidad real via
modelo Poisson/Dixon-Coles (ajustable con xG) -> EV = prob_modelo x cuota - 1
-> umbral configurable -> siempre con nivel de confianza/riesgo, nunca solo el EV.

## Estado actual

- **Fase 1 (hecho):** esqueleto del backend (FastAPI + SQLAlchemy + Alembic),
  modelo de datos, configuracion via `.env`.
- **Fase 2 (hecho, parcial):** ingesta historica reutilizando
  [`soccerdata`](https://github.com/probberechts/soccerdata):
  - `scripts/ingest_historical.py` -> `MatchHistory` (resultados + cuotas de
    cierre de ~11 casas/mercados). 4.180 partidos, 54 equipos, Premier League +
    La Liga, ultimas 6 temporadas.
  - `scripts/ingest_xg.py` -> `Understat` (xG real por partido). 4.177/4.180
    partidos enriquecidos.
  - `scripts/ingest_elo.py` -> `ClubElo` (rating de fuerza de equipo). Codigo
    listo, pero `api.clubelo.com` esta devolviendo 502 ahora mismo (caida del
    servicio externo, no de este proyecto) - reintentar mas adelante.
  - FBref: **aparcado**. En este entorno, el scraper via Selenium/Chrome
    headless funciono una vez y luego se quedo colgado repetidamente contra
    las protecciones anti-bot de FBref (el propio codigo de soccerdata admite
    que no puede resolver captchas en modo headless). No es critico: xG real
    ya lo cubre Understat. Se puede retomar mas adelante con otra estrategia.
  - Pendiente dentro de esta fase: ingesta de proximos partidos/cuotas via
    football-data.org + API-Football (necesita tus API keys).
- **Fase 3 (hecho):** modulo de stats `app/stats/` — forma reciente, H2H,
  xG rolling y Elo, todo calculado *point-in-time* (solo con datos anteriores
  a la fecha del partido, nunca el resultado del propio partido ni partidos
  futuros — verificado con tests). `compute_match_features()` ensambla todo
  para un partido dado. Elo da `None` mientras `elo_ratings` este vacio
  (pendiente de que vuelva `api.clubelo.com`).
- **Fase 4 (hecho, con matices):** motor de probabilidades/EV en
  `app/probability/`:
  - `market.py`: vig-stripping (Shin + multiplicativo) y acuerdo entre casas.
  - `poisson_model.py`: Dixon-Coles ajustado por maxima verosimilitud
    (decaimiento temporal + ventana acotada a ~3 temporadas + regularizacion
    L2), con test que verifica que recupera fuerzas conocidas sobre datos
    sinteticos.
  - `score_markets.py`: deriva 1X2/over-under/BTTS/hancicap asiatico
    (incluidas lineas de cuarto) de la matriz de marcadores.
  - `ev.py`: EV + confianza/riesgo siempre juntos, nunca el EV solo.
  - `engine.py` + `scripts/generate_predictions.py`: ajusta el modelo por
    liga con reajuste mensual "walk-forward" y genera predicciones reales
    contra las cuotas ya ingeridas. 42 tests pasando.
  - **Bug real encontrado y corregido durante el desarrollo:** un equipo sin
    partidos recientes (West Brom, fuera de la liga desde 2020-21) se quedaba
    con un parametro de ataque disparado (mal determinado por falta de
    datos), inflando EV falsos en cualquier partido relacionado. Se arreglo
    acotando la ventana de entrenamiento a ~3 temporadas (un equipo sin
    partidos ahi se trata como "sin historico", no como un dato raro) +
    regularizacion L2 + reajuste mensual en vez de uno solo por temporada.
  - **Resultado del backtest (temporada 2025-26, fuera de muestra) y como
    leerlo:** mixto - por ejemplo Premier League over/under 2.5 en positivo,
    1X2 de La Liga en negativo. Esto **no** significa "el modelo funciona" ni
    "no funciona": una sola temporada es una muestra pequeña y con mucha
    varianza para juzgar una ventaja estadistica. El objetivo de esta fase
    era una metodologia correcta y verificada (vig-stripping, Dixon-Coles,
    EV, confianza/riesgo), no un sistema con ROI probado. Este es un motor de
    **analisis**, no una promesa de ganancia — no usar con dinero real sin
    mucha mas validacion (mas temporadas, mas ligas, paper-trading en vivo).
- **Fase 5 (hecho):** API FastAPI + frontend React.

  Backend, `app/api/routers/`:
  - `GET /leagues`, `GET /teams?league_id=`
  - `GET /matches` (filtros: liga/temporada/status/equipo/fechas), `GET /matches/{id}`
  - `GET /matches/{id}/stats` (forma/H2H/xG/Elo point-in-time, Fase 3)
  - `GET /matches/{id}/predictions` (ajusta el modelo al vuelo, cacheado por
    liga+dia, y genera EV+confianza+riesgo para ese partido concreto)
  - `GET /recommendations` (filtrable por liga/mercado/riesgo/EV minimo)
  - `POST /admin/predictions/generate` (recalcula un rango de fechas)
  - CORS habilitado para un frontend React en local (Vite, puerto 5173).
  - 55 tests pasando (13 nuevos de integracion de API).

  **Tres bugs reales mas, encontrados probando la API contra datos reales**
  (mas alla del de West Brom de la Fase 4) — quedan documentados porque
  explican decisiones de diseño en `engine.py`/`poisson_model.py`:
  1. *Cuotas agregadas corruptas*: football-data.co.uk trae de vez en cuando
     un valor absurdo en las columnas "Market Average/Max" (visto: un
     hancicap asiatico con Market Max=22.0 cuando Bet365/Pinnacle marcaban
     ~1.9 para la misma seleccion) — generaba EV de 9-10 sin que fuera un
     error de nuestro motor. Se corrigio comparando el agregado contra las
     casas individuales trackeadas y usando el mejor precio individual si el
     agregado se dispara mas de 1.8x por encima (`engine._sane_price`).
  2. *Prior de equipo ascendido*: un equipo sin ningun partido en la ventana
     de entrenamiento se asumia "equipo medio" (attack=defense=0), pero un
     ascendido tipico rinde por debajo de la media real de la liga — se
     cambio el fallback a la media del cuartil mas flojo de la liga en vez
     de la media general (`promoted_attack_prior`/`promoted_defense_prior`).
  3. *Equipo con muy pocos partidos (no cero)*: Sunderland, recien ascendido
     y con solo ~8 partidos jugados en la temporada de test, salia con una
     defensa "mejor que la del Chelsea" por puro ruido de muestra pequeña
     (Chelsea-Sunderland llegaba a un 57% de probabilidad de empate, una
     cifra irreal). Se añadio un encogido proporcional a cuantos partidos
     ponderados por tiempo respalda a cada equipo: por debajo de ~25
     partidos efectivos, el equipo se acerca gradualmente al prior de
     "equipo flojo" en vez de fiarse del ajuste puro.

  Tras estas correcciones, el backtest de la Fase 4 mejoro en casi todos los
  mercados (ver `scripts/generate_predictions.py`), aunque sigue siendo un
  resultado de una sola temporada — las mismas cautelas de la Fase 4 aplican.

  Frontend, `frontend/` (React + TypeScript + Vite + react-router):
  - `/` — listado de partidos, filtros por liga/estado, paginado.
  - `/matches/:id` — ficha de partido: forma/H2H/xG/Elo + tabla de
    probabilidades/EV por mercado (1X2, over/under, hancicap), siempre con
    confianza y riesgo junto al EV, filas de valor resaltadas.
  - `/recommendations` — recomendaciones filtrables por liga/mercado/riesgo/EV
    minimo.
  - Probado en navegador real (Chrome, via claude-in-chrome): las 3 paginas
    cargan datos reales de la API, los filtros refrescan en vivo, consola sin
    errores.

- **Fase 6 (hecho):** proximos partidos reales + probabilidades sin depender
  de cuotas de casas de apuestas (pivote de enfoque: el objetivo pasa a ser
  estadisticas reales de partidos,
  no EV de mercado).

  - `scripts/ingest_fixtures.py` -> `app/ingestion/fixtures_backfill.py`
    (`sync_current_season_matches`): sincroniza la temporada en curso via
    `football-data.org` (tier gratuito, ~10 req/min) — partidos ya jugados
    (con marcador real, quedan `HISTORICAL`) y por jugar (`SCHEDULED`).
    Re-ejecutable en cualquier momento para traer los resultados mas
    recientes segun se van jugando. Idempotente (identifica un partido por
    liga+temporada+local+visitante, no por fecha exacta, porque los partidos
    aun no jugados se pueden aplazar). Equipos recien ascendidos sin
    historico en la BD (ej. Coventry, Hull City, Malaga, Deportivo La
    Coruña, Racing Santander en la temporada 2026-27) se crean
    automaticamente — caen en el prior de "equipo ascendido" de la Fase 4
    sin cambios. **API-Football/RapidAPI se descarta**: el objetivo ya no es
    comparar contra cuotas, y ademas resulto no estar accesible de forma
    fiable en RapidAPI para el usuario.
  - `app/probability/engine.py`: `generate_predictions_for_match` ya no
    depende de que existan cuotas para un partido/mercado. Si no hay cuotas
    ingeridas (el caso normal para partidos futuros), genera igualmente la
    probabilidad real del modelo (Dixon-Coles) para 1X2, over/under 2.5 y
    BTTS, con `confidence`/`risk_level` basados solo en cuanto historico
    respalda a esos equipos (sin EV, sin `prob_market_implied` — quedan a
    `null`, nunca se inventan). El handicap asiatico sigue dependiendo de
    cuotas (necesita una linea, que hasta ahora siempre venia del mercado).
  - **Bug/gap real encontrado durante esta fase:** BTTS estaba implementado
    en `score_markets.py` (`probabilities_btts`) desde la Fase 4 pero nunca
    se habia conectado a `generate_predictions_for_match` — no aparecia en
    ningun sitio de la API. Se conecto ahora; como football-data.co.uk no
    trae cuotas de BTTS en sus CSV, este mercado sale siempre en modo "solo
    estadisticas" (nunca ha tenido EV, ni antes ni ahora).
  - `model_predictions.prob_market_implied`/`.ev` pasan a ser nullable
    (migracion Alembic `a1c4f9d2e0b3`) para poder representar esto sin
    inventar un EV falso. 633 partidos futuros ya ingeridos (343 Premier
    League, 290 La Liga) y probados en vivo contra la API real, incluido un
    caso de equipo sin historico (Coventry vs Brighton: confidence=0.0,
    risk=high, como se espera) y uno con historico completo (Man United vs
    Man City: confidence=1.0, risk=low).

  Frontend (`PredictionsTable`): cuando `ev`/`prob_market_implied` llegan
  `null`, se muestra "—" en vez de un `0.0%` enganoso (bug real: `null >= 0`
  es `true` en JS, asi que sin este fix un partido sin cuotas se pintaba en
  verde como si tuviera EV positivo).

- **Fase 6b (hecho):** estadisticas descriptivas agregadas por temporada,
  — la pieza que
  faltaba respecto a `/matches/{id}/stats` (que es point-in-time por
  partido, no un agregado por equipo/temporada).

  - `app/stats/season_stats.py` + `GET /leagues/{id}/season-stats?season=`:
    por cada equipo de una liga/temporada (la mas reciente jugada si no se
    especifica), splits Total/Local/Visitante con PJ/G/E/P/Pts, goles a
    favor/en contra (totales y media), y **% over 1.5/2.5/3.5, % ambos
    anotan, % porteria a cero, % no marco** — todo calculado sobre
    resultados reales, sin cuotas ni modelo de por medio.
  - `GET /leagues/{id}/seasons`: temporadas con partidos ya jugados (para
    el selector del frontend).
  - Frontend: pagina nueva `/stats` — tabla ordenable por liga/temporada con
    pestañas Total/Local/Visitante, ordenada por puntos (verificada en
    navegador real contra datos de la temporada 2025-26 completa).
  - 6 tests nuevos (`test_season_stats.py`): splits local/visitante,
    porcentajes/medias, equipos sin partidos excluidos de la tabla,
    partidos `scheduled` ignorados, temporada mas reciente por defecto.
  - `GET /teams/{id}/season-stats?season=`: lo mismo pero para un solo
    equipo (404 si no hay datos, ej. equipo recien ascendido sin partidos
    jugados todavia). Integrado en la ficha de partido (`/matches/:id`):
    resumen compacto de temporada de ambos equipos + link a la tabla
    completa de la liga (con `?league=` para preseleccionarla). Si un
    equipo no tiene stats (recien ascendido), se muestra "—" en sus columnas
    sin romper el resto — probado en Coventry vs Brighton (Coventry sin
    datos, Brighton con su temporada 2025-26 completa).

- **Fase 6c (hecho):** bug real reportado por el usuario — la temporada en
  curso (2026-27) no aparecia en ningun lado (ni en `/stats` ni en el modelo)
  porque `fixtures_backfill.py` solo traia partidos SCHEDULED/TIMED de
  football-data.org (los que aun no se juegan), nunca los ya jugados de la
  temporada activa. El historico "de fondo" (soccerdata/MatchHistory) cubre
  temporadas *cerradas*; nadie estaba trayendo los resultados de la
  temporada que esta en curso ahora mismo.

  - `football_data_client.get_season_matches()` (antes `get_upcoming_matches`,
    filtrado a SCHEDULED/TIMED): ahora pide la competicion sin filtro de
    `status`, que devuelve toda la `currentSeason` (jugados + por jugar) en
    una sola llamada.
  - `fixtures_backfill.sync_current_season_matches()` (antes
    `backfill_upcoming_fixtures`): los partidos con `status=FINISHED` se
    guardan como `HISTORICAL` con su marcador real; el resto como
    `SCHEDULED`. Re-ejecutable en cualquier momento conforme avanza la
    jornada. Probado contra la API real: 37 partidos ya jugados de Premier
    League + 46 de La Liga entraron a la BD (antes: 0).
  - Efecto en cadena, verificado: `/leagues/{id}/season-stats` ahora
    muestra "26/27" con datos reales por defecto (antes solo se veia
    "25/26", la ultima temporada *cerrada*). El motor Dixon-Coles tambien
    empieza a usar estos partidos de la temporada actual al ajustar el
    modelo (las predicciones de partidos futuros cambian ligeramente al
    incorporar la forma real de esta temporada).
  - Bug secundario relacionado, tambien reportado: `GET /matches` sin
    filtro de estado ordenaba siempre por fecha descendente, así que la
    vista de "Partidos" mostraba primero el ultimo partido de la temporada
    (30 may 2027) en vez de los proximos partidos reales. Corregido:
    con `status=scheduled` ahora ordena ascendente (los mas cercanos
    primero); el frontend ademas filtra por "Programados" por defecto al
    entrar.

- **Fase 7 (hecho):** corners/tarjetas, auditoria visual del frontend, y dos
  bugs reales de transparencia reportados por el usuario.

  - **Corners y tarjetas ya estaban en el CSV de MatchHistory** (columnas
    HC/AC/HY/AY/HR/AR/HF/AF/HS/AS/HST/AST) y nunca se leian. Ahora
    `historical_backfill.py` las guarda en `team_match_stats`
    (`corners_for`/`corners_against`/`fouls`/`yellow_cards`/`red_cards`,
    migracion `d4e7b1c9a2f5`) y se exponen en dos sitios: forma reciente
    point-in-time (`app/stats/discipline.py`, ficha de partido) y agregado
    por temporada con split Local/Visitante (`season_stats.py`). Limitacion
    real, mostrada en la UI en vez de ocultada: la temporada en curso viene
    de football-data.org (solo resultados, sin corners), asi que el split
    de corners solo esta disponible en temporadas ya cerradas.
  - **Auditoria visual real** (Playwright + capturas antes/despues, no solo
    lectura de codigo): identidad visual nueva coherente con la
    especificacion de producto (Fraunces/IBM Plex, verde de cesped
    desaturado en vez de azul generico de SaaS), nav con hamburguesa en
    movil, tablas reorganizadas.
  - **Bug real encontrado en la auditoria:** `confidence` saturaba en 100%
    para casi cualquier partido con algo de historico (se calcula sobre
    `matches_used/20`, y el modelo entrena con ~3 temporadas), asi que la
    UI mostraba "Confianza: 100%" sin informacion real. Se añadio
    `model_predictions.matches_used` (migracion `f2a8c6d1b7e3`) y se
    sustituyo el porcentaje por tres niveles cualitativos + el n real
    ("Muestra amplia n=128"), como pide la especificacion (nunca un score
    con pinta cientifica sin metodologia detras). Los EV por encima de
    ±40% (normalmente sintoma de desacuerdo extremo con el mercado, no
    valor real) se marcan visualmente como "revisar" en vez de mostrarse
    igual que un EV moderado.
  - **Bug real reportado por el usuario:** `/recommendations` mezclaba
    recomendaciones de partidos futuros con las de
    `scripts/generate_predictions.py` (backtest walk-forward sobre la
    temporada ya jugada, pensado para evaluar el modelo, no para mostrarse
    a usuarios) — la pagina de Recomendaciones enseñaba partidos antiguos.
    Separado en dos: `/recommendations` ahora filtra estrictamente
    `Match.status == SCHEDULED`, y `/recommendations/history` (nuevo, pestaña
    "Historico" en la UI) muestra las recomendaciones ya resueltas con su
    resultado real, aciertos/fallos/pendientes siempre visibles (nunca se
    excluyen los fallos) — logica de resolucion compartida en
    `app/probability/outcomes.py`.
  - **Gap real destapado al separar ambas listas:** con el filtro correcto,
    "Recomendaciones -> Proximas" sale vacia. No es un bug: `is_recommended`
    exige una cuota real de mercado para calcular EV, y hoy no existe
    ninguna fuente de cuotas para partidos que aun no se han jugado (solo
    para los ya jugados, via el CSV historico). Sigue sin resolver — es
    la funcionalidad "Cuotas y valor estadistico" de la especificacion
    (V1), no algo que se arregle sin contratar/integrar una fuente de
    cuotas en vivo. Mientras tanto, el comparador manual "Tu cuota" en la
    ficha de cada partido cubre el caso de uso individual.
  - `scripts/refresh_predictions.py` (nuevo): genera y persiste predicciones
    para los partidos `SCHEDULED` de las ligas activas, re-ejecutable en
    cualquier momento — sin esto, `/recommendations` solo tenia datos de los
    partidos que alguien hubiera visitado individualmente.

- **Fase 8 (hecho):** cuotas reales pre-partido para partidos futuros — cierra
  el gap que dejaba la Fase 7 ("Recomendaciones -> Proximas" vacia por falta
  de una fuente de cuotas para partidos aun no jugados).

  - Evaluadas varias fuentes antes de elegir (ver comparativa completa en el
    hilo de la especificacion): The Odds API (plan gratuito: 500
    creditos/mes, cubre EPL+LaLiga con h2h+totals, ToS permite
    explicitamente uso en "dashboards analiticos" y guardar el dato
    indefinidamente), API-Football directo, Betfair Exchange (alta de
    £499 para clave "Live" de produccion) y **scrapear un portal de estadisticas de terceros**
    (descartado: no publica cuotas, solo estadisticas que ya calculamos
    nosotros mismos con mas rigor; ademas riesgo real de *database right*
    al scrapear a un competidor, sin aportar nada a este
    proyecto). Se eligio The Odds API.
  - `app/ingestion/odds_api_client.py` + `app/ingestion/prematch_odds_backfill.py`
    + `scripts/refresh_odds.py`: cuotas h2h+totals por liga, calculando
    "Market Average"/"Market Max" a partir de las casas devueltas (igual que
    football-data.co.uk trae precalculado en su CSV) y guardando
    Bet365/Pinnacle/William Hill con esos mismos nombres para que
    `bookmaker_agreement` en `engine.py` siga funcionando sin cambios. btts
    queda fuera (requiere plan de pago de the-odds-api.com).
  - Bug real encontrado al primer intento: 9 equipos sin resolver
    (`Brighton and Hove Albion`, `Coventry City`, `Hull City`,
    `Ipswich Town`, `Leeds United`, `Tottenham Hotspur`, `Athletic Bilbao`,
    `Atlético Madrid`, `Deportivo La Coruña`) — the-odds-api.com usa nombres
    largos distintos a los ya cubiertos en `team_names.py` (que solo
    tenia los de Understat/football-data.org). Anadidos los 9 alias que
    faltaban; segunda ejecucion: 36 partidos con cuotas, 0 sin resolver.

## Ligas del MVP

Premier League (Inglaterra) y La Liga (España). Configurable en `.env` via
`ACTIVE_LEAGUES` (usa los IDs canonicos de `soccerdata`, ej. `ENG-Premier League`).

## Setup backend

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy ..\.env.example ..\.env    # y rellena las API keys cuando las tengas
alembic upgrade head
python -m uvicorn app.main:app --reload
```

Prueba: `GET http://127.0.0.1:8000/health` -> `{"status": "ok"}`.

## Setup frontend

Con el backend ya corriendo en otra terminal:

```powershell
cd frontend
npm install
copy .env.example .env
npm run dev
```

Abre http://localhost:5173.

## Fuentes de datos y por que no reinventamos scraping

Historico de resultados + cuotas: `soccerdata.MatchHistory` (Football-Data.co.uk).
xG: `soccerdata.Understat`. Ratings de fuerza de equipo: `soccerdata.ClubElo`.
Stats avanzadas: `soccerdata.FBref` (via Selenium, mas lento/fragil ante anti-bot,
por eso se cachea agresivamente). Proximos partidos: football-data.org (fixtures,
tier gratuito). Cuotas pre-partido: API-Football/RapidAPI (tier gratuito, ~100
req/dia: se consulta solo para los partidos ya filtrados por interes, nunca en bulk).

Necesitas cuentas gratuitas propias para:
- https://www.football-data.org/client/register
- https://rapidapi.com/api-sports/api/api-football

## API keys

Copia `.env.example` a `.env` en la raiz del proyecto y rellena las claves.
Nunca se commitea `.env` (esta en `.gitignore`).
