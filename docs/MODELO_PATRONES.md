# Modelo de patrones: protocolo pre-registrado

Este documento se escribió **antes** de ejecutar ningún backtest del modelo. Fija qué datos se usan, cómo se
entrena, cómo se eligen los umbrales y cómo se mide el acierto. Así el resultado no se puede "afinar" mirando el
test. Si algo cambia después de ver el test, debe quedar anotado al final como desviación, con su motivo.

## Hipótesis

Si un patrón estadístico de un equipo se repite (por ejemplo, el local marca en casa casi siempre o el visitante
encaja fuera casi siempre), es posible que se siga repitiendo. La pregunta es si ese patrón aporta información
**que el mercado y el modelo Dixon-Coles no tengan ya**.

## Reglas anti-trampa

1. **Solo información pre-partido.** Todas las features de un partido se calculan con partidos anteriores a su
   fecha. Las cuotas son las pre-partido de Football-Data (`Market Average`, sin "(closing)"). Las cuotas de
   cierre no se usan nunca.
2. **Separación temporal fija.**
   - Calentamiento: 20/21. Solo sirve como histórico para las features; no se predice.
   - Entrenamiento: 21/22, 22/23 y 23/24.
   - Validación: 24/25. Se usa para elegir umbrales y comparar variantes.
   - **Test: 25/26 y lo jugado de 26/27.** Se evalúa **una sola vez**, con la configuración congelada en un
     fichero antes de ejecutarlo.
3. **El modelo de test se reentrena con entrenamiento + validación**, sin ver el test.
4. **Se cuentan todas las selecciones** que cumplan la regla. Nada se descarta a posteriori.
5. **El acierto se compara siempre con lo que esperaba el mercado** para esas mismas selecciones. Un 70% de acierto
   en apuestas que el mercado ya daba al 72% no es mérito del modelo.

## Mercados (eventos binarios)

1X2 (local, empate, visitante), doble oportunidad (1X, X2, 12), más/menos 1.5, 2.5 y 3.5 goles, ambos marcan
(sí/no), marca el local y marca el visitante. Son 16 selecciones por partido.

## Fuentes de probabilidad por selección

- **Mercado (`p_mkt`):** probabilidades Shin de las cuotas medias pre-partido de 1X2 y más/menos 2.5. Para el
  resto de mercados, se ajusta un Poisson (λ local, μ visitante) que reproduce esas cuotas, y se derivan del
  marcador.
- **Dixon-Coles (`p_dc`):** el modelo actual, reajustado mes a mes solo con partidos anteriores.
- **Patrón por campo (`p_pat_venue`):** tasa del evento en los últimos 10 partidos del local en casa y los últimos
  10 del visitante fuera, cada una encogida hacia la media de la liga con 5 partidos ficticios, y promediadas.
- **Patrón general (`p_pat_all`):** igual, con los últimos 20 partidos de cada equipo en cualquier campo.

Los parámetros (10, 20, 5) se fijan aquí y no se tocan.

## Modelo

Una regresión logística por selección, con regularización L2 (λ = 1, features estandarizadas). Las features son
los logits de `p_mkt`, `p_dc`, `p_pat_venue` y `p_pat_all`. Si los patrones no aportan, sus coeficientes saldrán
cerca de cero y el modelo se parecerá al mercado. Eso también es un resultado válido.

## Regla de recomendación

Como máximo **una selección por partido**:

- **Estrategia A, "alta probabilidad":** entre las selecciones con `p_modelo ≥ τ`, se elige la de mayor
  `p_modelo − p_mkt`.
- **Estrategia B, "valor":** igual que A, pero además exige `p_modelo − p_mkt ≥ δ`.

τ se elige en **validación** como el menor valor de la rejilla 0.60–0.90 (pasos de 0.01) con acierto ≥ 72% y al
menos 100 selecciones. Se deja un margen de 2 puntos sobre el objetivo del 70%. δ se elige en validación entre
{0.01, 0.02, 0.03, 0.05} por ROI con al menos 50 selecciones. Si ningún valor cumple, se informa así.

## Líneas base (misma regla y mismos umbrales elegidos en validación para cada una)

- Solo mercado (`p_modelo = p_mkt`; en la estrategia A elige la selección de mayor `p_mkt`).
- Solo Dixon-Coles.
- Solo patrones.

