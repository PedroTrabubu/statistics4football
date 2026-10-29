# Porcentajes de resultado: protocolo (escrito antes de calcular)

Fija qué datos, variables, modelo, métricas y criterio de éxito se usan, antes de ejecutar ningún backtest. Nada se
cambia después de ver los resultados; cualquier desviación se anota al final.

## Objetivo

Probabilidad estimada de local, empate y visitante, calibrada, para la ficha de partido. La doble oportunidad sale
de sumar las 1X2 calibradas (1X = L + E, X2 = E + V, 12 = L + V), sin modelos aparte. El 80 % no es un objetivo de
acierto: es el nivel **Alta confianza**, que se da cuando la probabilidad calibrada es ≥ 0,80, por separado para el
resultado más probable y para la doble oportunidad más probable, con su cobertura y su acierto observado.

## Datos

- **Ligas:** las 6 nacionales con ficha en la web (ENG-Premier League, ESP-La Liga, ESP-La Liga 2, FRA-Ligue 1,
  GER-Bundesliga, ITA-Serie A), con un modelo por liga. La Champions queda fuera ("sin calibrar", sin niveles); las
  ligas de contexto no tienen ficha.
- **Temporadas:** 20/21 solo calienta el historial (Dixon-Coles, Elo, forma). Se entrena desde 21/22.
  **Desarrollo:** se evalúa 22/23–25/26 en walk-forward; 21/22 solo entrena y calienta la calibración.
  **Prueba:** lo jugado de 26/27 al ejecutar, una sola vez, al final, con todo congelado.
- **Cuotas (solo la variante A):** `Market Average` pre-partido de Football-Data (la toma del viernes o del martes;
  en la BD su hora es la del partido), sin margen con Shin. Nunca `(closing)` ni ninguna otra posterior. En
  producción será la última `Market Average` no de cierre guardada antes de congelar la predicción (fixtures.csv,
  la misma fuente; en las ligas de the-odds-api, su media: diferencia de fuente anotada como limitación).

## Variables (fijas)

Cada partido usa solo días naturales anteriores: los del mismo día no se ven entre sí.

1. **Dixon-Coles:** logit de P(L), P(E) y P(V), con `fit_league_model` ajustado con los partidos anteriores al día
   (un reajuste por día de partido).
2. **Elo propio v1** (`own_elo_pre`, filas finales): logit de la esperanza del local, (Elo_L + 65 − Elo_V) / 400 · ln 10.
3. **Forma:** puntos por partido en los últimos 5 y 10 partidos de liga de cada equipo (4 variables).
4. **Local/visitante:** interceptos por clase, más los puntos por partido del local en casa y del visitante fuera en sus
   últimos 5 (2 variables).
5. **Descanso:** días desde el partido anterior del equipo en la BD (cualquier competición), con tope de 14 (2).
6. **Puntos por partido en la temporada en curso**, de cada equipo (2).
7. **xG**, solo donde existe (ENG, ESP, FRA, GER, ITA): media de (xG a favor − xG en contra) en los últimos 10
   partidos de liga, la del local menos la del visitante (1).
8. **Solo variante A:** logit de P(L), P(E) y P(V) del mercado sin margen (3).

Un equipo sin historial toma la media del entrenamiento.

## Modelo

- Regresión logística multinomial con L2 (λ = 1) sobre variables estandarizadas e intercepto sin penalizar. Un modelo
  por liga, reentrenado cada día de partido con todo lo anterior de esa liga (mínimo 300 partidos).
- **Calibración:** temperatura ajustada con las últimas 1000 predicciones walk-forward previas de la liga (mínimo 200;
  si no, T = 1). Sin isotónica.
- **Variante A**, con mercado: se entrena y predice solo en partidos con cuotas. **Variante B**, sin mercado: todos los
  partidos. Un partido sin cuotas usa B, y la ficha dice qué variante se usó.

## Bases (mismos partidos)

