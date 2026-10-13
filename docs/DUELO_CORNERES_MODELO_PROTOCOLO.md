# Duelo de córners: modelo de probabilidades (protocolo)

Escrito el 2026-10-10, antes de calcular ninguna probabilidad. Es un bloque **nuevo**: no cambia los picks ni las cifras
anteriores de la web (ver [PICKS_DUELO_CORNERES_PROTOCOLO.md](PICKS_DUELO_CORNERES_PROTOCOLO.md) para los picks).

## Qué se muestra

En la ficha de cada partido y en la página "Picks probables", un bloque "Duelo de córners" con la probabilidad de que el
local saque más córners, de que saquen los mismos y de que el visitante saque más, y "no pierde" de cada equipo (gana o
empata el duelo).

La etiqueta "Pick muy probable" solo aparece cuando el motor de picks ya detecta el patrón con su umbral (≥ 80 %,
mismas muestras, contextos, fuerza y cruce con el rival). Esos picks van **fuera** del tope de 6 picks por partido y
fuera de los resúmenes de acierto de la página, para que las cifras anteriores sigan siendo comparables. Se marcan
como nuevos.

## Modelo (`frontend/src/lib/cornerDuel.ts`)

Solo partidos de la liga anteriores al partido, de su temporada y la anterior (lo que ya carga la web). El resultado
del partido nunca entra.

1. **Córners por equipo y partido:** los de la web (Football-Data, `HC`/`AC`). Para estimar medias, cada valor se
   recorta a 14 (un 18-0 cuenta como 14-0), para que un partido extremo no arrastre la media.
2. **Peso de cada partido:** `exp(-0.0018 × días)`, el mismo decaimiento temporal que Dixon-Coles en la web (vida
   media de un año).
3. **Media de la liga** por campo (córners del local y del visitante), con esos pesos.
4. **Encogimiento:** cada media de equipo es `(Σ peso × córners + 5 × media de la liga) / (Σ pesos + 5)`, el mismo
   encogimiento hacia la liga (5 partidos) que el modelo de conteos de las combinadas. Con pocos partidos, el equipo se
   parece a la liga.
5. **Córners esperados:** local = (lo que saca el local en casa × lo que concede el visitante fuera) / media de la liga
   para el local; visitante, igual al revés.
6. **Distribución:** córners de cada equipo binomial negativa con esa media y una dispersión común estimada por momentos
   en la liga (Poisson si no hay sobredispersión), independientes. De ahí la diferencia y las tres probabilidades.

Constantes fijadas aquí, antes de ver ningún resultado: recorte 14, decaimiento 0.0018, encogimiento 5.

## Evaluación

Una sola vez, sobre 25/26 completa y lo jugado de 26/27 en las cuatro ligas, cada partido solo con sus anteriores.

- **Calibración:** probabilidad predicha por tramos frente a frecuencia observada, con las tres probabilidades de cada
  partido.
- **Acierto** del resultado más probable y del "no pierde" del equipo con mayor probabilidad de no perder.
- **Log-loss** del resultado frente a dos bases simples: (a) la misma diferencia de Poisson con la media simple de
  córners a favor de cada equipo (sin pesos, sin encogimiento, sin rival; la de la liga si no tiene partidos) y (b) las
  frecuencias de la liga (gana local / empate / gana visitante).
- **Picks etiquetados:** acierto, frecuencia en la liga y ventaja con intervalo al 95 % remuestreando partidos
  (2000 veces, semilla 20261009).
- **Pinnacle:** si hay hándicap de córners ±0.5 al cierre en las capturas, diferencia entre lo observado y su
  probabilidad sin margen (Shin).

El 80 % es el umbral del motor para la etiqueta, no un objetivo. En tres resultados lo normal es que el más probable
acierte bastante menos. No se cambia ninguna constante, línea ni definición después de ver el resultado.

## Resultados

Se añaden debajo.

### 2026-10-10: 25/26 y 26/27, cuatro ligas (1780 partidos)

Frecuencia real: el local saca más en el 54.6 %, los mismos en el 10.2 %, el visitante en el 35.3 %.

| Calibración (las tres probabilidades) | n | Predicha | Observada |
|---|---:|---:|---:|
| < 20 % | 2000 | 10.7 % | 11.2 % |
| 20–30 % | 566 | 25.3 % | 29.9 % |
| 30–50 % | 1355 | 39.8 % | 39.8 % |
| 50–60 % | 651 | 54.8 % | 54.5 % |
| ≥ 60 % | 768 | 68.6 % | 64.2 % |

| Medida | Resultado |
|---|---|
| Acierto del resultado más probable | 57.8 % (probabilidad media 59.2 %) |
| Acierto del "no pierde" del favorito | 68.0 % (probabilidad media 69.3 %) |
| Log-loss del modelo | 0.904 |
| frente a la media simple del equipo | 0.922: −0.018 [−0.033, −0.003] |
| frente a las frecuencias de la liga | 0.935: −0.031 [−0.045, −0.016] |

| Picks etiquetados | Picks | Acierto | Liga | Modelo | Ventaja [IC 95 %] |
|---|---:|---:|---:|---:|---:|
| Alta + media | 122 | 73.8 % | 58.7 % | 76.9 % | +15.1 [+7.5, +22.4] |
| Total (609 de fuerza baja) | 731 | 65.1 % | 56.2 % | 65.9 % | +8.9 [+5.7, +12.2] |

- El modelo mejora a las dos bases y está bien calibrado en el centro; en los extremos es algo optimista (≥ 60 %
  predice 68.6 % y pasa el 64.2 %).
- Los picks etiquetados (Alta + media) superan la frecuencia de la liga con un intervalo por encima de 0.
- Pinnacle: ningún partido jugado con hándicap de córners ±0.5 en las capturas todavía.
