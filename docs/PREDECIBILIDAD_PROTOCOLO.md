# Índice de predecibilidad: protocolo pre-registrado

Escrito el 2026-10-14, **antes** de calcular ningún índice ni ninguna métrica. Fija los datos, la variable objetivo,
las variables, el modelo, las bandas y cómo se valida. Si algo cambia después de ver un resultado, se anota al final
como desviación, con su motivo.

## Pregunta

¿Se puede saber antes de un partido si sus picks muy probables se van a cumplir **más de lo que ya cabría esperar por
la frecuencia de la liga**? El índice mide la fiabilidad de las señales históricas de ese partido, no su valor: el
mercado ya descuenta lo predecible. Solo se podría hablar de apuestas si la banda Alta supera claramente a Pinnacle
(ver "Mercado"); aun así, la web nunca dirá que un partido es "mejor para apostar".

## Qué no se toca

La generación de picks y sus umbrales (`frontend/src/lib/patterns.ts`), Market Average/Max, el EV y los backtests
pre-registrados. Las cifras existentes no cambian: el índice solo lee los picks que ya calcula la web.

## Comprobación previa: Champions League

El "resultado más probable" del duelo de córners de la Champions acertó 2 de 9 en la jornada 2 de 26/27, con el local
favorito en 8 de 9 (Sabah FK 67 % frente al Slavia; Viking 47 % frente al Bayern). Medido con el mismo cálculo que la
web (cada partido solo con los anteriores de la competición):

| Competición | Partidos | Local favorito | Acierto del más probable | P(local) media | Real | Muestra < 6 partidos |
|---|---:|---:|---:|---:|---:|---:|
| Champions 25/26 | 187 | 91 % | 56 % | 60 % | 58 % | 57 % |
| Champions 26/27 | 27 | 89 % | 41 % | 58 % | 33 % | 44 % |
| Ligas, 25/26 (rango) | 306–462 | 64–88 % | 52–63 % | 51–57 % | 52–58 % | 0–1 % |

- **Medias domésticas sin ajustar**: el duelo de córners no las usa (solo partidos de la Champions). Los picks de la
  ficha de un partido de Champions sí amplían los patrones de cada equipo con los partidos de su liga, sin ajustar
  por la fuerza de cada liga.
- **Sesgo de local**: sí. Con tan pocos partidos por equipo (4 en casa y 4 fuera por temporada; Sabah y Viking, 0 en
  casa), las medias de cada equipo se encogen hacia la del local y la del visitante de la competición, y el local
  queda favorito casi siempre. En 26/27 el local se lleva el duelo en el 33 % de los partidos y el modelo le da 58 %.

**Decisión**: la Champions queda marcada como **no calibrada**, fuera del índice y de su entrenamiento. No se arregla
el modelo en esta tarea.

## Datos

- Ligas: LaLiga, LaLiga Hypermotion, Premier League, Ligue 1, Bundesliga y Serie A (sin la Champions).
- Partidos jugados de **25/26 (desarrollo)** y **26/27 (prueba**, lo jugado hasta la ejecución).
- Picks: los de "Picks probables" (`checkPlayedPicksSteps`): cada partido solo con los anteriores de su liga, de su
  temporada y la anterior; como mucho 6, sin el duelo de córners.
- Unidad: un partido con al menos un pick con dato para decidirlo y con frecuencia de la liga. Los partidos sin picks
  no tienen índice.

## Variable objetivo (única principal)

**Exceso de acierto del partido** = media, sobre sus picks, de (se cumplió: 1 o 0) − (frecuencia del suceso en la liga
antes del partido, la `leagueRate` del pick). Restar la base evita que el índice premie partidos con picks de sucesos
muy frecuentes.

## Variables (todas anteriores al partido)

Calculadas en `frontend/src/lib/predictability.ts`, la misma función para el entrenamiento y para la web:

| Variable | Definición |
|---|---|
| `n_alta`, `n_media`, `n_baja` | Picks del partido de cada nivel de fuerza |
| `sample_min`, `sample_mean` | Mínimo y media de los partidos que sustentan cada patrón |
| `rival_backed`, `rival_against` | Parte de los picks que el rival respalda o contradice (cruce con el rival) |
| `history_min` | Partidos anteriores en la liga (dos temporadas) del equipo con menos historial |
| `volatility_goals` | Media de los dos equipos de la desviación típica de los goles del partido en sus 10 últimos |
| `volatility_corners` | Lo mismo con los córners del partido (sin dato si hay menos de 3) |
| `home_share` | Parte de los picks que son del local |
| `referee_sample` | Partidos anteriores del árbitro en la liga (0 si no se conoce) |
| `season_progress` | Jornada / jornadas de la temporada de esa liga |
| `league_*` | Liga (una columna por liga, menos una) |

