# Picks (combinadas): protocolo pre-registrado

Este documento se escribió **antes** de ejecutar ningún backtest de las combinadas. Fija los datos, los modelos,
las reglas para construir las combinadas y cómo se mide el acierto. Si algo cambia después de ver el test, se
anota al final como desviación, con su motivo.

## Objetivo

Combinadas para la próxima jornada que prioricen la **probabilidad de acierto**, no el valor, en cuatro niveles de
cuota, más una combinada "muy probable" del mismo partido para cada partido.

## Reglas anti-trampa

1. **Point-in-time por jornada.** Las combinadas de una jornada se construyen con lo que se sabría el martes antes
   de esa jornada: todas las features usan solo partidos anteriores al primer partido de la jornada. Una jornada
   es la ventana de martes a lunes.
2. **Cuotas pre-partido** (`Market Average`). Nunca las de cierre.
3. **Separación temporal:** calentamiento 20/21, entrenamiento 21/22–23/24, validación 24/25 y **test 25/26 + lo
   jugado de 26/27**, que se evalúa una sola vez con la configuración congelada.
4. **Se cuentan todas las combinadas generadas.** No se descarta ninguna a posteriori.
5. **El acierto se compara con la probabilidad que el propio modelo daba a la combinada.** Si acierta menos de lo
   que prometía, el modelo está sobreconfiado y hay que decirlo.

## Modelos de probabilidad

- **Goles:** matriz de marcadores Poisson con λ y μ implícitos en las cuotas medias pre-partido (1X2 + más/menos
  2.5). Es la fuente que mejor puntuó en el estudio anterior (`MODELO_PATRONES.md`). Las selecciones de goles del
  mismo partido se calculan conjuntamente sobre la matriz. Si un partido no tiene cuotas, no se ofrecen selecciones
  de goles de ese partido.
- **Córners y tarjetas amarillas por equipo:** regresión de Poisson con dispersión binomial negativa, una para cada
  caso (córners del local, córners del visitante, amarillas del local, amarillas del visitante). Las features son
  logaritmos de tasas encogidas hacia la media de la liga con 5 partidos ficticios:
  - lo que el equipo saca o recibe en ese campo (últimos 10 partidos);
  - lo que el rival concede o provoca en su campo (últimos 10);
  - lo mismo en cualquier campo (últimos 20).

  La dispersión se estima por momentos en entrenamiento. Los totales del partido salen de convolucionar las
  distribuciones de los dos equipos, que se suponen independientes. El árbitro no se usa, porque en LaLiga solo
  hay datos de la temporada actual.

## Selecciones candidatas

| Familia | Selecciones |
|---|---|
| Resultado | 1X2, doble oportunidad |
| Goles totales | más/menos 1.5, 2.5 y 3.5 |
| Goles por equipo | ambos marcan sí/no; local y visitante más de 0.5 y de 1.5 |
| Córners totales | más/menos 7.5, 8.5, 9.5, 10.5 y 11.5 |
| Córners por equipo | local más de 3.5, 4.5 y 5.5; visitante más de 2.5, 3.5 y 4.5 |
| Amarillas totales | más/menos 2.5, 3.5, 4.5, 5.5 y 6.5 |
| Amarillas por equipo | local y visitante más de 0.5, 1.5 y 2.5 |

**Cuotas:**
- **Reales:** 1X2 y más/menos 2.5, con la cuota media pre-partido.
- **Derivadas de cuotas reales:** doble oportunidad, combinando las dos cuotas del 1X2.
- **Estimadas para el resto:** `1 / (p × 1.07)`, es decir, la probabilidad del modelo con un margen típico del 7%.
  Se marcan siempre como estimadas.

Solo son candidatas las selecciones con p ≥ 0.55 y cuota ≥ 1.05.

## Combinadas por niveles (partidos distintos, una selección por partido)

| Nivel | Cuota de la combinada | Máximo de selecciones |
|---|---|---|
| Segura | 1.40 – 1.65 | 4 |
| Media | 1.85 – 2.15 | 5 |
| Alta | 3.00 – 5.00 | 7 |
| Bomba | 8.00 – 15.00 | 10 |

- Mínimo 2 selecciones en todos los niveles.
- Objetivo, que refleja la "certeza": entre las combinadas que caen en el rango, la que tenga **la selección menos
  probable lo más probable posible**. A igualdad, menos selecciones; después, mayor probabilidad conjunta.
