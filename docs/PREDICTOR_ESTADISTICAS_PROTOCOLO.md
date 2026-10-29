# Predictor de estadísticas del partido (protocolo)

Escrito el 2026-10-27, antes de calcular ninguna predicción. Es un bloque **nuevo** de la ficha de partido. No cambia
ningún otro modelo ni ninguna cifra de la web.

## Qué se muestra

En la ficha de un partido **por jugar** no se muestra nada de entrada. Hay un botón, "Predictor de estadísticas", y al
pulsarlo aparecen las cifras esperadas de cada equipo, en la misma tabla en espejo que las estadísticas de un partido
jugado:

- xG (solo en las ligas con xG: Premier League, LaLiga, Serie A, Bundesliga y Ligue 1);
- tiros, tiros a puerta, córners, faltas, tarjetas amarillas y tarjetas rojas.

Solo aparecen las estadísticas que pasan la evaluación de abajo. Cada una lleva el error medio que tuvo en ella. Las que
no la pasan se nombran aparte, con el motivo. La Champions no tiene predictor: sus equipos tienen pocos partidos
anteriores de la competición y no entra en la evaluación.

## Modelo (`frontend/src/lib/statsPredictor.ts`)

Es el mismo método que los córners esperados del duelo de córners
([DUELO_CORNERES_MODELO_PROTOCOLO.md](DUELO_CORNERES_MODELO_PROTOCOLO.md)), aplicado a cada estadística:

1. **Datos:** los partidos de la liga jugados **antes** del partido (fecha estrictamente anterior), de su temporada y
   de la anterior. Es lo que ya carga la web. El propio partido nunca entra.
2. **Valor por equipo y partido:** la cifra de cada equipo, a favor. La de su rival es la que concede. Un partido sin
   esa estadística (vacía) no cuenta para ella.
3. **Recorte:** los córners a 14, como en el duelo. El resto, sin recorte.
4. **Peso de cada partido:** `exp(-0.0018 × días)`.
5. **Media de la liga** por campo (lo del local y lo del visitante), con esos pesos.
6. **Encogimiento** hacia la liga, de 5 partidos: lo que saca y concede el local en casa, y lo que saca y concede el
   visitante fuera. La fórmula es `(Σ peso × valor + 5 × media de la liga) / (Σ pesos + 5)`.
7. **Valor esperado:** local = (lo que saca el local en casa × lo que concede el visitante fuera) / media de la liga del
   local. El visitante, igual al revés.

Las constantes (decaimiento 0.0018, encogimiento 5, recorte 14 en córners) se toman tal cual de los modelos anteriores.
**No se ajusta nada.** En córners, el valor esperado coincide exactamente con el del duelo, y hay un test que lo
comprueba.

## Evaluación

Una sola vez, con el script `frontend/scripts/backtest-stats-predictor.ts`. Importa el código de la web
(`src/lib/statsPredictor.ts`) sin cambiarlo.

- **Partidos:** todos los jugados de la 25/26 completa y de lo jugado de la 26/27 hasta hoy. Ligas: Premier League,
  LaLiga, LaLiga 2, Ligue 1, Bundesliga y Serie A. Cada partido solo ve sus anteriores, como en el punto 1.
- **Unidad:** equipo y partido. Cada partido da dos observaciones, local y visitante, si la estadística observada no
  está vacía. Para el xG, solo cuentan las cinco ligas con xG.
- **Métrica principal:** error absoluto medio (MAE) por estadística. Secundaria: RMSE.
- **Bases**, con los mismos partidos anteriores y las mismas observaciones:
  - (a) **Liga:** la media simple de la liga para un local o un visitante (sin pesos);
  - (b) **Media del equipo:** la media simple de lo que saca el equipo en ese campo (sin pesos, sin encogimiento, sin
    rival). Si no tiene partidos, la de (a).
- **Intervalo:** diferencia de MAE (modelo − base), al 95 %. Se remuestrean partidos (los dos equipos de cada partido,
  juntos) 2000 veces con la semilla 20261027.
