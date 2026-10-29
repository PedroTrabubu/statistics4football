# Ligas nuevas: protocolo de validación pre-registrado

Este documento se escribió el 6 de octubre de 2026, **antes** de evaluar ningún modelo en LaLiga Hypermotion
(`ESP-La Liga 2`) o en la Ligue 1 (`FRA-Ligue 1`). De estas ligas solo se han cargado los datos y se ha comprobado
que las clasificaciones cuadran. Una liga solo entra en `VALIDATED_LEAGUES`, es decir, en Picks y Recomendaciones,
si cumple los criterios de abajo.

## Qué se evalúa

Los modelos que usa hoy la web, **sin reentrenarlos ni cambiar nada**:

- **Alta probabilidad** (`pattern_model_params.json`): entrenado con Premier y LaLiga 21/22–24/25, con τ = 0.62 y
  δ = 0.03. Es la estrategia B de `MODELO_PATRONES.md`, con una selección como máximo por partido.
- **Picks** (`picks_params.json`): la v3 de `PICKS_PROTOCOLO.md`, con el nivel Fiable y sin "1 o 2". Se evalúan las
  combinadas por nivel en el ámbito de la propia liga y las combinadas del mismo partido.
- **Valor:** Dixon-Coles con EV contra la cuota.

Ninguno de estos modelos se entrenó ni se ajustó con estas ligas, así que todas sus temporadas están fuera de
muestra:

- **Evaluación:** 21/22–26/27, con lo jugado de 26/27 hasta el 6 de octubre.
- **Calentamiento:** 20/21, como en los protocolos originales.

Las reglas no cambian:

- Todo es point-in-time: Dixon-Coles se reajusta mes a mes y las features de los Picks se calculan por jornada.
- Se usan las cuotas pre-partido `Market Average` y nunca las de cierre.
- Se cuentan todas las selecciones.

La evaluación se ejecuta **una sola vez**, y su resultado se acepta tal cual salga.

## Criterios, por liga

Una liga se valida solo si cumple los seis.

**Alta probabilidad**
1. Al menos 200 selecciones.
2. Acierta lo que promete: el acierto no queda más de 3 puntos por debajo de la probabilidad media que daba el modelo.
   Como cada selección exige 3 puntos más que el mercado, esto implica no acertar menos de lo que esperaba el
   mercado. Como referencia, en el test de Premier y LaLiga el modelo acertó un 74.8% y prometía un 72.2%.

**Picks**

3. **Calibración por familia.** En cada familia con al menos 200 selecciones de p ≥ 0.60, el acierto no queda más de
   3 puntos por debajo de lo predicho. Es la regla de validación de `PICKS_PROTOCOLO.md`.
4. **Selecciones elegidas por el optimizador.** Se miran las de las combinadas por nivel de los cinco niveles, en el
   ámbito de la liga. Deben ser al menos 200, y su acierto no puede quedar más de 3 puntos por debajo de lo
   predicho. Es la regla corregida de la v3, porque el sesgo del optimizador se ve en las selecciones que elige.
5. **Combinada del mismo partido.** El acierto no queda más de 3 puntos por debajo de lo prometido.

**Valor**

6. **Dixon-Coles no puede estar peor calibrado que en las ligas validadas.** En 1X2 se resta el log-loss del mercado
   al de Dixon-Coles. Esa diferencia no puede superar en más de 0.010 la de Premier y LaLiga en las mismas
   temporadas.

El acierto de cada nivel de combinada se informa, pero no decide. Con unas 40 jornadas por temporada tiene un error
de varios puntos, y la calibración por selección, con miles de casos, es la medida fiable.

## Qué se hace con el resultado

- **Si una liga cumple los seis criterios**, se añade a `VALIDATED_LEAGUES`. Desde entonces:
  - entra en Picks y Recomendaciones;
  - entra en el ámbito "Todas" de los Picks, que cambia;
  - `refresh_odds.py` también pide sus cuotas a the-odds-api.com, a 2 créditos por refresco.
- **Si no los cumple**, sigue cargada y visible en el resto de la web, pero sin modelos. No se retoca nada para que
  pase: cualquier cambio sería un protocolo nuevo, con su propia validación y un periodo de evaluación que no se haya
  visto.

## Resultados (6 de octubre de 2026, una sola ejecución)

Para reproducirlos:

```bash
python scripts/backtest_pattern_model.py build-ligas
python scripts/backtest_pattern_model.py ligas
python scripts/backtest_picks.py build-ligas
python scripts/backtest_picks.py ligas
```

Antes de ejecutarlos se comprobó que el código de evaluación reproduce los tests ya publicados de Premier y LaLiga:
309 selecciones con un 74.8% en alta probabilidad, y Segura 72.1%, Fiable 55.8%, Media 39.5%, Alta 37.2%,
Bomba 11.6% y mismo partido 71.8% en Picks.

### Resumen

| Criterio | LaLiga Hypermotion | Ligue 1 |
|---|---|---|
| 1. Alta probabilidad: al menos 200 selecciones | Cumple (807) | Cumple (597) |
| 2. Alta probabilidad: acierta lo que promete | Cumple: 73.0% frente a 74.3% | **No cumple: 69.2% frente a 72.3% (−3.1 puntos)** |
| 3. Picks: calibración por familia | Cumple | Cumple |
| 4. Picks: selecciones elegidas por el optimizador | Cumple: 63.3% frente a 63.8% (2116) | Cumple: 67.3% frente a 65.6% (1850) |
| 5. Picks: mismo partido | Cumple: 72.1% frente a 71.2% (2034) | Cumple: 73.0% frente a 70.9% (1516) |
| 6. Dixon-Coles frente al mercado (referencia +0.0111) | Cumple: +0.0154 | Cumple: +0.0129 |
| **Decisión** | **Validada** | **No validada** |

### Alta probabilidad (21/22–26/27)

| Liga | Selecciones | Acierto | Prometido | El mercado esperaba | ROI con cuota |
|---|---:|---:|---:|---:|---:|
| LaLiga Hypermotion | 807 | 73.0% | 74.3% | 70.4% | −1.6% (268) |
| Ligue 1 | 597 | 69.2% | 72.3% | 68.6% | +0.4% (219) |

En la Ligue 1, el modelo acierta lo mismo que esperaba el mercado (+0.6 puntos), como en la validación cruzada de
Premier y LaLiga (+0.0). Pero promete 3.1 puntos más de lo que acierta, y el límite era 3. Con 597 selecciones, el
error típico ronda ±1.9 puntos, así que el resultado está en el borde y es compatible con el azar. Aun así, la regla
era esa y se aplica tal cual.

### Picks: combinadas por nivel en el ámbito de la liga (informativo)

| Nivel | Hypermotion: acierto | Prometido | Ligue 1: acierto | Prometido |
|---|---:|---:|---:|---:|
| Segura | 64.1% | 62.8% | 64.6% | 64.7% |
| Fiable | 63.6% | 60.9% | 68.0% | 62.6% |
| Media | 46.4% | 48.6% | 50.3% | 49.7% |
| Alta | 28.2% | 30.5% | 34.3% | 31.2% |
| Bomba | 9.6% | 11.4% | 12.0% | 11.7% |

Hay 209 combinadas por nivel en la Hypermotion y 175 en la Ligue 1. En la Hypermotion, las combinadas usan más
selecciones de córners y tarjetas, que llevan cuota estimada, y menos con cuota real.

### Histórico en la web (8 de octubre de 2026)

La Hypermotion tiene en la web el mismo periodo de histórico que Premier y LaLiga, 25/26 y lo jugado de 26/27, con
los mismos modelos.

- **Alta probabilidad:** se genera con `python scripts/backtest_pattern_model.py history`, que incluye las ligas
  nuevas validadas. Son 175 selecciones con un 72.6% de acierto, cuando el mercado esperaba un 68.6%.
- **Picks:** se genera con `python scripts/backtest_picks.py history`. Son 245 combinadas por nivel y 447 del mismo
  partido. "Todas" sigue siendo la mezcla de Premier y LaLiga del protocolo original.
- **Valor:** se genera con `python scripts/generate_predictions.py --liga "ESP-La Liga 2" --temporadas 2526,2627`.
  Es walk-forward, con Dixon-Coles reajustado cada mes con todo lo anterior. Son 891 selecciones con un 35.8% de
  acierto, cuando el mercado esperaba un 38.0%, y un ROI del −9.4%. Como en LaLiga (−7.7%), no hay ventaja.

### Decisión