- Se construye una combinada por nivel y jornada para tres ámbitos: las dos ligas mezcladas, solo LaLiga y solo
  Premier.

## Combinada del mismo partido ("muy probable")

- Una por partido, con 2 o 3 selecciones de familias distintas.
- Debe tener una probabilidad conjunta ≥ 0.70, y entre las que lo cumplen se elige la de mayor cuota.
- La probabilidad conjunta se calcula así: las selecciones de goles juntas sobre la matriz de marcadores; córners y
  tarjetas, independientes de los goles y entre sí.
- Cuota siempre estimada: `1 / (p × 1.10)`, porque las casas cobran más margen en las apuestas del mismo partido.

## Regla de validación (lo único que se decide mirando 24/25)

Se excluye de los picks una familia de selecciones si, en validación, sus selecciones con p ≥ 0.60 aciertan más de 3 puntos
por debajo de la probabilidad media que predecía el modelo (con al menos 200 selecciones). La lista de familias excluidas
se congela antes del test.

## Métricas del test

- **Por selección y familia:** probabilidad media predicha frente a acierto real, y Brier.
- **Por nivel y ámbito:** número de combinadas, acierto, probabilidad media predicha y cuota media.
  - ROI con la cuota mostrada, marcado como **estimado** si alguna selección tiene cuota estimada.
  - ROI real, solo en las combinadas con todas las cuotas reales.
- **Mismo partido:** acierto frente a la probabilidad predicha media.
- Con unas 40 jornadas de test, el acierto de cada nivel tiene un error grande, sobre todo en Alta y Bomba. La
  calibración por selección, que tiene miles de casos, es la medida más fiable.

## Versión 2: menos selecciones (pre-registrada el 1 de octubre de 2026, antes de ejecutarla)

**Motivo.** Cada selección añade el margen de la casa (~7%), así que, a igual cuota, una combinada con más selecciones
acierta menos. Para la misma cuota de 1.90, con 5 selecciones el modelo prometía un 40%; con 2–3 selecciones, un 46–49%. Esto
es aritmética, no algo deducido del test.

**Cambios** (lo demás no cambia: modelos, selecciones candidatas, cuotas, rangos de cuota y combinada del mismo
partido):

| Nivel | Cuota | Máximo de selecciones v1 | Máximo de selecciones v2 |
|---|---|---:|---:|
| Segura | 1.40 – 1.65 | 4 | 2 |
| Media | 1.85 – 2.15 | 5 | 3 |
| Alta | 3.00 – 5.00 | 7 | 4 |
| Bomba | 8.00 – 15.00 | 10 | 5 |

- **Objetivo:** maximizar la probabilidad conjunta (el producto de probabilidades) dentro del rango de cuota, con
  partidos distintos y al menos 2 selecciones. Se resuelve exactamente con programación dinámica sobre el logaritmo de la
  cuota. En la v1 se maximizaba la probabilidad de la selección menos probable.

**Limitación honesta.** El periodo de test (25/26 + 26/27) ya se vio con la v1. Los límites de selecciones se fijan aquí
por el principio del margen, sin elegirlos mirando el test, y no se probará ninguna otra variante sobre el test. Aun
así, este test ya no es un test virgen. Su resultado se acepta tal cual salga, aunque sea peor.

**Predicción a priori.** Con el modelo calibrado, el acierto esperado será aproximadamente:
- Segura: ~61%.
- Media: ~45%.
- Alta: ~27%.
- Bomba: ~9%.

Es lo máximo que permite la aritmética de las cuotas, no un 70%.

### Resultados de la v2

Se ejecutó una sola vez sobre validación y otra sobre test, sin variantes. Las combinadas del mismo partido no
cambian.

**Efecto no previsto en la predicción a priori:** al maximizar la probabilidad conjunta, el optimizador prefiere
selecciones con cuota **real o derivada** (favoritos en 1X2, doble oportunidad, goles 2.5). Su margen es menor que el 7%
supuesto para las estimadas. Por eso el acierto prometido es mayor que el previsto, y ahora casi todas las
combinadas tienen ROI medible con cuotas reales.

Test 25/26 + 26/27, ligas mezcladas:

| Nivel | Acierto v1 | **Acierto v2** | Prometido v2 | Selecciones v2 | ROI v2 (cuota real) |
|---|---:|---:|---:|---:|---:|
| Segura (~1.41) | 62.8% | **76.7%** | 66.3% | 2.0 | +8.2% (39) |
| Media (~1.86) | 39.5% | **48.8%** | 50.7% | 2.0 | −9.1% (43) |
| Alta (~3.0) | 14.0% | **32.6%** | 30.6% | 3.0 | −1.9% (43) |
| Bomba (~8.0) | 11.6% | 9.3% | 10.7% | 4.9 | −17.7% (39) |

