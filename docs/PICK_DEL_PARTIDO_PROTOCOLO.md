# Pick del partido: protocolo pre-registrado

Escrito el 2026-10-14, **antes** de construir el modelo y de calcular ningún resultado. Fija los candidatos, cómo se
estima su probabilidad, cómo se elige y cómo se mide. No se cambia después de ver resultados; si algo cambia, se anota
al final como desviación.

## Qué es

Para cada partido, el modelo elige **un** pick entre una lista cerrada de candidatos: la señal histórica más fuerte del
partido según el modelo. No es una recomendación: el mercado ya descuenta lo probable.

## Qué no se toca

Los picks muy probables actuales (`frontend/src/lib/patterns.ts`), Market Average/Max, el EV, el modelo de conteos de
las combinadas (`app/picks/count_model.py`, solo se reutilizan sus piezas) y los backtests pre-registrados.

## Candidatos (lista cerrada)

Los mercados de `FAMILIES` en `patterns.ts`, con las líneas de las páginas de Mercados (`markets.ts`) a fecha de hoy,
"más de" y "menos de" en cada línea. Los de equipo, una vez por cada equipo; los de partido, una vez.

| Mercado | De | Líneas / opciones | Candidatos por partido |
|---|---|---|---:|
| Goles del equipo | cada equipo | 0.5–4.5 | 20 |
| Goles que encaja | cada equipo | 0.5–4.5 | 20 |
| Resultado | cada equipo | gana, empata, pierde, no pierde | 8 |
| Córners del equipo | cada equipo | 1.5–8.5 | 32 |
| Tarjetas del equipo | cada equipo | 0.5–5.5 | 24 |
| Faltas del equipo | cada equipo | 8.5–15.5 | 32 |
| Tiros del equipo | cada equipo | 6.5–18.5 | 52 |
| Tiros a puerta del equipo | cada equipo | 1.5–7.5 | 28 |
| Goles del partido | partido | 0.5–6.5 | 14 |
| Ambos marcan | partido | sí, no | 2 |
| Córners del partido | partido | 6.5–13.5 | 16 |
| Tarjetas del partido | partido | 0.5–9.5 | 20 |
| Faltas del partido | partido | 18.5–28.5 | 22 |
| Tiros del partido | partido | 16.5–30.5 | 30 |
| Tiros a puerta del partido | partido | 4.5–12.5 | 18 |
| **Total** | | | **338** |

Algunos son el mismo suceso visto desde los dos equipos (lo que encaja el local = lo que marca el visitante; "empata"
de los dos). Se dejan como están: no cambian la elección. Tarjetas = amarillas + rojas, como en nuestros datos. Un
candidato sin dato en la liga (por ejemplo, sin faltas) no cuenta.

## Probabilidad de cada candidato (solo datos anteriores al partido)

- **Goles y resultado**: el Dixon-Coles de la web (`app/probability/engine.py`), ajustado con los partidos de la liga
  anteriores al **día** del partido (sus parámetros de siempre: ξ = 0.0018, hasta 1100 días).
- **Córners, tarjetas, faltas, tiros y tiros a puerta**: un modelo de recuentos por liga, estadística y campo (lo que
  saca el local y lo que saca el visitante), con las piezas del modelo de las combinadas: las 4 variables del
  `CountTracker` (lo que saca el equipo y lo que concede el rival, en su campo y en todos, encogido hacia la liga) y
  regresión de Poisson con L2 = 1 y dispersión binomial negativa por momentos (`fit_count_model`). En tarjetas y
  faltas, una quinta variable: el **árbitro**, log de (total de sus partidos anteriores + 5 × media de la liga) /
  ((nº de partidos + 5) × media de la liga); 0 si no está designado. Se reajusta cada día con todos los partidos
  anteriores de la liga desde 23/24 (calentamiento). Los totales del partido, sumando las dos distribuciones.
- **Encogimiento**: p encogida = (n × p del modelo + 5 × base) / (n + 5), con n = partidos anteriores del equipo
  (en los de partido, el equipo con menos) en la ventana de la base.
- **Base de la liga**: frecuencia del suceso en los partidos anteriores de la liga, de la temporada y la anterior; en
  los de equipo, en su campo (local o visitante); en los de partido, en todos.

## Elección

1. Fuera los candidatos con base ≥ 80 % (la regla de los picks actuales) y los de p encogida < **65 %**.
2. De cada escalera (mercado, equipo y sentido), solo la línea más exigente que queda.
3. Puntuación = logit(p encogida) − logit(base), con las probabilidades acotadas a [0.001, 0.999].
4. Gana la mayor puntuación; empate: mayor n. Un pick por partido; si no queda ninguno, "sin pick del partido".

La Champions queda fuera (no calibrada, ver PREDECIBILIDAD_PROTOCOLO.md).