Mercado sin margen (Shin, tal cual); **mercado calibrado** (temperatura, con la misma regla que el modelo; es la
alternativa si A no cumple); Dixon-Coles tal cual; Elo (logística multinomial solo con la variable 2, mismo walk-forward
y calibración); siempre local (solo acierto); frecuencias de la liga (L/E/V de todos sus partidos anteriores).

## Métricas

- 1X2: log-loss y RPS. Doble oportunidad: Brier medio de 1X, X2 y 12.
- Acierto del resultado más probable y de la mejor doble oportunidad (la que excluye el resultado menos probable).
- Calibración por tramos de 0,1 sobre las tres probabilidades 1X2 de cada partido, con ECE (media de |p − observado|
  ponderada por partidos del tramo).
- Curva cobertura-acierto (umbral ≥ 0,5, 0,6, 0,7, 0,8 y 0,9) del resultado más probable y de la mejor doble oportunidad.
- **Alta confianza (≥ 0,80):** cobertura y acierto observado con IC de Wilson, para cada uno de los dos.
- IC 95 %: 2000 remuestreos de partidos, semilla fija del proyecto (`app/analysis/stats.py`, 20261009). Diferencias
  pareadas: A frente al mercado y B frente a Elo y a Dixon-Coles.

## Criterio de éxito (se decide en desarrollo; la prueba confirma)

- **A:** ECE ≤ 0,02, y log-loss no peor que el del mercado: el IC 95 % de log-loss(A) − log-loss(mercado) tiene su
  extremo inferior ≤ 0. Si queda peor (extremo inferior > 0), se dice y se propone mostrar el mercado calibrado.
- **B:** ECE ≤ 0,02, y no peor ni que Elo ni que Dixon-Coles con el mismo criterio. Se informa también frente al
  mercado.
- **Prueba 26/27:** se informa con sus IC. Si contradice el desarrollo (peor que la referencia de forma significativa),
  no se integra.

## Ejecución

Una sola ejecución del backtest (desarrollo y prueba). Antes solo se permite una prueba en seco que construye variables
y ajusta un modelo, sin puntuar ningún resultado.

## Desviaciones

1. **Hora de las cuotas de Football-Data (prueba en seco, 2026-10-28, antes de puntuar nada).** El filtro "toma no
   posterior al inicio" dejaba sin mercado al 16 % de los partidos: en ENG y ESP (≈47 %), las filas cargadas antes de
   pasar la BD a UTC llevan como hora el inicio en hora de Reino Unido (+1 h en verano). No son cuotas posteriores: son
   la toma del viernes o martes con una hora de relleno. Se acepta además esa hora exacta
   (`result_model.prematch_snapshot`); cualquier otra toma posterior al inicio (cuotas en directo de the-odds-api) se
   sigue descartando.

## Resultado (ejecución única, 2026-10-28)

No se cumple el criterio. Desarrollo (8.930 partidos): log-loss A − mercado = +0,017 [+0,014; +0,021]; B − Elo =
+0,007 [+0,003; +0,011]; B − Dixon-Coles = +0,005 [+0,001; +0,010]. ECE: A 0,011, B 0,015, mercado 0,007, Elo 0,005.
Prueba 26/27 (518 partidos): A − mercado = +0,007 [−0,007; +0,023], sin contradecir el desarrollo. Según el criterio,
se propone mostrar el mercado calibrado en lugar del modelo. Informe completo en `data/model_cache/result_backtest.json`.

## Decisión para el producto (2026-10-28, antes de calcular estas tablas)

- La web **no usa mercado**: las probabilidades 1X2 y de doble oportunidad son las del **Elo calibrado** (la base
  "Elo" de este protocolo: logística multinomial solo con el Elo propio v1, walk-forward diario y temperatura), en todos
  los partidos de las 6 ligas; la Champions queda fuera. El mercado queda solo como referencia del backtest.
- **La desviación 1 no afecta al Elo:** el Elo propio y su calibración no usan cuotas; solo cambiaba qué partidos tenían
  mercado (variante A y las bases de mercado).