Validación 24/25, ligas mezcladas: Segura 73.0%, Media 54.1%, Alta 35.1% y Bomba 21.6%.

**Lectura.**
- La v2 sube el acierto de Segura, Media y Alta, y en el conjunto se ajusta a lo que el modelo promete.
- Ningún nivel por encima de Segura llega al 70%: con cuota 1.86, el máximo honesto ronda el 50%.
- El ROI con cuotas reales es pequeño y cambia de signo según el nivel y la temporada. No demuestra ventaja sobre
  las casas.

## Versión 3: subir el acierto de Alta y Bomba (pre-registrada antes de ejecutarla)

Con la cuota fija en el mínimo de cada rango, el acierto solo puede subir pagando menos margen acumulado o con
probabilidades mejores que las del mercado. Se prueban dos cambios **solo en validación (24/25)**:

- **A: suelo de 0.30 para las selecciones de las combinadas por nivel** (antes 0.55). El optimizador es exacto, así que
  con más opciones la probabilidad conjunta prometida no puede bajar. Puede llegar a cuota 8 con 2–3 selecciones largas
  en lugar de 5 cortas, si eso es más probable. Las combinadas del mismo partido no cambian.
- **B: probabilidades del modelo de patrones** (`MODELO_PATRONES.md`, regresión logística sobre mercado, Dixon-Coles
  y patrones) para las 16 selecciones de goles que cubre. La cuota de las selecciones estimadas sigue saliendo de la
  probabilidad de mercado, para no inventar valor. En validación se usa el modelo de patrones entrenado solo con
  21/22–23/24; en test, el entrenado con 21/22–24/25, que es el ya probado.

**Regla de decisión, fijada ahora, que usa solo validación:** cada cambio se acepta si cumple dos condiciones:
1. Sube la probabilidad media prometida de Alta y Bomba (ligas mezcladas).
2. Las selecciones que introduce están calibradas: el acierto real no queda más de 3 puntos por debajo de lo predicho,
   con al menos 200 selecciones.

No se decide por el acierto de las combinadas de validación, porque con ~37 por nivel es casi todo ruido. Después
se ejecuta el test una sola vez con lo aceptado.

**Limitación:** es la tercera vez que se usa el periodo de test. Su resultado se acepta tal cual salga.

**Corrección de la regla, hecha en validación y antes de ejecutar el test.** La regla original aceptó A y B, pero
miraba la calibración de *todas* las selecciones. Al revisar en validación las selecciones que el optimizador elige de verdad
para Alta y Bomba:

| Variante | Selecciones elegidas | Prob. del modelo | Acierto real | 1/cuota |
|---|---:|---:|---:|---:|
| v2 | 300 | 67.0% | 70.9% | 67.9% |
| A (suelo 0.30) | 168 | 51.8% | 57.7% | 52.4% |
| A + B (patrones) | 251 | 67.0% | 60.6% | 65.0% |

Con patrones, el optimizador escoge justo las selecciones donde el modelo más se separa del mercado. Es el "sesgo del
optimizador": entre muchas estimaciones, las más optimistas suelen estar equivocadas al alza. Esas selecciones aciertan
6–7 puntos menos de lo prometido, e incluso menos que la cuota.

La regla queda así: un cambio se acepta si sube la probabilidad prometida **y las selecciones que el optimizador elige**
para Alta y Bomba no aciertan más de 3 puntos por debajo de lo predicho.

**Resultado:** A se acepta (las elegidas aciertan 5.9 puntos *más* de lo prometido). B se rechaza (−6.4 puntos).
La v3 es la v2 con un suelo de selecciones de 0.30.

### Resultados de la v3 (test, una sola ejecución)

Ligas mezcladas:

| Nivel | Acierto v2 | **Acierto v3** | Prometido v3 | Selecciones v3 | ROI real v3 |
|---|---:|---:|---:|---:|---:|
| Segura | 76.7% | 76.7% | 66.3% | 2.0 | +8.2% |
| Media | 48.8% | 48.8% | 50.7% | 2.0 | −9.1% |
| Alta | 32.6% | **30.2%** | 31.4% | 2.0 | −8.7% |
| Bomba | 9.3% | **11.6%** | 11.6% | 2.5 | −3.8% |