- **Regla de decisión, fija desde ahora:** una estadística aparece en el predictor si su MAE es menor que el de las dos
  bases **y** el intervalo de la diferencia con cada una queda entero por debajo de 0. Si no, no aparece. La web la
  nombra como "sin estimación: no mejora a la media de la liga o del equipo en el histórico".
- **Solo informativo** (no decide nada): MAE por liga y por temporada, y la mejora en % frente a la base (a).
- **En la web:** junto a cada estadística que aparece va el MAE del modelo en esta evaluación ("error medio ±x").

**Prueba del script:** antes del test, el script se ejecuta sobre la 22/23 (fuera del test) para ver que funciona. Ese
resultado también se publica debajo, y nada del modelo, las constantes ni la regla se cambia por lo que muestre. No se
cambia ninguna constante, base, métrica ni definición después de ver el resultado del test.

## Resultados

Se añaden debajo. Las cifras son la salida de `npm run backtest:stats`, copiada tal cual. "Obs." son equipos-partido.

### 2026-10-27: prueba del script, 22/23 (no es el test)

2288 partidos de las seis ligas. Solo sirve para ver que el script funciona. No cambió nada.

| Estadística | Obs. | MAE modelo | MAE liga (a) | MAE equipo (b) | Modelo − liga [IC 95 %] | Modelo − equipo [IC 95 %] | Mejora vs liga | ¿Pasaría? |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| xG | 3652 | 0.616 | 0.681 | 0.642 | -0.065 [-0.075, -0.053] | -0.026 [-0.034, -0.018] | 9.5 % | Sí |
| Tiros | 4576 | 3.46 | 3.83 | 3.71 | -0.36 [-0.42, -0.31] | -0.24 [-0.29, -0.21] | 9.5 % | Sí |
| Tiros a puerta | 4576 | 1.73 | 1.85 | 1.80 | -0.12 [-0.14, -0.09] | -0.07 [-0.09, -0.05] | 6.3 % | Sí |
| Córners | 4576 | 2.06 | 2.15 | 2.14 | -0.09 [-0.11, -0.06] | -0.08 [-0.10, -0.06] | 4.0 % | Sí |
| Faltas | 4576 | 2.93 | 3.07 | 3.07 | -0.14 [-0.18, -0.11] | -0.14 [-0.17, -0.11] | 4.6 % | Sí |
| Amarillas | 4576 | 1.130 | 1.146 | 1.153 | -0.016 [-0.028, -0.005] | -0.023 [-0.032, -0.013] | 1.4 % | Sí |
| Rojas | 4576 | 0.196 | 0.196 | 0.196 | 0.000 [-0.003, 0.003] | -0.001 [-0.003, 0.001] | -0.0 % | No |

### 2026-10-27: test, 25/26 completa y 26/27 hasta hoy (2729 partidos)

Seis ligas. Para el xG, 2144 partidos de las cinco ligas con xG.

| Estadística | Obs. | MAE modelo | MAE liga (a) | MAE equipo (b) | Modelo − liga [IC 95 %] | Modelo − equipo [IC 95 %] | Mejora vs liga | RMSE modelo / liga / equipo | ¿Aparece? |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| xG | 4288 | 0.653 | 0.708 | 0.676 | -0.055 [-0.065, -0.046] | -0.023 [-0.031, -0.016] | 7.8 % | 0.840 / 0.910 / 0.865 | Sí |
| Tiros | 5458 | 3.69 | 4.01 | 3.88 | -0.31 [-0.36, -0.26] | -0.19 [-0.23, -0.15] | 7.8 % | 4.72 / 5.11 / 4.93 | Sí |
| Tiros a puerta | 5458 | 1.78 | 1.89 | 1.84 | -0.11 [-0.13, -0.09] | -0.06 [-0.08, -0.04] | 5.8 % | 2.24 / 2.37 / 2.30 | Sí |
| Córners | 5458 | 2.10 | 2.16 | 2.16 | -0.06 [-0.08, -0.04] | -0.05 [-0.07, -0.03] | 2.7 % | 2.69 / 2.76 / 2.75 | Sí |
| Faltas | 5458 | 2.90 | 3.09 | 3.03 | -0.20 [-0.23, -0.16] | -0.13 [-0.16, -0.10] | 6.3 % | 3.65 / 3.87 / 3.82 | Sí |
| Amarillas | 5458 | 1.090 | 1.086 | 1.103 | 0.004 [-0.006, 0.014] | -0.013 [-0.022, -0.004] | -0.4 % | 1.370 / 1.371 / 1.393 | No |
| Rojas | 5458 | 0.184 | 0.185 | 0.184 | -0.001 [-0.003, 0.001] | -0.000 [-0.002, 0.002] | 0.4 % | 0.334 / 0.325 / 0.336 | No |

