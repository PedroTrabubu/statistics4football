# Cuotas de Pinnacle: capturas, datos y reglas

Uso privado y académico: las cuotas de Pinnacle no se muestran en la web ni se redistribuyen. Sirven para medir los picks
y el modelo contra el mercado más afinado ([PINNACLE_PROTOCOLO.md](PINNACLE_PROTOCOLO.md)).

La web **no cambia**: probabilidades, valor esperado, Recomendaciones y combinadas siguen usando "Market Average" y
"Market Max" (validados en los backtests pre-registrados). Pinnacle es una referencia paralela, en tablas propias que
ningún cálculo de la web lee (lo comprueba `tests/test_pinnacle_store.py`).

## Puesta en marcha

Las capturas las hace el programador, que arranca solo con Windows y también actualiza los datos
([PROGRAMADOR.md](PROGRAMADOR.md)). La primera vez hace falta `alembic upgrade head` (tablas y vistas de Pinnacle).

Para lanzarlas por separado, desde `backend/` con el entorno virtual activado:

```bash
python scripts/pinnacle_capture.py            # una pasada: solo las ligas a las que les toca
python scripts/pinnacle_capture.py --force    # todas las ligas, ya
python scripts/pinnacle_capture.py --league "ESP-La Liga" --force
python scripts/pinnacle_capture.py --status   # últimas pasadas, fallos, próxima pasada y espacio
python scripts/pinnacle_capture.py --loop     # en marcha, solo Pinnacle (si el programador no lo está)
```

### Vigilancia

- **Registro:** `backend/logs/pinnacle_capture.log` (y la consola). Una línea por pasada: partidos, cruzados, ya
  empezados, cuotas entendidas, filas nuevas, retiradas y avisos.
- **Tabla `pinnacle_captures`:** una fila por pasada con `status` ("ok" o "failed"), `error`, `warnings` y contadores.
- **`--status`:** por liga, la última pasada buena, los fallos de las últimas 24 h, la última fallida si es posterior
  a la buena y su error, y la próxima pasada prevista.

Una pasada fallida no para las demás ni el bucle: se reintenta a los 10 minutos. Si la API cambia de formato, la pasada
queda como fallida con el crudo guardado y los avisos de esquema.

## Cuándo captura

Por liga, según su próximo partido (`app/ingestion/pinnacle_schedule.py`):

| Falta para el próximo partido | Frecuencia |
|---|---|
| Más de 24 h, o sin partidos | Cada 6 h |
| Entre 1 h y 24 h | Cada hora |
| Última hora | Cada 12 min |
| Inicio | Una captura final ~3 min antes (será el cierre) |

Cada pasada son dos peticiones a la liga entera, con un segundo de pausa entre peticiones. Los partidos que empiezan a la
vez comparten pasada, y una captura en los 6 minutos anteriores a un inicio ya cuenta como final. Tras el inicio, un
partido no se guarda como pre-partido.

## Qué se guarda

| Tabla | Contenido |
|---|---|
| `pinnacle_captures` | Una fila por pasada: hora UTC, liga, estado, error, avisos, contadores y ruta del crudo |
| `pinnacle_match_snapshots` | Cada partido en cada pasada: partido de la BD (o sin cruzar), hora de inicio, estado, hora de cierre de apuestas, versión y apuesta máxima del 1X2 |
| `pinnacle_odds` | Una fila cuando una cuota aparece, cambia o se retira (`is_removed`), con su apuesta máxima, clave y versión del mercado |

- **Solo se añade, nunca se actualiza.** Si la versión del mercado no cambia, no se escribe nada; si cambia, solo las
  cuotas que se han movido. Una cuota que desaparece deja una fila de retirada. La primera pasada escribe todas (unas
  7600 en las cuatro ligas); una pasada de LaLiga 11 minutos después escribió 236 de 2032. A ese ritmo la tabla puede
  sumar varios millones de filas por temporada: `--status` muestra cuántas lleva.
- **Crudo:** las dos respuestas JSON de cada pasada, comprimidas, en `data/pinnacle_raw/<liga>/<día>/` (fuera de git).
  Unos 55 KB por liga y pasada: del orden de 1 a 1.5 GB por temporada con las cuatro ligas. Para reparsear:
  `load_raw` y `parse_league` de `app/ingestion`.
- **Esquema:** cada respuesta se compara con los campos conocidos. Un campo que falta o uno nuevo queda como aviso en la
  pasada, sin pararla.

### Apertura, cierre y primera aparición

Están en las vistas `pinnacle_opening_odds`, `pinnacle_closing_odds` y `pinnacle_market_first_seen`, y en
`app/ingestion/pinnacle_queries.py`.

- **Apertura** de una cuota: su primera captura.
- **Cierre:** su estado en la última captura del partido anterior a su hora de inicio (la de Pinnacle en su última
  captura, por si se aplaza). Si en esa captura estaba retirada, no tiene cierre.
- **Primera aparición** de un mercado: la primera captura con alguna cuota suya. Tarjetas y córners abren más tarde
  que el 1X2.

## Mercados

Se capturan:

- **Partido y primera parte:** 1X2, hándicap asiático, totales de goles con líneas alternativas, goles por equipo,
  ambos marcan, doble oportunidad, empate no apuesta y "¿marca X?".