## Validación

- Ligas: LaLiga, LaLiga Hypermotion, Premier, Ligue 1, Bundesliga y Serie A. **Desarrollo: 25/26. Prueba: 26/27**,
  evaluada una sola vez. Walk-forward por día: cada partido solo con lo anterior a su día. Antes de la ejecución
  única, el código solo se prueba con una liga de 25/26.
- **Pick elegido**: acierto, base media y ventaja (acierto − base) con intervalo del 95 % remuestreando partidos
  (2000 réplicas, semilla 20261014).
- **Calibración**: probabilidad anunciada (p encogida) frente a acierto, en total y por tramos 65–70, 70–80, 80–90 y
  90–100 %. Se espera sobreestimación por selección; se informa tal cual.
- **Líneas base**, en los mismos partidos: (a) el candidato de mayor probabilidad bruta entre los que pasan el paso 1;
  (b) los picks actuales del motor: todos y el primero de cada partido. Diferencia de ventajas con intervalo
  remuestreando partidos.
- **Mercado**: los picks elegidos con línea equivalente en el cierre de Pinnacle de Football-Data (1X2, más/menos 2.5)
  y en nuestras capturas (también totales de goles y córners y líneas de equipo): acierto − probabilidad sin margen,
  con intervalo por partidos.
- **Criterio**: el pick del partido **aporta** si su ventaja en 26/27 tiene un intervalo entero por encima de 0, y
  **mejora una línea base** si la diferencia de ventajas tiene un intervalo entero por encima de 0. Si no, se dice.
  No se ajustan umbrales, líneas ni candidatos para lograr un acierto.
- Se cuentan los candidatos por partido (definidos, con dato y elegibles).

## Interfaz

- Ficha de partido: bloque "Pick del partido" con el pick, la probabilidad, la base de la liga y el acierto histórico
  de ese tipo de pick (mercado y sentido) con intervalo y n. En un partido jugado, el calculado antes del partido.
- Picks probables (histórico y próxima jornada): el pick del partido en cada tarjeta.
- Texto fijo: "Es la señal histórica más fuerte del partido según el modelo, no una recomendación; el mercado ya
  descuenta lo probable."

## Desviaciones

Ninguna. Antes de la ejecución única solo se probó el código con LaLiga 25/26.

## Resultados (ejecución única, 2026-10-14)

Seis ligas, 2610 partidos: todos con los 338 candidatos con dato y con pick del partido (54–55 elegibles de media).

| | 25/26 (desarrollo) | 26/27 (prueba) |
|---|---:|---:|
| Partidos con pick | 2214 | 396 |
| Acierto del pick del partido | 74.0 % | 71.5 % |
| Base de la liga | 54.1 % | 54.3 % |
| **Ventaja [IC 95 %]** | **+19.8 [+18.0, +21.7]** | **+17.1 [+12.6, +21.7]** |
| Base "mayor probabilidad": ventaja | +11.7 [+10.4, +13.0] | +9.5 [+6.1, +12.7] |
| Motor actual, todos sus picks | +5.8 [+5.0, +6.6] | +4.9 [+2.8, +6.9] |
| Motor actual, primer pick | +6.8 [+5.2, +8.4] | +3.5 [−0.7, +7.5] |
| Pick del partido − mayor probabilidad | +8.1 [+6.4, +10.0] | +7.6 [+2.9, +12.2] |
| Pick del partido − primer pick del motor | +13.1 [+10.8, +15.5] | +13.4 [+7.5, +18.8] |

- **Criterio**: en 26/27 el pick del partido **aporta** frente a la base de la liga y **mejora** las dos líneas base.
- **Calibración**: en 25/26, anunciado 74.6 % → acierto 74.0 %; en 26/27, 74.8 % → 71.5 %, con sobreestimación en los
  tramos altos (80–90 %: 85.0 % → 75.3 %; 90–100 %: 92.5 % → 84.2 %, n = 19).
- **Mercado**: frente al cierre de Pinnacle (Football-Data, 1X2 y más/menos 2.5; solo 25/26), 240 picks: 80.4 %
  frente a 80.0 %, +0.4 pts [−4.3, +4.9]. Capturas propias: 11 picks, sin muestra. **No supera al mercado.**
- Tipos más elegidos: "no pierde", tiros del equipo, "encaja menos de", faltas del equipo.

### Lectura

La ventaja se mide contra la frecuencia media de la liga, no contra el mercado: elegir el suceso en el que un equipo
más se aparta de la media (por ejemplo, que un equipo grande no pierda) da mucha ventaja sobre la liga, pero Pinnacle
ya lo descuenta. Que gane al motor actual se debe en parte a que este solo saca sucesos con base alta (≈ 73 %), donde
cabe menos ventaja.