Solo informativo. MAE del modelo / MAE de la liga (a):

| Por liga | xG | Tiros | Tiros a puerta | Córners | Faltas | Amarillas | Rojas |
|---|---:|---:|---:|---:|---:|---:|---:|
| Premier League | 0.644 / 0.688 | 3.44 / 3.77 | 1.70 / 1.76 | 2.07 / 2.16 | 2.63 / 2.73 | 1.038 / 1.034 | 0.111 / 0.113 |
| LaLiga | 0.618 / 0.685 | 3.78 / 4.22 | 1.74 / 1.93 | 2.13 / 2.20 | 2.87 / 3.20 | 1.124 / 1.126 | 0.227 / 0.227 |
| LaLiga 2 | — | 3.61 / 3.76 | 1.79 / 1.83 | 2.09 / 2.09 | 3.11 / 3.26 | 1.232 / 1.233 | 0.226 / 0.229 |
| Ligue 1 | 0.689 / 0.715 | 3.81 / 4.13 | 1.85 / 1.96 | 2.15 / 2.23 | 2.96 / 3.14 | 0.995 / 0.973 | 0.214 / 0.209 |
| Bundesliga | 0.717 / 0.790 | 3.82 / 4.09 | 1.91 / 2.05 | 2.08 / 2.16 | 2.67 / 2.85 | 1.098 / 1.071 | 0.159 / 0.157 |
| Serie A | 0.618 / 0.683 | 3.78 / 4.17 | 1.74 / 1.89 | 2.11 / 2.17 | 3.05 / 3.28 | 0.997 / 1.012 | 0.155 / 0.159 |

| Por temporada | xG | Tiros | Tiros a puerta | Córners | Faltas | Amarillas | Rojas |
|---|---:|---:|---:|---:|---:|---:|---:|
| 25/26 | 0.643 / 0.694 | 3.59 / 3.92 | 1.76 / 1.87 | 2.11 / 2.16 | 2.86 / 3.07 | 1.097 / 1.091 | 0.188 / 0.187 |
| 26/27 | 0.699 / 0.772 | 4.13 / 4.38 | 1.88 / 1.98 | 2.09 / 2.16 | 3.04 / 3.19 | 1.061 / 1.061 | 0.167 / 0.176 |

**Decisión (regla del protocolo):** aparecen xG, tiros, tiros a puerta, córners y faltas. No aparecen las amarillas: en
la prueba de la 22/23 habrían pasado, pero en el test el modelo no mejora a la media de la liga (+0.004 [−0.006, +0.014]),
y manda el test. Tampoco aparecen las rojas.

**Lectura:** la mejora es real, pero pequeña. Tiene entre un 2.7 % (córners) y un 7.8 % (tiros y xG) menos de error que
la media de la liga. El error típico sigue siendo grande: ±3.7 tiros, ±1.8 tiros a puerta, ±2.1 córners, ±2.9 faltas y
±0.65 xG por equipo. Por eso la web da cada cifra con su error medio y no la presenta como lo que va a pasar.

