# Picks probables: duelo de córners (protocolo)

Escrito el 2026-10-10, antes de calcular ningún resultado del nuevo tipo de pick.

## Qué se añade

Un tipo de pick nuevo en el motor de "Picks probables" (`frontend/src/lib/patterns.ts`), con sus mismas reglas:
patrón en al menos el 80 % de los partidos (5 si se cumplió siempre, 8 si no), los cuatro contextos (campo del partido
y todos, esta temporada y últimos 10/20), descarte de lo trivial en la liga, contraste con el rival, niveles de fuerza
y tope de 6 picks por partido. El 80 % es el umbral del motor, no un objetivo de acierto: no se toca ningún umbral ni
definición para mejorar el resultado.

Opciones, siempre desde el equipo del pick y con sus córners a favor frente a los del rival en ese partido:

| Pick | Se cumple si | Lo que tiene que cumplir el rival (contraste) |
|---|---|---|
| Gana el duelo de córners | Saca más córners que el rival | Pierde el duelo en su campo |
| No pierde el duelo de córners | Saca al menos los mismos | No gana el duelo en su campo |
| Empata el duelo de córners | Saca los mismos | Empata el duelo |

El empate es una opción más: solo aparece si el motor detecta el patrón, como cualquier otra. "Gana" hace sobrar
"no pierde" del mismo equipo, igual que en el resultado. Un partido sin córners registrados no cuenta.

## Datos

Córners de cada equipo del CSV de Football-Data.co.uk (`HC`/`AC`). Solo partidos de la misma liga anteriores al
partido, de su temporada y la anterior, como el resto de picks.

## Test y métricas

Se calcula una sola vez, sobre 25/26 completa y lo jugado de 26/27 en las cuatro ligas, con el motor tal cual
(`npm run export:picks -- --seasons 2526,2627`).

- **Acierto** de los picks del duelo, total y por nivel de fuerza.
- **Frecuencia en la liga** de ese mismo suceso, la que ya calcula el motor.
- **Ventaja:** acierto menos frecuencia en la liga, con intervalo al 95 % remuestreando partidos (2000 veces,
  semilla 20261009).
- **Pinnacle**, si hay línea equivalente en las capturas: "gana" = hándicap de córners −0.5 del equipo; "no pierde" =
  +0.5. El empate no tiene equivalente (hándicap 0 devuelve la apuesta). Diferencia entre acierto y probabilidad sin
  margen (Shin) al cierre.

## Criterio

El tipo de pick aporta si el límite inferior del intervalo de la ventaja (Alta + Media) es mayor que 0. Si no, se
dice así, sin cambiar nada.

## Resultados

Se añaden debajo.

### 2026-10-10: 25/26 y 26/27, cuatro ligas

51 picks del duelo en 51 partidos, todos con dato. Ninguno de empate.

| Nivel | Picks | Acierto | Liga | Ventaja [IC 95 %] |
|---|---:|---:|---:|---:|
| Alta | 2 | 50.0 % | 58.4 % | −8.4 [−62.2, +45.4] |
| Media | 46 | 69.6 % | 58.6 % | +11.0 [−2.3, +24.2] |
| **Alta + media** | **48** | **68.8 %** | **58.5 %** | **+10.2 [−3.6, +23.2]** |

- **No se puede decir que aporte:** el intervalo de la ventaja incluye el 0. La muestra es pequeña porque ganar el
  duelo de córners en el 80 % de los partidos es raro.
- Pinnacle: ningún partido jugado tiene todavía hándicap de córners ±0.5 en las capturas (empezaron el 2026-10-10).
- Con el tope de 6 picks por partido, los 51 picks del duelo desplazan a 51 de otros tipos (10 607 → 10 568).

### Desviación, 2026-10-10

Para que las cifras anteriores de la web sigan siendo comparables, los picks del duelo pasan a ir aparte: fuera del
tope de 6 picks y de los resúmenes de acierto. Los demás picks vuelven a ser exactamente los de antes. Sin el tope,
el motor da 732 picks del duelo en 25/26 y 26/27; su evaluación está en
[DUELO_CORNERES_MODELO_PROTOCOLO.md](DUELO_CORNERES_MODELO_PROTOCOLO.md).
