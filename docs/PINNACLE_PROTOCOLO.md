# Picks frente a Pinnacle: protocolo pre-declarado

Escrito el 2026-10-10, **antes** de calcular ninguna comparación de los picks con las cuotas de Pinnacle. Fija qué se
mide, con qué datos y qué se considera aportar. Si algo cambia después de ver resultados, se anota al final como
desviación y solo vale para partidos posteriores.

## Pregunta

¿Los "Picks muy probables" aciertan **más de lo que el mercado ya espera**? El protocolo anterior
([PICKS_PROBABLES_PROTOCOLO.md](PICKS_PROBABLES_PROTOCOLO.md)) los comparó con la frecuencia del suceso en la liga. Aquí
la vara es más exigente: la probabilidad de Pinnacle sin margen al cierre, que ya incluye la forma de los equipos,
las bajas y lo que sabe el mercado.

## Qué no se toca

- El motor de picks (`frontend/src/lib/patterns.ts`) y sus umbrales: los picks se exportan tal cual con
  `npm run export:picks`.
- La referencia de la web ("Market Average") y los backtests pre-registrados. Este análisis es nuevo y no los sustituye.

## Datos, en dos bloques que no se mezclan

1. **Retrospectivo (Football-Data).** Cierre de Pinnacle del CSV de Football-Data.co.uk (`PSCH/PSCD/PSCA`,
   `PC>2.5/PC<2.5`): solo 1X2 y más/menos 2.5, temporadas 21/22 a 25/26 (Football-Data dejó de publicar Pinnacle a
   mediados de enero de 2026; 26/27 no tiene). El acierto global de los picks ya se conocía, pero no su comparación
   con Pinnacle. Es evidencia retrospectiva, no un test a ciegas.
2. **Pre-declarado (capturas propias).** Solo partidos que empiezan después de la primera captura
   (2026-10-10, ver `python scripts/pinnacle_capture.py --status`). Todos los mercados con equivalente.

## Equivalencias

Un pick solo se compara si Pinnacle ofrece **el mismo suceso con la misma línea**. No se interpola entre líneas.

| Pick | Mercado de Pinnacle |
|---|---|
| Más/menos de X goles en el partido | Total de goles, línea X |
| Marca / encaja más/menos de X goles | Total del equipo (del rival para "encaja"), línea X; "marca"/"encaja" a secas también "¿Marca X?" |
| Marcan / no marcan los dos | Ambos marcan |
| Gana / empata / pierde | 1X2 |
| No pierde / no gana | Doble oportunidad calculada del 1X2 sin margen (mismo suceso) |
| Córners del partido y del equipo | Córners total y del equipo, línea X |

Fuera del informe, y se listan con su número de picks:

- **Tarjetas: no comparables.** Pinnacle cuenta amarilla = 1 y roja = 2, ignora la segunda amarilla (máximo 3 por
  jugador) y no cuenta las de banquillo y cuerpo técnico. Nuestros datos cuentan amarillas + rojas.
- **Faltas, tiros y tiros a puerta:** Pinnacle no tiene mercado.
- Picks cuya línea no ofrece Pinnacle, partidos sin cuotas y picks sin dato para resolverlos.

## Cómo se mide

- **Probabilidad de Pinnacle:** sin margen con el método de Shin (el mismo que usa la web con "Market Average").
  Sensibilidad: proporcional.
- **Diferencia:** acierto real menos probabilidad media de Pinnacle, en puntos. Intervalo al 95 % remuestreando
  partidos enteros (2000 repeticiones, semilla 20261009).
- Por nivel de fuerza, por tipo de pick y en total; calibración de Pinnacle por tramos en esos picks.
- **CLV:** cuánto se movió la probabilidad del pick de la apertura al cierre (en el bloque retrospectivo, de la toma
  de Football-Data del viernes o martes al cierre). Positivo: el mercado se movió hacia el pick.
- **Evaluación por línea:** en cada línea que ofrece Pinnacle, log-loss del modelo (Dixon-Coles para goles, modelo de
  conteos de las combinadas para córners) frente al de Pinnacle, y CLV del modelo. Líneas enteras: comparación
  condicionada a que no haya devolución. Cuartos de línea y tarjetas: fuera.

## Criterio, fijado antes de ver el resultado

- Los picks **aportan sobre el mercado** si, en Alta + Media, el límite inferior del intervalo de la diferencia es
  mayor que 0.
- Si el intervalo incluye el 0, **no se puede decir que aporten**; si queda por debajo, **aciertan menos de lo que el
  mercado ya espera**.
- El bloque pre-declarado se lee por primera vez con **500 picks Alta + Media evaluados**; antes se informa sin
  conclusión. El bloque retrospectivo se lee ya, como orientación.
- El modelo aporta información en un mercado si su log-loss es menor que el de Pinnacle (intervalo por debajo de 0)
  o si su CLV es positivo (intervalo por encima de 0).

## Resultados

Se añaden debajo, sin cambiar lo anterior.

### 2026-10-10: bloque retrospectivo (Football-Data) y primeras capturas

Primera captura propia: **2026-10-10 09:00 UTC** (67 partidos de las cuatro ligas, todos cruzados). El bloque
pre-declarado aún no tiene partidos jugados.

**Picks frente al cierre de Pinnacle** (Shin; 47 984 picks exportados de 21/22 a 26/27). Solo 884 se pueden comparar
(1.8 %): Football-Data solo trae 1X2 y más/menos 2.5, y los picks de goles casi nunca usan la línea 2.5. Casi todos son
"no pierde" (815).