## Ampliación: el árbitro en las tarjetas (protocolo, 2026-10-27)

Escrita después del test de arriba y **antes de calcular nada con el árbitro**. En ese test, las amarillas y las rojas
sin árbitro no pasaron. La pregunta nueva es si las tarjetas se pueden estimar teniendo en cuenta al árbitro designado.
El modelo y los resultados de las otras estadísticas no cambian.

### Modelo

Se parte del valor esperado de cada equipo del modelo de arriba (pasos 1-7) y se multiplica por un **factor del
árbitro**, el mismo para los dos equipos. El factor sale de los partidos anteriores de ese árbitro: los de la liga, en
la ventana de siempre (la temporada del partido y la anterior, fecha estrictamente anterior), con el peso
`exp(-0.0018 × días)` y las tarjetas de los dos equipos juntas (amarillas por un lado, rojas por otro). Hay dos formas
de calcularlo:

- **R1 (bruto):** media ponderada de tarjetas por partido del árbitro / media ponderada de la liga, encogida hacia 1:
  `((Σ w × tarjetas + K × m) / (Σ w + K)) / m`, con `m` la media de la liga por partido.
- **R2 (ajustado por equipos):** lo que hubo en sus partidos frente a lo que el modelo de equipos esperaba en ellos,
  con las fuerzas de los equipos calculadas con los mismos partidos anteriores al partido que se predice:
  `(Σ w × observadas + K × m) / (Σ w × esperadas + K × m)`. Así no se culpa al árbitro de haber pitado a equipos que
  ya sacan muchas tarjetas.

Un árbitro sin partidos anteriores en la ventana tiene factor 1, es decir, el modelo sin árbitro.

### Elección de la variante (validación)

Seis variantes: R1 y R2 con `K` = 5, 10 y 20 partidos. Se eligen con la **24/25** (ventana 24/25 + 23/24) en las seis
ligas, una temporada que no se ha usado en ninguna prueba. Se queda, para cada estadística (amarillas y rojas), la
variante con menor MAE. La validación también da, como referencia, el MAE del modelo sin árbitro y el de la base (a).
No se mira ninguna cifra del test para elegir.

### Test

Una sola vez, con la variante elegida, sobre los mismos partidos del test de arriba (25/26 completa y 26/27 hasta el
2026-10-27, seis ligas). Solo entran los partidos con árbitro conocido, que en estas temporadas son todos. Métricas,
remuestreo (2000 veces, semilla 20261027) y bases (a) y (b), iguales que arriba. Se añade una base más:

- (c) **El modelo sin árbitro** (el de arriba): mide lo que aporta el árbitro.

**Regla de decisión (la misma):** una estadística de tarjetas aparece si su MAE es menor que el de (a) y el de (b) y el
intervalo de la diferencia con cada una queda entero por debajo de 0. La comparación con (c) se publica, pero no decide.

**En la web:** las tarjetas que pasen solo aparecen cuando hay árbitro designado, con su nombre y con cuántos partidos
suyos hay detrás. Sin árbitro designado, no se estiman.

### 2026-10-27: validación, 24/25 (2214 partidos, todos con árbitro)

Solo sirve para elegir la variante. Árbitros: mediana de 23 partidos anteriores en la ventana; 23 partidos con un árbitro
sin ninguno y 90 con menos de 5.

| Estadística | Obs. | Liga (a) | Sin árbitro (c) | R1 K=5 | R1 K=10 | R1 K=20 | R2 K=5 | R2 K=10 | R2 K=20 | Elegida |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Amarillas | 4426 | 1.1427 | 1.1384 | 1.1345 | 1.1330 | 1.1328 | 1.1339 | 1.1326 | 1.1330 | R2 K=10 |
| Rojas | 4426 | 0.1775 | 0.1747 | 0.1761 | 0.1757 | 0.1754 | 0.1755 | 0.1752 | 0.1750 | R2 K=20 |

