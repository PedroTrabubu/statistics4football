# statistics4football

[English](README.md) | **Español**

Estadísticas de fútbol de la **Premier League** y **LaLiga**: forma reciente, xG, Elo, enfrentamientos directos, córners, tarjetas y clasificaciones completas por temporada, además de probabilidades de partidos calculadas con un modelo estadístico.

Todas las estadísticas se calculan con resultados reales. Las de cada partido son **point-in-time**: solo usan datos anteriores al partido, nunca el propio partido ni nada jugado después.

## Funcionalidades

- **Tablas por temporada:** para cada equipo, en total, como local y como visitante. Incluyen victorias, empates, derrotas, puntos, goles a favor y en contra, over 1.5/2.5/3.5, ambos marcan, portería a cero, no marcó, córners y tarjetas.
- **Ficha de partido:** forma, enfrentamientos directos, xG reciente, Elo, córners y disciplina de los dos equipos, con un resumen de la temporada de cada uno.
- **Probabilidades de partido:** 1X2, over/under 2.5 y ambos marcan, con un modelo Dixon-Coles ajustado sobre las últimas tres temporadas aproximadamente. Cada probabilidad indica cuántos partidos la respaldan, así que un equipo recién ascendido sin historial aparece marcado como muestra pequeña en lugar de mostrarse con una confianza falsa.
- **Comparación con el mercado (opcional):** cuando hay cuotas pre-partido, la probabilidad del modelo se compara con la probabilidad implícita de las casas de apuestas (quitando su margen). Una pestaña de histórico muestra todas las selecciones pasadas con su resultado real, incluidos los fallos.
- **Glosario:** explicación sencilla de cada métrica.

## Cómo se calculan las probabilidades

1. **Modelo Dixon-Coles:** un modelo de goles de Poisson con una corrección para los marcadores bajos, ajustado por máxima verosimilitud con decaimiento temporal y regularización L2.
2. **Reajuste mensual "walk-forward":** para predecir un mes, el modelo se reajusta solo con los datos disponibles antes de ese mes.
3. **Muestras pequeñas:** los equipos con pocos partidos se acercan a un prior de "equipo flojo". Los ascendidos sin historial parten de ese prior.
4. **Matriz de marcadores:** las probabilidades de 1X2, goles totales, ambos marcan y hándicap asiático se derivan todas de la distribución de marcadores prevista.

Es una herramienta de análisis, no un sistema de apuestas. El backtest fuera de muestra cubre una sola temporada, una muestra demasiado pequeña para demostrar ninguna ventaja. No la uses para apostar dinero real.

## Tecnologías

- **Backend:** Python, FastAPI, SQLAlchemy, Alembic, SQLite, NumPy/SciPy/pandas.
- **Frontend:** React, TypeScript, Vite, React Router.

## Fuentes de datos