| Nivel | Picks | Acierto | Pinnacle | Diferencia [IC 95 %] | CLV viernes→cierre [IC 95 %] |
|---|---:|---:|---:|---:|---:|
| Alta | 148 | 85.8 % | 83.9 % | +1.9 [−3.7, +7.0] | +0.2 [−0.2, +0.6] |
| Media | 686 | 79.4 % | 79.0 % | +0.5 [−2.2, +3.3] | +0.3 [+0.1, +0.5] |
| Baja | 50 | 80.0 % | 72.5 % | +7.5 [−4.5, +18.2] | +0.4 [−0.3, +1.1] |
| **Alta + media** | **834** | **80.6 %** | **79.8 %** | **+0.7 [−1.8, +3.3]** | **+0.3 [+0.1, +0.4]** |

Con el método proporcional la diferencia total sube de +1.1 a +1.5 puntos (hace los favoritos menos probables).
Solo 70 de estos picks son del test pre-registrado (25/26 y 26/27): +7.5 [−1.3, +15.4], muestra pequeña.

1. **No se puede decir que aporten sobre el mercado.** En Alta + Media el intervalo incluye el 0: los picks aciertan lo
   que Pinnacle ya espera.
2. **La ventaja frente a la liga es, aquí, lo que el mercado ya sabe.** En estos mismos 834 picks la frecuencia de la
   liga era del 67.2 %, se cumplieron el 80.6 % y Pinnacle daba el 79.8 %. "No pierde" del favorito supera a lo habitual
   en la liga, pero no a su precio.
3. **El mercado se mueve un poco hacia los picks** del viernes al cierre: +0.3 puntos de media. Es real pero muy pequeño.
4. Pinnacle está bien calibrado en estos picks: en los tramos con más de 100 picks (del 60 % al 100 %), a 1-3 puntos de
   lo observado. Los tramos por debajo del 60 % tienen 40 picks y no dicen nada.
5. Esto solo cubre resultado y más/menos 2.5. Goles por equipo, ambos marcan, otras líneas y córners necesitan las
   capturas propias.

**Modelo frente a Pinnacle, por línea** (590 partidos de 25/26 con predicciones Dixon-Coles guardadas):

| Mercado | Log-loss modelo | Log-loss Pinnacle | Modelo − Pinnacle [IC 95 %] | CLV del modelo [IC 95 %] |
|---|---:|---:|---:|---:|
| 1X2 | 1.0344 | 1.0120 | +0.022 [+0.007, +0.038] | −0.0 [−0.2, +0.2] |
| Más/menos 2.5 | 0.6827 | 0.6740 | +0.009 [−0.005, +0.022] | +0.2 [−0.0, +0.4] |

El modelo predice peor que el cierre de Pinnacle en 1X2 y no mejor en más/menos 2.5, y el mercado no se mueve hacia
él. Pinnacle está bien calibrado en los dos mercados (por deciles, a 1-2 puntos salvo en los tramos con pocos datos).

**Pinnacle frente a "Market Average"** (`report_reference_comparison.py`; log-loss, negativo = mejor el primero):

| Comparación | 25/26 y 26/27 (unos 750 partidos) | 21/22 a 26/27 (unos 7000) |
|---|---|---|
| 1X2: cierre de Pinnacle − media del viernes (la de la web) | +0.0023 [−0.0028, +0.0072] | −0.0023 [−0.0042, −0.0005] |
| 1X2: Pinnacle − media, misma toma | +0.0007 [−0.0010, +0.0024] | −0.0004 [−0.0008, +0.0001] |
| 1X2: Pinnacle − media, al cierre | +0.0023 [+0.0000, +0.0045] | +0.0001 [−0.0005, +0.0006] |
| 1X2: media al cierre − media del viernes | −0.0014 [−0.0046, +0.0019] | −0.0024 [−0.0039, −0.0008] |
| 2.5: cierre de Pinnacle − media del viernes | −0.0022 [−0.0061, +0.0019] | −0.0019 [−0.0033, −0.0005] |
| 2.5: Pinnacle − media, misma toma | +0.0003 [−0.0008, +0.0015] | −0.0001 [−0.0004, +0.0002] |
| 2.5: Pinnacle − media, al cierre | −0.0010 [−0.0029, +0.0008] | −0.0001 [−0.0005, +0.0003] |
| 2.5: media al cierre − media del viernes | −0.0025 [−0.0054, +0.0003] | −0.0020 [−0.0033, −0.0007] |

- **Pinnacle no es mejor referencia que la media a la misma hora:** en 7000 partidos, la diferencia es prácticamente 0.
- **Lo que mejora es esperar al cierre**, sea cual sea la fuente: la media de cierre mejora a la del viernes tanto como
  el cierre de Pinnacle. En 25/26 y 26/27 solas no hay muestra para distinguirlo.
- Cambiar de referencia no valdría la pena por la casa, sino por la hora. Y para eso los picks y las recomendaciones
  tendrían que publicarse con cuotas de cierre, que no se tienen hasta justo antes del partido.

**"Market Max" en el valor esperado** (25/26 y 26/27, Dixon-Coles): Market Max paga de media un 2.9 % más que Bet365 y
un 0.9 % más que Pinnacle. En las 1970 selecciones que la web marca como valor, el EV medio es +18.8 % con Market Max y
+15.1 % con la cuota de Bet365. El 81.6 % seguiría por encima del umbral. Pero la rentabilidad real de esas selecciones
fue −5.3 % a cuota Market Max y −8.0 % a cuota Bet365: el EV de la web es optimista sobre todo por el modelo, y además
unos 3-4 puntos por usar el mejor precio entre casas.