### 2026-10-27: test con árbitro, 25/26 completa y 26/27 hasta hoy (2729 partidos, todos con árbitro)

Árbitros: mediana de 22 partidos anteriores en la ventana; 46 partidos con un árbitro sin ninguno y 203 con menos de 5.

| Estadística | Variante | Obs. | MAE modelo | MAE liga (a) | MAE equipo (b) | MAE sin árbitro (c) | Modelo − liga [IC 95 %] | Modelo − equipo [IC 95 %] | Modelo − sin árbitro [IC 95 %] | Mejora vs liga | ¿Aparece? |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Amarillas | R2 K=10 | 5458 | 1.083 | 1.086 | 1.103 | 1.090 | -0.003 [-0.014, 0.007] | -0.020 [-0.030, -0.011] | -0.007 [-0.012, -0.003] | 0.3 % | No |
| Rojas | R2 K=20 | 5458 | 0.184 | 0.185 | 0.184 | 0.184 | -0.001 [-0.003, 0.001] | -0.000 [-0.003, 0.002] | -0.000 [-0.001, 0.001] | 0.6 % | No |

Solo informativo. Por liga, MAE del modelo con árbitro / sin árbitro (c) / liga (a):

| Por liga | Amarillas | Rojas |
|---|---:|---:|
| Premier League | 1.039 / 1.038 / 1.034 | 0.111 / 0.111 / 0.113 |
| LaLiga | 1.116 / 1.124 / 1.126 | 0.226 / 0.227 / 0.227 |
| LaLiga 2 | 1.220 / 1.232 / 1.233 | 0.227 / 0.226 / 0.229 |
| Ligue 1 | 0.999 / 0.995 / 0.973 | 0.215 / 0.214 / 0.209 |
| Bundesliga | 1.087 / 1.098 / 1.071 | 0.158 / 0.159 / 0.157 |
| Serie A | 0.982 / 0.997 / 1.012 | 0.153 / 0.155 / 0.159 |

**Decisión (regla del protocolo):** ni las amarillas ni las rojas aparecen, tampoco con el árbitro.

**Lectura:**
- **El árbitro sí aporta en las amarillas.** Con él, el modelo tiene menos error que sin él (−0.007, con el intervalo
  por debajo de 0), más en LaLiga, LaLiga 2, Bundesliga y Serie A que en la Premier y la Ligue 1.
- **No basta para superar a la media de la liga.** La parte de los equipos ya era algo peor que esa media (1.090 frente
  a 1.086), y el árbitro solo compensa esa pérdida: −0.003, con un intervalo de −0.014 a +0.007.
- **En las rojas no hay nada medible:** son pocas y casi aleatorias.
- **La idea que sale de aquí** es "media de la liga × factor del árbitro", sin la parte de los equipos. Sale de mirar el
  test, así que **no se puede comprobar con estos mismos partidos**. Si se quiere probar, necesita su propio protocolo y
  partidos que nadie haya mirado: los que se jueguen a partir de hoy.

## Ampliación 2: mejorar el modelo (protocolo, 2026-10-27)

Escrita **antes de calcular nada** con los modelos nuevos. Busca un modelo con menos error que el publicado (arriba) en
las siete estadísticas, también las tarjetas.

**Aviso de honestidad.** El test (25/26 + 26/27) ya se ha usado dos veces: el modelo publicado y el árbitro. Esta es la
tercera. Algunas ideas de abajo salen de haber visto esos resultados, como la de "liga × árbitro". Para que el test siga
valiendo, aquí **no se elige nada con él**: todo se elige con la validación, y el test se ejecuta una vez con lo
elegido. La prueba limpia del todo es la de los partidos que se jueguen a partir de hoy (ver el final).

### Candidatos

Todos con los mismos datos (liga, temporada y anterior, fecha estrictamente anterior) y el recorte de 14 en córners:

- **Estructura:**
  - `venue`: el modelo publicado, cada equipo solo en su campo;
  - `pooled`: todos los partidos del equipo, cada cifra relativa a la media de la liga en su campo. Ataque =
    `(Σ w × cifra/media de la liga en ese campo + K) / (Σ w + K)`, y la defensa, igual con lo que concede. Local
    esperado = media de la liga del local × ataque del local × defensa del visitante. Usa el doble de partidos;
  - `blend`: la media de las dos.
- **Decaimiento:** 0.0009, 0.0018 o 0.0036 por día. **Encogimiento** `K`: 2, 5, 10 o 20 partidos.
- 3 × 3 × 4 = 36 configuraciones por estadística. El modelo publicado es `venue`, 0.0018, 5.
- **Tarjetas,** además: cada configuración por el factor del árbitro R2 (K = 5, 10 o 20, definido arriba), y "liga ×
  árbitro": la media ponderada de la liga en cada campo por el factor R1 (K = 5, 10 o 20), sin la parte de los equipos.
  En total, 36 + 108 + 3 = 147 candidatos.

### Elección (validación)

**22/23, 23/24 y 24/25 juntas**, seis ligas (el xG, en las cinco con xG), con el mismo cálculo que el test. Para cada
estadística se queda el candidato con menor MAE. Ninguna de estas tres temporadas entra en el test. La 22/23 se usó solo
para probar el script del modelo publicado y la 24/25, para elegir la variante del árbitro.

### Test (una vez)

25/26 completa y 26/27 hasta el 2026-10-27, los mismos 2729 partidos, con el candidato elegido. Bases (a) liga y
(b) equipo, como siempre, y (c) **el modelo publicado**. Remuestreo: 2000 veces, semilla 20261027.

- **xG, tiros, tiros a puerta, córners y faltas:** el elegido sustituye al publicado si su MAE es menor y el intervalo
  de la diferencia con (c) queda entero por debajo de 0. Si no, se queda el publicado.
- **Amarillas y rojas:** aparecen si el elegido pasa la regla de siempre: menos MAE que (a) y que (b), con los dos
  intervalos por debajo de 0. Si su candidato lleva árbitro, en la web solo aparecen con árbitro designado.
- **Solo informativo:**
  - cuántas cifras reales caen dentro de "estimación ± error medio";
  - acierto en "qué equipo saca más", frente a decir siempre "el local", en los partidos sin empate en esa estadística;
  - el MAE por liga.

### Prueba de los partidos futuros

Las predicciones de los partidos por jugar se guardan con fecha (`data/reports/`) y se comparan cuando se jueguen. Es
la única prueba sin ninguna mirada previa.

### 2026-10-27: validación de la ampliación 2 (22/23, 23/24 y 24/25, 6716 partidos)

Candidato con menor MAE en cada estadística, frente a la base (a) y al modelo publicado. Las configuraciones se escriben
`estructura|decaimiento|K`, con `|R2:K` si llevan árbitro.

| Estadística | Obs. | Liga (a) | Publicado | Elegido | MAE elegido | 2.º | 3.º |
|---|---:|---:|---:|---|---:|---|---|
| xG | 10656 | 0.7010 | 0.6332 | `pooled|0.0036|5` | 0.6245 | `pooled|0.0018|5` 0.6249 | `pooled|0.0036|2` 0.6251 |
| Tiros | 13430 | 3.9353 | 3.5862 | `pooled|0.0036|5` | 3.5207 | `pooled|0.0036|2` 3.5264 | `blend|0.0036|2` 3.5335 |
| Tiros a puerta | 13430 | 1.8748 | 1.7593 | `pooled|0.0036|5` | 1.7365 | `pooled|0.0018|5` 1.7393 | `blend|0.0036|5` 1.7393 |
| Córners | 13430 | 2.1588 | 2.0899 | `pooled|0.0036|10` | 2.0670 | `pooled|0.0018|10` 2.0686 | `pooled|0.0036|5` 2.0693 |
| Faltas | 13430 | 3.0785 | 2.9188 | `pooled|0.0036|5` | 2.8756 | `pooled|0.0036|10` 2.8759 | `blend|0.0036|5` 2.8793 |
| Amarillas | 13420 | 1.1418 | 1.1327 | `pooled|0.0036|20|R2:20` | 1.1121 | `pooled|0.0036|10|R2:20` 1.1122 | `pooled|0.0036|20|R2:10` 1.1126 |
| Rojas | 13420 | 0.1858 | 0.1832 | `venue|0.0036|2|R2:5` | 0.1819 | `venue|0.0036|2|R2:10` 0.1820 | `venue|0.0036|2|R2:20` 0.1821 |

