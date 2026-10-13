# Picks muy probables: protocolo pre-registrado

Este documento se escribió **antes** de comprobar si los picks muy probables de la ficha de partido se cumplieron.
Fija qué se evalúa, con qué datos y cómo se mide. Así el resultado no se puede "afinar" mirando el test. Si algo
cambia después de ver el resultado, se anota al final como desviación, con su motivo, y la versión nueva solo se
evalúa con jornadas posteriores.

## Hipótesis

Un patrón que un equipo ha repetido mucho (por ejemplo, marcar fuera en 7 de 7 partidos), contrastado con lo que
hace el rival, se cumple **más de lo que es habitual en la liga** para ese mismo suceso. Si no, el bloque solo
repite lo que pasa en cualquier partido y no debería llamarse "muy probable".

## Qué se evalúa

El motor tal como está en `frontend/src/lib/patterns.ts` al escribir esto, sin tocar ningún parámetro:

- Patrón: al menos el 80 % de los partidos, con 5 partidos si se cumplió siempre y 8 si no.
- Contextos: el campo del partido y todos, esta temporada y los últimos 10 en ese campo o 20 en total.
- Solo la línea más exigente de cada estadística; fuera lo que en la liga pasa al menos en el 80 %.
- Contraste con el rival, fuerza (Wilson al 95 % con los dos historiales; Alta ≥ 0.75 y respaldado, Media ≥ 0.60
  y no contradicho) y un máximo de 6 picks por partido.

Los umbrales se fijaron mirando solo los picks de partidos **sin jugar** de la jornada 8 de 26/27 (el umbral de lo
trivial pasó de 85 % a 80 % al ver que salía "encaja menos de 2.5 goles"). Nunca se miró si algún pick se cumplía.

## Reglas anti-trampa

1. **Point-in-time.** Los picks de cada partido se calculan solo con partidos de la misma liga con fecha
   estrictamente anterior, de su temporada y la anterior. Es exactamente lo que muestra su ficha.
2. **Se cuentan todos los picks** de todos los partidos jugados. Un pick sin dato en el partido (por ejemplo, sin
   faltas registradas) no cuenta como acierto ni como fallo, y se informa de cuántos hay.
3. **Test: 25/26 completa y lo jugado de 26/27, en las cuatro ligas.** Se evalúa una vez con la configuración
   congelada. Las temporadas anteriores se pueden consultar en la web, pero no forman parte del test.

## Métricas

- **Acierto**: picks cumplidos sobre picks con dato, con su intervalo de Wilson al 95 %.
- **Lo esperable**: la media, sobre esos mismos picks, de la frecuencia del suceso en la liga (la que ya calcula el
  motor para descartar lo trivial). Es lo que se cumpliría si los equipos no tuvieran nada especial.
- **Ventaja**: acierto menos lo esperable, en puntos.
- Todo ello en total, por nivel de fuerza y por liga.

## Criterio, fijado antes de ver el resultado

- El bloque **aporta** si, en el total del test, el límite inferior del intervalo del acierto queda por encima de lo
  esperable.
- Los niveles **ordenan bien** si el acierto de Alta ≥ Media ≥ Baja.
- Si no se cumple, se dice así en la web y en este documento, sin cambiar los números.

## Resultados del test (25/26 + 26/27 hasta la jornada en curso, cuatro ligas)

1780 partidos, 1768 con algún pick: 10 607 picks, todos con dato para decidir.

| Nivel | Picks | Cumplidos | Acierto | Intervalo 95 % | Esperable en la liga | Ventaja |
|---|---:|---:|---:|---:|---:|---:|
| Alta | 1665 | 1379 | 82.8 % | 80.9–84.6 % | 74.9 % | +7.9 |
| Media | 8488 | 6640 | 78.2 % | 77.3–79.1 % | 72.6 % | +5.6 |
| Baja | 454 | 313 | 68.9 % | 64.5–73.0 % | 67.2 % | +1.7 |
| **Total** | **10 607** | **8332** | **78.6 %** | **77.8–79.3 %** | **72.7 %** | **+5.8** |

| Liga | Partidos | Picks | Acierto | Esperable | Ventaja |
|---|---:|---:|---:|---:|---:|
| Premier League | 430 | 2568 | 79.0 % | 72.9 % | +6.0 |
| LaLiga | 449 | 2676 | 80.4 % | 72.4 % | +8.0 |
| LaLiga Hypermotion | 550 | 3263 | 77.3 % | 72.3 % | +5.0 |
| Ligue 1 | 351 | 2100 | 77.6 % | 73.6 % | +4.0 |

### Lectura

1. **El bloque aporta.** El límite inferior del acierto (77.8 %) queda por encima de lo esperable (72.7 %), en
   total y en las cuatro ligas. Los patrones repetidos se cumplen más que ese mismo suceso en un partido cualquiera.
2. **Los niveles ordenan bien:** Alta 82.8 % ≥ Media 78.2 % ≥ Baja 68.9 %. Baja apenas supera lo habitual: su
   intervalo incluye lo esperable.
3. **Muy probable no es seguro.** Aproximadamente uno de cada cinco picks no se cumple.

### Exploratorio (no pre-registrado: orienta, no demuestra)

- El historial de los picks prometía de media un 87.9 % y se cumplió el 78.6 %: unos 9 puntos de regresión a la
  media.
- Los patrones del 100 % (1417 picks) se cumplieron el 77.8 %, igual que los del 80-99 % (78.7 %). Un "7 de 7" no
  es más fiable que un "17 de 20".
- Más muestra, más acierto: 75.4 % con 5-7 partidos, 77.4 % con 8-12 y 79.1 % con 13-20.
- Con el rival: respaldado 79.9 %, parcial 78.3 %, sin contraste 74.1 % (no respaldado: solo 23 picks, 65.2 %).

Estas pistas solo podrían usarse en una versión nueva del motor, pre-registrada y evaluada con jornadas
posteriores a esta fecha.