## Métricas

- Acierto, número de selecciones y **probabilidad media que el mercado daba a esas selecciones**. El margen sobre
  el mercado es la métrica de mérito real.
- ROI con cuota media pre-partido donde exista: 1X2 y más/menos 2.5 reales; doble oportunidad sintética a partir
  de las cuotas 1X2, con su margen incluido. Para el resto de mercados no hay cuota en los datos, así que no se
  inventa ROI.
- Log-loss y Brier de cada fuente por mercado, para medir la calidad de la probabilidad y no solo el acierto.

## Desviaciones posteriores al test

Ninguna. El test se ejecutó una vez con la configuración congelada en `modelo_patrones_config.json`
(1 de octubre de 2026).

## Resultados

Reproducir con `python scripts/backtest_pattern_model.py build`, luego `dev` y luego `test`.

### Umbrales elegidos en validación (24/25)

Modelo: τ = 0.62 y δ = 0.03.

### Test: 25/26 + 26/27 (879 partidos, una selección como máximo por partido)

| Variante | Selecciones | Acierto | El mercado esperaba | Margen | ROI (selecciones con cuota) |
|---|---:|---:|---:|---:|---:|
| **Modelo A (alta probabilidad)** | 879 | **73.8%** | 71.1% | +2.7 pp | −2.2% (324) |
| **Modelo B (valor)** | 309 | **74.8%** | 68.5% | +6.2 pp | +3.1% (114) |
| Solo mercado | 879 | 82.7% | 83.0% | −0.3 pp | −7.2% (95) |
| Solo Dixon-Coles A | 879 | 75.0% | 71.9% | +3.1 pp | −2.5% (381) |
| Mercado + Dixon-Coles A | 879 | 74.6% | 74.2% | +0.4 pp | −5.3% (357) |
| Solo patrones A | 879 | 72.2% | 69.5% | +2.7 pp | −6.7% (312) |

Como referencia, las recomendaciones por EV que había antes acertaban un 30% en 1X2 y un 51% en más/menos 2.5.

### Lectura

1. **El objetivo del 70% se cumple fuera de muestra:** 73.8% (A) y 74.8% (B).
2. **Ese acierto viene sobre todo de elegir selecciones probables, no de saber más que el mercado.** La línea base
   "solo mercado" acierta un 82.7% sin ninguna habilidad, y pierde dinero (−7.2%).
3. **Los patrones repetidos no aportan información nueva.** En el entrenamiento, sus coeficientes salen entre
   −0.09 y +0.18, frente a 0.3–1.2 del mercado. En log-loss, el modelo empata con el mercado.
4. **El margen de B (+6.2 pp) hay que tomarlo con cautela:**
   - En validación, la misma regla daba +0.5 pp.
   - La mayoría de sus selecciones son de "marca el local/visitante", donde no hay cuota real en los datos y la
     probabilidad de mercado es una estimación por Poisson. Parte del margen puede ser un error de esa estimación,
     no ventaja real.
   - Solo hay ROI medible en 114 selecciones (+3.1%), y con esa muestra el error típico ronda ±6 puntos. No
     demuestra ventaja.

## Integración en la web

- La estrategia B se muestra en **Recomendaciones → Alta probabilidad** (`GET /recommendations?strategy=alta_probabilidad`).
- La web usa el mismo modelo que se evaluó en el test: entrenado con 21/22–24/25, con τ = 0.62 y δ = 0.03, guardado
  en `backend/app/probability/pattern_model_params.json` (`backtest_pattern_model.py export`). Usa también la misma
  regla de elección (`choose_selection`).
- El histórico son las 309 selecciones del test (`backtest_pattern_model.py history`), sin añadir ni quitar ninguna.
- En la web, el ROI solo cuenta 1X2 y más/menos 2.5, que tienen cuota real: sale +1.4% sobre 84 selecciones. El
  +3.1% del backtest incluía la doble oportunidad con una cuota sintética, y en la web no se inventa esa cuota.
- Los partidos programados reciben su selección con `scripts/refresh_predictions.py`, siempre que tengan cuotas
  pre-partido (`scripts/refresh_odds.py`).
- Para reentrenar con más temporadas hay que repetir el protocolo completo (build, dev, test) con una nueva
  temporada de test que el modelo no haya visto.