**Lectura.**
- Alta y Bomba suman los mismos aciertos que en la v2 (18). La subida de lo prometido (<1 punto) es menor que el
  ruido de 43 combinadas.
- El modelo acierta lo que promete: Bomba 11.6% frente a 11.6%, Alta 30.2% frente a 31.4%.
- Con cuota 3 y 8, el acierto honesto está en ~31% y ~12%, y no hay forma legítima de subirlo de forma apreciable
  sin bajar la cuota.
- Se adopta la v3 en la web porque está validada y la Bomba paga menos margen (2–3 selecciones en vez de 5).
- La opción B (patrones) queda descartada por el sesgo del optimizador.

## Versión 4: nivel "Fiable" (pre-registrada antes de ejecutarla)

Se pidió un nivel que acierte alrededor del 65%. A cuota ~1.86 (la Media), eso exigiría ganar a la casa un 21% por
combinada, y ningún modelo de este estudio se acerca. Se añade un nivel entre la Segura y la Media:

| Nivel | Cuota | Máximo de selecciones |
|---|---|---:|
| Fiable | 1.45 – 1.60 | 2 |

- El resto de niveles, el modelo y las reglas no cambian (v3).
- **Predicción a priori:** acierto prometido de ~64–65% a cuota ~1.46–1.50.
- Se valida en 24/25 y se ejecuta una vez sobre el periodo de test, con la misma limitación de las versiones 2 y 3:
  ese periodo ya se ha visto.

### Resultados de la v4

| Fiable (cuota media 1.46, 2 selecciones) | Combinadas | Acierto | Prometido | ROI con cuota real |
|---|---:|---:|---:|---:|
| Validación 24/25 | 37 | 78.4% | 65.7% | +14.2% |
| **Test 25/26 + 26/27** | 43 | **67.4%** | 64.2% | −2.8% (42) |
| Test, solo LaLiga | 41 | 73.2% | 63.5% | +17.5% (36) |
| Test, solo Premier | 41 | 53.7% | 63.8% | −23.3% (40) |

El nivel cumple el objetivo del ~65% y acierta lo que promete. La diferencia entre ligas es compatible con el azar,
porque son ~40 combinadas por liga.

## Restricción de la casa: sin "1 o 2 (sin empate)"

Winamax no acepta la doble oportunidad "1 o 2" en combinadas. El optimizador la elegía a menudo porque su cuota,
derivada del 1X2 real, tiene poco margen. Desde ahora no se propone nunca (`UNAVAILABLE` en `legs.py`). No es un
ajuste del modelo, sino una restricción del producto. Se repitieron validación y test sin cambiar nada más.

| Nivel | Test con "1 o 2" | **Test sin "1 o 2"** | Prometido | Validación sin "1 o 2" |
|---|---:|---:|---:|---:|
| Segura | 76.7% | **72.1%** | 64.9% | 75.7% |
| Fiable | 67.4% | **55.8%** | 63.0% | 75.7% |
| Media | 48.8% | **39.5%** | 49.9% | 45.9% |
| Alta | 30.2% | **37.2%** | 31.2% | 40.5% |
| Bomba | 11.6% | **11.6%** | 11.6% | 16.2% |
| Mismo partido | 71.9% | **71.8%** | 70.9% | 70.9% |

- Lo prometido baja alrededor de 1 punto por nivel.
- Las diferencias observadas son del tamaño del ruido de 43 combinadas (±7 puntos). En el conjunto de niveles, el
  modelo prometió ~95 aciertos y hubo 93.
- Ver, para la escala de ese ruido, las diferencias entre validación y test de cada nivel.

## Experimentos de mejora (validación cruzada temporal, sin tocar el test)

Para no seguir gastando el periodo de test, las variantes se comparan con validación cruzada temporal: se evalúan
22/23, 23/24 y 24/25, entrenando cada vez solo con las temporadas anteriores. Son 112 combinadas por nivel; el
error típico es de ±3 a ±5 puntos según el nivel. Script: `scripts/experiments_picks.py`.