La entropía de las probabilidades 1X2 del modelo **no se usa**: solo hay probabilidades Dixon-Coles anteriores al
partido en 25/26 de tres ligas, y casi ninguna en 26/27. La métrica secundaria de log-loss 1X2 se omite por lo mismo.
No se usa el resultado ni ninguna cuota.

Un dato que falta se rellena con la media del entrenamiento de ese paso.

## Modelo

Regresión ridge sobre variables estandarizadas (media y desviación del entrenamiento de cada paso), λ = 10, término
independiente sin penalizar. Dos variantes, las dos se informan:

- **A (principal)**: todas las variables.
- **B**: solo `n_alta`, `sample_min`, `rival_backed` e `history_min`.

## Índice y bandas

- **Índice (0–100)**: percentil de la predicción del partido entre las predicciones del mismo modelo sobre su
  conjunto de entrenamiento.
- **Bandas**: Baja por debajo de 33,3; Media hasta 66,7; Alta desde 66,7. Ningún umbral se ajusta a mano.
- Una banda con menos de 30 partidos se muestra como "muestra insuficiente".

## Validación sin trampas

1. **Walk-forward por día**: cada día de partidos se entrena con todos los partidos de días anteriores (todas las
   ligas, las dos temporadas) y se puntúan los de ese día. Mínimo 300 partidos de entrenamiento; antes, sin índice.
   Lo que muestra la web de un partido jugado es siempre ese valor fuera de muestra.
2. **Desarrollo con 25/26; prueba con 26/27**, evaluada **una sola vez** con todo lo de este documento congelado.
   Antes de la ejecución única, el código solo se prueba con una liga de 25/26.
3. **Métrica principal** (variante A, 26/27): exceso medio en la banda Alta − exceso medio en la Baja, con intervalo
   del 95 % remuestreando partidos (2000 réplicas, semilla 20261014).
4. Además: calibración por quintiles de la predicción (predicho frente a observado) y correlación de Spearman entre
   índice y exceso.

### Líneas base

- **Índice constante**: no separa nada; su diferencia Alta − Baja es 0 por construcción.
- **Nº de picks de fuerza alta**: el mismo percentil y las mismas bandas, con `n_alta` en lugar de la predicción.

### Criterio, fijado antes de ver el resultado

- El índice **separa** si la diferencia Alta − Baja de 26/27 es positiva y su intervalo no incluye el 0.
- **Mejora una línea base** si la diferencia entre la métrica del índice y la de la línea base, remuestreando los mismos
  partidos, tiene un intervalo que no incluye el 0. Si no, se dice que no la mejora.
- Que no separe nada es un resultado válido y se publica igual.

## Mercado: Pinnacle

Con los picks que tienen línea equivalente en Pinnacle (el cierre del CSV de Football-Data: 1X2 y más/menos 2.5; y las
capturas propias: además, totales y hándicap de córners), por banda (variante A): acierto − probabilidad de Pinnacle
sin margen (método por defecto, `app/probability/devig.py`), con intervalo remuestreando partidos. Los dos bloques no se
mezclan. Solo si la banda Alta queda **entera por encima** del mercado se anota en el resumen; la interfaz no lo dice.

## Interfaz

- Ficha de partido (ligas): "Predecibilidad: Alta/Media/Baja (xx/100)", con lo que mide y el exceso histórico de su
  banda (IC y n). En un partido jugado, el valor fuera de muestra; en uno por jugar, el modelo entrenado con todo lo
  anterior.
- Picks probables: tabla por banda y temporada (acierto, base de la liga, ventaja, IC, n) y el índice de cada partido
  jugado.
- Texto fijo: "Mide la fiabilidad de los patrones históricos, no la probabilidad de ganar una apuesta. El mercado ya
  descuenta lo predecible."
- Champions: sin índice, marcada como "no calibrada".

## Ejecución

Con el backend en marcha:

    cd frontend && npm run export:predictability       # variables y exceso de cada partido (data/reports/)
    cd frontend && npm run export:picks -- --seasons 2526,2627   # picks, para Pinnacle
    cd backend && python scripts/report_predictability.py      # walk-forward, métricas y data/model_cache/predictability.json

El índice de los partidos por jugar sale del último modelo: hay que repetir los tres pasos para incorporar jornadas
nuevas (eso no es reevaluar la prueba: la evaluación de 26/27 que vale es la primera).

## Desviaciones

Ninguna de método. Solo dos de presentación, antes de la ejecución única, al probar el código con LaLiga 25/26: la línea
base no imprime una "calibración" (su valor no es un exceso predicho) y un signo menos tipográfico se cambió por "-"
para la consola de Windows. Para la comparación con Pinnacle, `picks_probables.csv` se exportó solo con 25/26 y 26/27.

## Resultados (ejecución única, 2026-10-14)

2610 partidos de las seis ligas, 2595 con picks. Con índice (al menos 300 partidos de entrenamiento antes del día):
1888 de 25/26 y 390 de 26/27.