El decaimiento elegido, 0.0036, es el extremo de la rejilla. Puede que uno más rápido fuera mejor, pero la rejilla se
fijó antes y no se amplía después de verla. Queda para otra ronda, con partidos nuevos.

### 2026-10-27: test de la ampliación 2 (25/26 y 26/27, 2729 partidos)

| Estadística | Elegido | Obs. | MAE elegido | MAE publicado (c) | MAE liga (a) | MAE equipo (b) | Elegido − publicado [IC 95 %] | Elegido − liga [IC 95 %] | Elegido − equipo [IC 95 %] | Mejora vs liga | Decisión |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| xG | `pooled|0.0036|5` | 4288 | 0.647 | 0.653 | 0.708 | 0.676 | -0.006 [-0.011, -0.002] | -0.062 [-0.072, -0.052] | -0.030 [-0.038, -0.023] | 8.7 % | Sustituye |
| Tiros | `pooled|0.0036|5` | 5458 | 3.636 | 3.695 | 4.008 | 3.881 | -0.059 [-0.080, -0.039] | -0.372 [-0.427, -0.317] | -0.245 [-0.288, -0.202] | 9.3 % | Sustituye |
| Tiros a puerta | `pooled|0.0036|5` | 5458 | 1.762 | 1.782 | 1.892 | 1.844 | -0.021 [-0.031, -0.010] | -0.130 [-0.153, -0.108] | -0.082 [-0.100, -0.064] | 6.9 % | Sustituye |
| Córners | `pooled|0.0036|10` | 5458 | 2.079 | 2.104 | 2.163 | 2.157 | -0.025 [-0.036, -0.015] | -0.084 [-0.103, -0.066] | -0.078 [-0.097, -0.058] | 3.9 % | Sustituye |
| Faltas | `pooled|0.0036|5` | 5458 | 2.862 | 2.897 | 3.092 | 3.030 | -0.035 [-0.053, -0.018] | -0.231 [-0.267, -0.196] | -0.169 [-0.201, -0.135] | 7.5 % | Sustituye |
| Amarillas | `pooled|0.0036|20|R2:20` | 5458 | 1.069 | 1.090 | 1.086 | 1.103 | -0.021 [-0.028, -0.014] | -0.017 [-0.023, -0.010] | -0.034 [-0.043, -0.025] | 1.5 % | Aparece |
| Rojas | `venue|0.0036|2|R2:5` | 5458 | 0.182 | 0.184 | 0.185 | 0.184 | -0.002 [-0.004, -0.000] | -0.003 [-0.006, 0.001] | -0.002 [-0.005, 0.001] | 1.5 % | No aparece |

Solo informativo:

| Estadística | Dentro de ±MAE | Qué equipo saca más: elegido / publicado / siempre el local (partidos sin empate) |
|---|---:|---:|
| xG | 58.0 % | 68.9 % / 68.2 % / 60.9 % (2144) |
| Tiros | 57.8 % | 70.6 % / 70.0 % / 64.2 % (2607) |
| Tiros a puerta | 57.2 % | 68.5 % / 68.7 % / 62.4 % (2415) |
| Córners | 57.6 % | 64.8 % / 64.2 % / 60.0 % (2444) |
| Faltas | 57.7 % | 62.3 % / 61.7 % / 49.7 % (2523) |
| Amarillas | 57.9 % | 58.6 % / 57.0 % / 43.3 % (2122) |
| Rojas | 76.2 % | 52.6 % / 51.7 % / 47.4 % (458) |