| Variante | Segura | Fiable | Media | Alta | Bomba | Mismo partido |
|---|---:|---:|---:|---:|---:|---:|
| **V0: modelo actual** | **71.4%** | **68.8%** | **53.6%** | **33.0%** | **15.2%** | **71.2%** |
| *prometido V0* | *66.4%* | *64.3%* | *50.9%* | *31.9%* | *12.1%* | *70.9%* |
| V1: goles con probabilidades de Pinnacle | 71.4% | 67.9% | 56.2% | 31.2% | 14.3% | 71.2% |
| V2: mercado medio recalibrado | 67.0% | 70.5% | 50.0% | 24.1% | 5.4% | 71.2% |
| V3: Pinnacle recalibrado | 68.8% | 69.6% | 50.0% | 32.1% | 10.7% | 71.2% |
| V4: patrones encogidos al 50% hacia el mercado | 62.5% | 66.1% | 57.1% | 25.9% | 10.7% | 71.2% |
| V5: corners/amarillas con la fuerza esperada | 71.4% | 68.8% | 52.7% | 33.0% | 15.2% | 68.8% |
| V6: V3 + V5 | 68.8% | 69.6% | 50.0% | 32.1% | 10.7% | 68.8% |

**Calibración por familia** (`scripts/experiments_families.py`): ninguna familia elegida promete de más de forma
clara. Las combinadas por nivel usan casi solo selecciones de resultado (1.096 de ~1.150). Esas selecciones
aciertan un 68.5%, frente a un 65.8% prometido y un 67.5% implícito en la cuota.

**Conclusión.**
- Ninguna variante mejora al modelo actual.
- Las que suben lo prometido (V2, V3, V4) aciertan menos: otra vez el sesgo del optimizador.
- Pinnacle es la fuente más precisa (mejor log-loss), pero no convierte esa precisión en más aciertos al elegir.
- El modelo actual acierta en todos los niveles algo **más** de lo que promete, así que su probabilidad es
  prudente.
- Al no elegirse ninguna variante, el periodo de test no se ha vuelto a usar.

## Desviaciones posteriores al test

Ninguna en la v1. El test se ejecutó con la configuración congelada en `picks_config.json` (1 de octubre de 2026).

En validación, la regla no excluyó ninguna familia. Después de congelar, solo se reorganizó el código para que el
backtest y la web compartan la función que construye las combinadas. Se repitió el test para comprobar que los
números eran idénticos.

## Resultados del test (25/26 + 26/27: 43 jornadas, 879 partidos)

### Calibración por selección (la medida más fiable)

| Familia | Selecciones | Predicho | Real |
|---|---:|---:|---:|
| Resultado | 2311 | 72.2% | 71.5% |
| Goles totales | 2204 | 70.3% | 71.8% |
| Goles por equipo | 2184 | 69.2% | 71.9% |
| Córners totales | 3548 | 66.2% | 65.7% |
| Córners por equipo | 3106 | 69.4% | 68.2% |
| Amarillas totales | 3583 | 73.0% | 72.1% |
| Amarillas por equipo | 2644 | 73.5% | 74.4% |

Todas las familias quedan a menos de 2.7 puntos de lo que predecía el modelo: las probabilidades son fiables.

### Combinadas (las dos ligas mezcladas)

| Nivel | Combinadas | Acierto | Prometido | Cuota media | Selecciones |
|---|---:|---:|---:|---:|---:|
| Segura | 43 | 62.8% | 56.4% | 1.40 | 4 |
| Media | 43 | 39.5% | 40.0% | 1.86 | 5 |
| Alta | 43 | 14.0% | 22.3% | 3.01 | 7 |
| Bomba | 43 | 11.6% | 7.5% | 8.05 | 10 |
| Mismo partido | 802 | 71.9% | 70.8% | 1.28 | 2 |

Por liga, LaLiga: Segura 73.2%, Media 26.8%, Alta 7.3%, Bomba 2.4%. Premier: 58.5%, 31.7%, 22.0% y 7.3%.

### Lectura

1. **El modelo acierta lo que promete.** Lo confirman la calibración por selección y la combinada del mismo partido
   (802 casos, 71.9% frente a 70.8%).
2. **Las combinadas por nivel tienen mucho ruido.** Con unas 40 por nivel, que Alta saliera por debajo y Segura y
   Bomba por encima es compatible con el azar. Sumando los cuatro niveles: 149 aciertos frente a ~156 esperados.
3. **No hay valor demostrado.** Casi todas las selecciones tienen cuota estimada, y con el margen de las casas el ROI
   esperado es negativo. En el test hubo solo 5 combinadas con todas las cuotas reales. Los picks indican lo
   **probable**, no lo **rentable**. Para saber si una combinada merece la pena hay que comparar su cuota estimada
   con la que pague la casa.