- **Córners:** total, hándicap y por equipo, partido y primera parte. No todos los partidos de LaLiga Hypermotion los
  tienen.
- **Tarjetas** ("Bookings"): total, hándicap, por equipo y quién recibe más. Se abren 1 o 2 días antes. En LaLiga
  Hypermotion solo algunos partidos (3 de 11 el 2026-10-10).

Se ignoran a propósito los especiales que no corresponden a ningún pick: resultado exacto, descanso/final, margen de
victoria, goles exactos, primer equipo en marcar y combinadas.

Pinnacle no tiene histórico, tiros, tiros a puerta, faltas, segundas partes, jugadores, alineaciones, lesiones ni
árbitro.

## Reglas de resolución

### Tarjetas: no comparables con nuestros datos

| | Amarilla | Roja directa | Doble amarilla | Banquillo y cuerpo técnico |
|---|---|---|---|---|
| Pinnacle | 1 | 2 | 3 (1 + 2; la segunda amarilla no cuenta) | No cuentan |
| Winamax | 1 | 2 | 3 | No cuentan |
| Nuestros datos (Football-Data, amarillas + rojas) | 1 | 1 | España y Francia: 2. Inglaterra: 1 | No documentado |

Fuentes: [reglas de Pinnacle](https://www.pinnacle.com/en/future/betting-rules) (texto literal en `MARKET_RULES` de
`app/ingestion/pinnacle.py`) y [notas de Football-Data](https://www.football-data.co.uk/notes.txt). Las reglas de Winamax
salen de un resumen de búsqueda de su página de términos: la página no se pudo abrir porque redirige fuera de España.

En partidos sin rojas las tres coinciden; con una roja, Pinnacle y Winamax cuentan una o dos tarjetas más que nuestros
datos. Por eso los picks de tarjetas quedan **fuera** de las comparaciones con Pinnacle. Una forma de resolverlo sería
calcular "amarillas + 2 × rojas" (igual a la regla de Pinnacle en España y Francia, salvo tarjetas a banquillo), pero no
vale en Inglaterra, donde Football-Data no cuenta la primera amarilla de una doble amarilla.

Esto también afecta a la web: un pick "menos de 4.5 tarjetas" que según nuestros datos se cumple con 3 amarillas y 1
roja (4) se pierde en Winamax, que cuenta 5.

### Córners

Pinnacle cuenta los córners lanzados: uno repetido cuenta una vez y uno concedido y no lanzado no cuenta. Football-Data
no documenta cómo cuenta los suyos. Se asume que son los lanzados, como en las estadísticas habituales, y se comparan:
es la única equivalencia que queda sin comprobar en un documento.

## Histórico de Football-Data

Las cuotas de Pinnacle del CSV de Football-Data.co.uk ya se importan con la ingesta histórica en `match_odds`, cruzadas
por liga, fecha y equipos con el mapa de alias. Origen y momento quedan en el nombre de la casa:

| Casa en `match_odds` | Columnas del CSV | Momento |
|---|---|---|
| `Pinnacle (closing)` | `PSCH/PSCD/PSCA`, `PC>2.5/PC<2.5`, `PCAHH/PCAHA` con `AHCh` | Cierre |
| `Pinnacle` | `PSH/PSD/PSA`, `P>2.5/P<2.5`, `PAHH/PAHA` con `AHh` | Toma de Football-Data: viernes por la tarde o martes |

`python scripts/football_data_pinnacle_coverage.py` lee los CSV de la caché con sus nombres reales de columna y comprueba
que lo importado coincide (coincide en todas las ligas y temporadas). Cobertura:

- **20/21 a 24/25:** completa en las cuatro ligas (alguna fila suelta sin más/menos).
- **25/26:** solo hasta mediados de enero de 2026: unos 190 a 210 partidos por liga.
- **26/27:** el CSV ya no trae columnas de Pinnacle.

## Margen y probabilidades sin margen

`app/probability/devig.py`, funciones puras:

- Overround del mercado completo y tres métodos: proporcional, potencia y Shin. **Predeterminado: Shin**, el mismo con
  el que la web quita el margen a "Market Average". Los informes dan la sensibilidad con el proporcional.
- **Líneas enteras** (2.0): las cuotas solo dan la probabilidad de cada lado si no hay devolución. Para comparar con un
  modelo se condiciona igual y las devoluciones no puntúan.
- **Cuartos de línea** (2.25): mezclan dos apuestas y no son un suceso. Se excluyen de las comparaciones y se cuentan.
- **Doble oportunidad:** se calcula del 1X2 sin margen (el mismo suceso, sin el margen extra de su mercado).

## Informes

```bash
cd frontend && npm run export:picks           # picks de la web, con su motor tal cual (backend en marcha)
cd backend
python scripts/report_picks_vs_pinnacle.py    # picks frente a Pinnacle y evaluación por línea
python scripts/report_reference_comparison.py # Pinnacle frente a "Market Average" y revisión de "Market Max"
```

Escriben en consola y en CSV en `data/reports/` (fuera de git). Resultados en
[PINNACLE_PROTOCOLO.md](PINNACLE_PROTOCOLO.md).