- **LaLiga Hypermotion** entra en `VALIDATED_LEAGUES`.
- **La Ligue 1** sigue cargada y visible, pero sin Picks ni Recomendaciones. Para volver a evaluarla haría falta un
  protocolo nuevo, con un periodo que no se haya visto, es decir, con la temporada 26/27 terminada o la siguiente.

## Ampliación: Bundesliga y Serie A, solo Alta probabilidad (protocolo del 26 de octubre de 2026)

Esta sección se escribió **antes** de construir el dataset y de evaluar nada. El modelo de alta probabilidad no se ha
evaluado nunca en estas dos ligas. Sus datos sí se usaron en otros protocolos (`PREDECIBILIDAD_PROTOCOLO.md`,
`PICK_DEL_PARTIDO_PROTOCOLO.md`), con otros modelos.

- **Qué se evalúa:** solo Alta probabilidad, con el mismo `pattern_model_params.json` (τ = 0.62, δ = 0.03), sin
  reentrenarlo ni cambiar nada. Picks no se evalúa y no cambia. El modelo de valor está retirado (ver
  `MODELO_PATRONES.md`), así que el criterio 6 se informa, pero no decide.
- **Ligas:** `GER-Bundesliga` e `ITA-Serie A`. La Ligue 1 no entra: ya se evaluó y no pasó, y no se repite con el
  mismo periodo. La Champions tampoco: no tiene cuotas `Market Average` pre-partido, y el modelo las necesita.
- **Periodo:** 21/22–26/27, con lo jugado de 26/27 hasta el 26 de octubre, y 20/21 de calentamiento. Las reglas son
  las de arriba: todo point-in-time, cuotas pre-partido `Market Average` y todas las selecciones.
- **Criterios, por liga (los dos):**
  1. Al menos 200 selecciones.
  2. El acierto no queda más de 3 puntos por debajo de la probabilidad media que daba el modelo.
- **Una sola ejecución**, cuyo resultado se acepta tal cual salga:

  ```bash
  python scripts/backtest_pattern_model.py build-ampliacion
  python scripts/backtest_pattern_model.py ampliacion
  ```

- **Si una liga cumple los dos:** entra en `HIGH_PROBABILITY_LEAGUES`, que solo usa Alta probabilidad, y no en
  `VALIDATED_LEAGUES`, así que Picks sigue igual. Su histórico en la web es el de las demás, 25/26 y lo jugado de 26/27
  (`history-ampliacion`). Sus cuotas pre-partido llegan con `fixtures.csv` de Football-Data, las mismas del backtest;
  `refresh_odds.py` no las pide.
- **Si no los cumple:** sigue cargada y visible en el resto de la web, sin Alta probabilidad. Para volver a evaluarla
  haría falta un protocolo nuevo, con un periodo que no se haya visto.

### Resultados de la ampliación (26 de octubre de 2026, una sola ejecución)

| Criterio | Bundesliga | Serie A |
|---|---|---|
| 1. Al menos 200 selecciones | Cumple (741) | Cumple (538) |
| 2. Acierta lo que promete | **No cumple: 68.6% frente a 71.9% (−3.3 puntos)** | Cumple: 71.0% frente a 72.7% (−1.7 puntos) |
| 6. Dixon-Coles frente al mercado (informativo; referencia +0.0111) | +0.0169 | +0.0117 |
| **Decisión** | **No validada** | **Validada** |

El mercado esperaba un 67.9% en la Bundesliga (1593 partidos) y un 69.0% en la Serie A (1979 partidos), así que el
margen sobre el mercado es de +0.7 y +2.0 puntos. En la Bundesliga, como en la Ligue 1, el modelo promete más de lo
que acierta, y el límite de 3 puntos se aplica tal cual.

- **La Serie A** entra en `HIGH_PROBABILITY_LEAGUES`: Alta probabilidad, no Picks.
- **La Bundesliga** sigue cargada y visible, sin Alta probabilidad. Para volver a evaluarla haría falta un protocolo
  nuevo, con un periodo que no se haya visto.
- **Cambio posterior (26 de octubre de 2026, decisión del usuario):** las cuotas pre-partido de la Serie A también se
  piden a the-odds-api.com con `refresh_odds.py` (2 créditos por refresco), como en las demás ligas de Alta
  probabilidad, para tenerlas antes que con `fixtures.csv`. Es la media de las casas que devuelve esa API, la misma
  fuente que ya usan en la web Premier, LaLiga e Hypermotion. El backtest usó la de Football-Data.