| Datos | Fuente |
|---|---|
| Resultados históricos, córners, tarjetas y cuotas de cierre | [Football-Data.co.uk](https://www.football-data.co.uk/) mediante [soccerdata](https://github.com/probberechts/soccerdata) |
| xG por partido | [Understat](https://understat.com/) mediante soccerdata |
| Rating Elo | [ClubElo](http://clubelo.com/) mediante soccerdata |
| Resultados y calendario de la temporada en curso | [football-data.org](https://www.football-data.org/) (plan gratuito) |
| Cuotas pre-partido (opcional) | [The Odds API](https://the-odds-api.com/) (plan gratuito) |

La temporada en curso viene de football-data.org, que solo da resultados. Por eso los córners y las tarjetas solo están disponibles para temporadas ya terminadas.

## Puesta en marcha

### Requisitos

- Python 3.11 o superior
- Node.js 20.19 o superior
- Claves de API gratuitas de [football-data.org](https://www.football-data.org/client/register) y, opcionalmente, de [The Odds API](https://the-odds-api.com/)

### 1. Configuración

Copia `.env.example` a `.env` en la raíz del proyecto y rellena tus claves:

| Variable | Obligatoria | Para qué sirve |
|---|---|---|
| `FOOTBALL_DATA_ORG_API_KEY` | Sí | Resultados y calendario de la temporada en curso |
| `THE_ODDS_API_KEY` | No | Cuotas pre-partido de los próximos partidos |
| `ACTIVE_LEAGUES` | No | Ligas que se cargan (por defecto: `ENG-Premier League,ESP-La Liga`) |
| `EV_THRESHOLD` | No | Valor esperado mínimo para marcar una selección como "value" (por defecto: `0.05`) |

`.env` está en el `.gitignore` y nunca se sube al repositorio.

### 2. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1        # Windows (PowerShell)
# source .venv/bin/activate       # macOS / Linux
pip install -r requirements.txt
alembic upgrade head
python -m uvicorn app.main:app --reload
```

La API se abre en http://127.0.0.1:8000 y la documentación interactiva en http://127.0.0.1:8000/docs.

### 3. Cargar los datos

Desde `backend/`, con el entorno virtual activado:

```bash
python scripts/ingest_historical.py    # temporadas pasadas: resultados, córners, tarjetas, cuotas
python scripts/ingest_xg.py            # xG de Understat
python scripts/ingest_elo.py           # rating Elo de ClubElo
python scripts/ingest_fixtures.py      # temporada en curso: resultados y próximos partidos
python scripts/refresh_odds.py         # opcional: cuotas pre-partido
python scripts/refresh_predictions.py  # probabilidades de los próximos partidos
```

Vuelve a ejecutar `ingest_fixtures.py`, `refresh_odds.py` y `refresh_predictions.py` cuando quieras los últimos resultados. `python scripts/generate_predictions.py` ejecuta el backtest sobre la última temporada terminada.

### 4. Frontend

En otra terminal, con el backend en marcha:

```bash
cd frontend
npm install
copy .env.example .env      # Windows; en macOS / Linux usa cp
npm run dev
```

Abre http://localhost:5173.

### Tests

```bash
cd backend
python -m pytest
```

## API

| Endpoint | Descripción |
|---|---|
| `GET /leagues` | Ligas disponibles |
| `GET /leagues/{id}/seasons` | Temporadas con partidos jugados |
| `GET /leagues/{id}/season-stats?season=` | Tabla de la temporada de todos los equipos |
| `GET /teams?league_id=` | Equipos |
| `GET /teams/{id}/season-stats?season=` | Estadísticas de la temporada de un equipo |
| `GET /matches` | Partidos, filtrables por liga, temporada, estado, equipo y fechas |
| `GET /matches/{id}` | Un partido |
| `GET /matches/{id}/stats` | Forma, enfrentamientos directos, xG y Elo point-in-time |
| `GET /matches/{id}/predictions` | Probabilidades del modelo para un partido |
| `GET /recommendations` | Próximas selecciones de valor (necesita cuotas) |
| `GET /recommendations/history` | Selecciones pasadas con su resultado real |

## Estructura del proyecto

```
backend/
  app/
    api/routers/   endpoints HTTP
    db/models/     tablas de la base de datos
    schemas/       modelos de entrada y salida de la API
    ingestion/     carga de datos de cada fuente
    stats/         forma, enfrentamientos, xG, Elo, disciplina, tablas por temporada
    probability/   modelo Dixon-Coles, cálculos de mercado, valor esperado
  alembic/         migraciones de la base de datos
  scripts/         carga de datos y generación de predicciones
  tests/
frontend/
  src/
    pages/         partidos, ficha de partido, estadísticas, recomendaciones, glosario
    components/
docs/
  DEVLOG.md        diario de desarrollo fase a fase
```

## Diario de desarrollo

[docs/DEVLOG.md](docs/DEVLOG.md) cuenta fase a fase cómo se construyó el proyecto: los bugs reales que aparecieron por el camino y las decisiones de diseño a las que llevaron.
