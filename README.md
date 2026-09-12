# Stadistics4bet

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

  **Pendiente:** ingesta de proximos partidos/cuotas reales (football-data.org
  + API-Football, necesita tus API keys) para poder generar recomendaciones
  sobre partidos que aun no se han jugado — el caso de uso real del proyecto.
  Ahora mismo `/matches/{id}/predictions` funciona perfectamente sobre
  partidos historicos (para explorar/backtestear) pero no hay partidos
  `scheduled` en la BD todavia.

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