| Por liga (elegido / publicado / liga) | xG | Tiros | Tiros a puerta | Córners | Faltas | Amarillas | Rojas |
|---|---:|---:|---:|---:|---:|---:|---:|
| Premier League | 0.639 / 0.644 / 0.688 | 3.414 / 3.437 / 3.768 | 1.672 / 1.699 / 1.762 | 2.051 / 2.073 / 2.155 | 2.602 / 2.633 / 2.729 | 1.024 / 1.038 / 1.034 | 0.110 / 0.111 / 0.113 |
| LaLiga | 0.621 / 0.618 / 0.685 | 3.734 / 3.782 / 4.222 | 1.732 / 1.740 / 1.926 | 2.092 / 2.131 / 2.203 | 2.882 / 2.874 / 3.198 | 1.104 / 1.124 / 1.126 | 0.224 / 0.227 / 0.227 |
| LaLiga 2 | — | 3.543 / 3.611 / 3.758 | 1.766 / 1.787 / 1.829 | 2.068 / 2.094 / 2.092 | 3.076 / 3.107 / 3.264 | 1.208 / 1.232 / 1.233 | 0.225 / 0.226 / 0.229 |
| Ligue 1 | 0.677 / 0.689 / 0.715 | 3.739 / 3.808 / 4.129 | 1.824 / 1.848 / 1.957 | 2.127 / 2.151 / 2.228 | 2.903 / 2.962 / 3.138 | 0.974 / 0.995 / 0.973 | 0.216 / 0.214 / 0.209 |
| Bundesliga | 0.710 / 0.717 / 0.790 | 3.762 / 3.819 / 4.095 | 1.900 / 1.914 / 2.046 | 2.074 / 2.076 / 2.163 | 2.633 / 2.670 / 2.852 | 1.072 / 1.098 / 1.071 | 0.157 / 0.159 / 0.157 |
| Serie A | 0.605 / 0.618 / 0.683 | 3.686 / 3.776 / 4.172 | 1.714 / 1.744 / 1.889 | 2.072 / 2.105 / 2.166 | 2.979 / 3.047 / 3.284 | 0.976 / 0.997 / 1.012 | 0.149 / 0.155 / 0.159 |

**Decisión (reglas de la ampliación 2):**
- **Sustituyen al publicado**, porque mejoran con el intervalo por debajo de 0: xG, tiros, tiros a puerta, córners y
  faltas.
- **Aparecen las amarillas**, solo con árbitro designado.
- **Las rojas siguen fuera.**

La web usa estas configuraciones (`MODEL` en `statsPredictor.ts`) y estos MAE.

**Lectura:**
- **La mejora frente al publicado es pequeña pero consistente:** entre un 0.9 % (xG) y un 1.6 % (tiros) menos de error
  en las cinco, y frente a la liga queda entre un 3.9 % (córners) y un 9.3 % (tiros).
- **Lo que más aporta es usar todos los partidos del equipo** (`pooled`), no solo los de su campo, con más peso a lo
  reciente.
- **Las amarillas pasan por poco** (1.5 % menos que la liga) y no en todas partes. En la Ligue 1 y la Bundesliga, el
  modelo empata con la media de la liga. En "qué equipo saca más", su 58.6 % apenas supera al 56.7 % de decir siempre
  "el visitante".
- **En LaLiga, xG y faltas** el elegido queda unas milésimas peor que el publicado. Es el total el que decide.
- **"±" en la web:** algo más de la mitad de las cifras reales (57-58 %) caen dentro de "estimación ± error medio". No
  es un rango seguro, y la web no lo presenta como tal.
- **Honestidad:** es la tercera mirada a este test. La elección se hizo solo con la validación y el resultado lo
  confirma, pero la prueba limpia de verdad es la de los partidos que se jueguen desde hoy.