- Tablas del Elo calibrado, con las predicciones ya guardadas de la ejecución única (`result_predictions.csv`), en
  desarrollo y una sola vez en 26/27, sobre todos los partidos con predicción Elo:
  - calibración 1X2 por tramos no acumulativos de 0,1 (n de probabilidades, media, observado e IC de Wilson);
  - doble oportunidad por tramos [0,5–0,6), [0,6–0,7), [0,7–0,75), [0,75–0,8), [0,8–0,85), ≥ 0,85 (n, acierto,
    Wilson, cobertura);
  - Alta confianza ≥ 0,80 en 1X2 y en doble oportunidad (cobertura y acierto).
- **Regla:** si en desarrollo Alta confianza en 1X2 tiene cobertura < 3 % o n < 100, ese nivel no se muestra en 1X2
  (solo en doble oportunidad).

### Elo calibrado: resultados (desarrollo 8.930 partidos; prueba 26/27, una vez, 518)

- **Calibración 1X2 (tramos de 0,1):** desarrollo ECE 0,005; en los 10 tramos la probabilidad media cae dentro del IC
  de Wilson de lo observado (p. ej. 0,5–0,6: 54,5 % frente a 53,2 % [51,1; 55,3], n = 2.151). Prueba ECE 0,021; 8 de 9
  tramos dentro; fuera 0,6–0,7 (63,6 % frente a 78,5 % [68,2; 86,1], n = 79). Detalle: `data/model_cache/result_elo_tables.json`.
- **Doble oportunidad** (n, acierto [Wilson], cobertura), desarrollo | prueba:

| Tramo | Desarrollo | Prueba |
|---|---|---|
| 0,5–0,6 | 0 (la mejor nunca baja de 2/3) | 0 |
| 0,6–0,7 | 572 · 70,8 % [66,9; 74,4] · 6,4 % | 31 · 83,9 % [67,4; 92,9] · 6,0 % |
| 0,7–0,75 | 3.102 · 73,0 % [71,4; 74,5] · 34,7 % | 198 · 69,2 % [62,4; 75,2] · 38,2 % |
| 0,75–0,8 | 1.986 · 76,7 % [74,8; 78,5] · 22,2 % | 116 · 74,1 % [65,5; 81,2] · 22,4 % |
| 0,8–0,85 | 1.441 · 80,6 % [78,5; 82,6] · 16,1 % | 83 · 81,9 % [72,3; 88,7] · 16,0 % |
| ≥ 0,85 | 1.829 · 88,8 % [87,3; 90,2] · 20,5 % | 90 · 92,2 % [84,8; 96,2] · 17,4 % |

- **Alta confianza ≥ 0,80:** 1X2 desarrollo cobertura 1,6 %, acierto 80,6 % [73,3; 86,2], n = 144 (prueba 1,4 %, 7 de 7);
  doble oportunidad desarrollo 36,6 %, 85,2 % [83,9; 86,4], n = 3.270 (prueba 33,4 %, 87,3 % [81,5; 91,5], n = 173).
- **Regla aplicada:** cobertura en 1X2 < 3 % → el nivel no se muestra en 1X2; solo en doble oportunidad.
- Referencia: en desarrollo el mercado acierta el resultado más probable un 52,7 % frente al 51,4 % del Elo (+1,3 puntos).

## Implementación (ficha, 2026-10-28)

- Bloque "Porcentajes de resultado" tras la cabecera de la ficha (`WinProbability.tsx`, id `porcentajes`): 1X2 y doble
  oportunidad del Elo calibrado, chip "Alta confianza" solo en la mejor doble oportunidad (≥ 0,80), ✓/✗ en los jugados,
  acierto histórico de la liga y calibración por tramos (desarrollo y temporada en curso; "pocas muestras" con n < 100).
