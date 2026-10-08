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