### Prueba: 26/27 (lo jugado hasta el 13 de octubre)

| Banda (variante A) | Partidos | Exceso medio [IC 95 %] |
|---|---:|---:|
| Alta | 142 | +5.9 pts [+2.5, +9.2] |
| Media | 124 | +4.5 pts [+0.7, +8.1] |
| Baja | 124 | +4.1 pts [+0.4, +7.7] |

- **Métrica principal, Alta − Baja: +1.7 pts [−3.0, +6.5]. El índice no separa** (el intervalo incluye el 0).
- Frente a "nº de picks de fuerza alta": −0.1 pts [−6.4, +6.4]. **No la mejora.** Frente al índice constante, la
  ganancia es la propia separación, que no es clara.
- Spearman índice-exceso: +0.063. Calibración por quintiles: predicho +2.9 / +4.5 / +5.9 / +7.1 / +8.9 pts, observado
  +3.0 / +5.3 / +3.6 / +6.1 / +6.3.
- Variante B: Alta − Baja +1.6 pts [−4.1, +7.1], Spearman +0.008.

### Desarrollo: 25/26

- Variante A: Alta (594) +6.4, Media (636) +6.0, Baja (658) +4.3 pts; Alta − Baja +2.0 [−0.0, +4.1]; Spearman +0.068.
- Variante B: Alta − Baja +1.5 [−0.7, +3.7]. Línea base "nº de picks de fuerza alta": +2.7 [+0.8, +4.6]; el índice no
  la mejora (−0.7 [−2.6, +1.4]).

### Mercado

Muy pocos picks con línea equivalente en partidos con índice, y todas las bandas por debajo de 30 partidos:

- Cierre de Pinnacle en Football-Data (hasta mediados de enero de 2026): Alta 22 picks, 86.4 % frente a 81.8 %
  (+4.6 pts [−9.4, +17.0]).
- Capturas propias (desde el 10 de octubre de 2026): Alta 15 picks, 53.3 % frente a 77.3 % (−24.0 pts [−54.5, +5.7]).

La banda Alta **no supera claramente al mercado**.

### Lectura

Todas las bandas superan a la base de la liga (los picks ya aportan, ver PICKS_PROBABLES_PROTOCOLO.md), pero el índice
apenas ordena los partidos: la Alta queda unos 2 puntos por encima de la Baja, sin que el intervalo lo confirme, y no
hace más que contar los picks de fuerza alta. La web lo muestra con este resultado a la vista, sin presentarlo como una
señal fiable.

## Ampliación retrospectiva (2026-10-14, no pre-registrada)

Después de la ejecución única, con el mismo código y las mismas reglas (variables, ridge λ = 10, walk-forward por día
con un mínimo de 300 partidos, terciles), sin tocar nada: un walk-forward continuo desde 21/22 en las seis ligas
(`export:predictability -- --seasons 2122,2223,2324,2425,2526,2627`). Las temporadas 21/22–24/25 no se habían mirado
para el índice. La web sigue mostrando los valores de la ejecución única.

| 21/22–24/25 | Partidos | Picks | Cumplidos | Acierto | Base de la liga | Ventaja [IC 95 %] |
|---|---:|---:|---:|---:|---:|---:|
| Alta | 3400 | 20 393 | 16 534 | 81.1 % | 72.9 % | +8.2 [+7.5, +8.8] |
| Media | 2935 | 17 609 | 13 893 | 78.9 % | 72.8 % | +6.1 [+5.5, +6.8] |
| Baja | 2334 | 14 004 | 10 708 | 76.5 % | 72.3 % | +4.1 [+3.4, +4.9] |

- Alta − Baja (exceso por partido): +4.0 pts [+3.1, +5.1]; Alta > Media > Baja en las seis temporadas.
- Frente a "nº de picks de fuerza alta": +1.0 [+0.0, +2.0]. La línea base sola separa +3.0 [+2.0, +3.9]: casi toda la
  separación viene de contar los picks de fuerza alta. Spearman +0.089.
- Por liga: separa en Premier (+4.6), Ligue 1 (+4.7) y Bundesliga (+5.5); no en LaLiga (+1.2 [−1.6, +3.7]) ni en la
  Serie A (−2.9 [−7.6, +2.5]), donde ni siquiera ordena las bandas.
- Calibración por quintiles: +3.4 → +4.5, +5.3 → +4.8, +6.4 → +6.4, +7.7 → +7.7, +10.0 → +8.6 pts.
- Pinnacle (cierre en Football-Data, solo 1X2 y más/menos 2.5): Alta 544 picks, +2.3 pts [−0.6, +5.1]; no supera
  claramente al mercado.
- Con el entrenamiento ampliado, 25/26 da +4.4 [+2.5, +6.5] y 26/27 +5.7 [+0.5, +10.3]: el resultado nulo de la
  ejecución única se debe en parte a entrenar desde cero en 25/26. No sustituye al resultado pre-registrado.