- Tabla `result_predictions` (versión `elo_calibrado_v1`, hora de congelación). `scripts/refresh_result_predictions.py`
  y el paso "Porcentajes de resultado" del programador: incrementales; "reconstruida" para los jugados sin predicción
  previa, "congelada" para los generados antes del inicio (desde el inicio no se reescriben). Las reconstruidas
  coinciden con el backtest (diferencia máxima 1e-16 en 9.925 partidos). Resumen en `data/model_cache/result_summary.json`.
- Lectura: `GET /matches/{id}/result-probabilities` y `GET /leagues/{id}/result-probabilities?season=` (export estático).

## Comparación Elo / Dixon-Coles / media (2026-10-28, regla fijada antes de calcular)

Desarrollo 22/23–25/26, 6 ligas, mismos partidos: Elo calibrado; Dixon-Coles mensual (reajuste con lo anterior al
primer partido del mes) calibrado con temperatura (misma regla que el mercado calibrado); media 50/50 de los dos
calibrados. Métricas: log-loss con diferencia pareada frente al Elo e IC 95 % (remuestreo por partidos, semilla del
proyecto), acierto del resultado más probable, ECE y doble oportunidad ≥ 0,80 (cobertura y acierto). **Regla:** solo se
cambia el modelo de la ficha si otra opción mejora el log-loss del Elo con IC de extremo superior < 0; si no, se queda
el Elo. 26/27 solo se informa de la opción elegida, sin decidir con ella.

Resultado (desarrollo, 8.930 partidos): Elo log-loss 1,0026; Dixon-Coles mensual calibrado 1,0042 (+0,0016
[−0,0018; +0,0051]); **media 50/50 0,9999 (−0,0028 [−0,0044; −0,0010])**. Acierto 51,4 / 51,0 / 51,4 %; ECE 0,0047 /
0,0051 / 0,0068; doble oportunidad ≥ 0,80: 36,6 % · 85,2 % / 31,7 % · 85,9 % / 33,2 % · 86,3 %. Por la regla, se elige
la media 50/50. Prueba 26/27 (solo la elegida, 518 partidos): log-loss 0,9802, acierto 53,9 %, ECE 0,018, doble
oportunidad ≥ 0,80: 31,7 % · 87,8 % (n = 164). Pendiente de pasarla a la ficha (hoy muestra el Elo).

### Media 50/50 (`elo_dc_v1`): doble oportunidad por tramos (n · acierto [Wilson] · cobertura)

| Tramo | Desarrollo (8.930) | 26/27 (518) |
|---|---|---|
| 0,5–0,6 | 0 (la mejor nunca baja de 2/3) | 0 |
| 0,6–0,7 | 688 · 69,6 % [66,1; 72,9] · 7,7 % | 17 · 70,6 % [46,9; 86,7] · 3,3 % |
| 0,7–0,75 | 3.343 · 73,0 % [71,5; 74,5] · 37,4 % | 225 · 73,8 % [67,7; 79,1] · 43,4 % |
| 0,75–0,8 | 1.936 · 77,5 % [75,6; 79,3] · 21,7 % | 112 · 75,0 % [66,2; 82,1] · 21,6 % |
| 0,8–0,85 | 1.408 · 82,1 % [80,0; 84,0] · 15,8 % | 78 · 84,6 % [75,0; 91,0] · 15,1 % |
| ≥ 0,85 | 1.555 · 90,1 % [88,5; 91,5] · 17,4 % | 86 · 90,7 % [82,7; 95,2] · 16,6 % |

Implementación: versión `elo_dc_v1` = media de Elo calibrado y Dixon-Coles mensual calibrado (temperatura, misma regla).
Dixon-Coles mensual es un trabajo propio del programador (`dixon_coles.monthly`); si falla o falta en una liga, esa
liga usa solo Elo y la fila guarda `elo_calibrado_v1`. Las predicciones de partidos ya empezados no se reescriben; las
cifras del panel (acierto, calibración, Alta confianza) se recalculan con la media sobre el histórico.
