# Duelo de córners: ¿un modelo mejor? (protocolo)

Escrito el 2026-10-13, antes de calcular nada con los modelos candidatos. El modelo actual (v1) está en
[DUELO_CORNERES_MODELO_PROTOCOLO.md](DUELO_CORNERES_MODELO_PROTOCOLO.md) y ya se evaluó en 25/26 y 26/27, así que esas
temporadas no sirven para elegir: solo para la comparación final, una vez.

## Partición de los datos

| Uso | Temporadas | Qué se hace |
|---|---|---|
| Ajuste | 22/23 y 23/24 | Se estiman los coeficientes de los candidatos |
| Selección | 24/25 | Se elige un solo candidato, el de menor log-loss |
| Test | 25/26 y lo jugado de 26/27 | Una sola comparación: v1 frente al elegido, este reajustado con 22/23 a 24/25 |

En todas, cada partido usa solo partidos anteriores de su liga, de su temporada y la anterior (como la web). Cuatro
ligas juntas.

## Candidatos (fijados aquí)

- **v1:** el actual, sin cambios.
- **A, encogimiento jerárquico:** como v1, pero la media de un equipo en su campo se encoge hacia su media en todos los
  campos (corregida por campo con la liga), y esta hacia la liga. Usa más partidos de cada equipo. Sin coeficientes
  ajustados.
- **B, regresión con córners:** córners de cada equipo con regresión binomial negativa sobre los logaritmos de las
  medias encogidas: lo que saca el equipo y lo que concede el rival, en el campo del partido y en todos. Dispersión
  por momentos con los residuos.
- **C, regresión con córners y tiros:** B más las medias encogidas de tiros a favor del equipo y en contra del rival
  (los tiros indican quién domina y varían menos de un partido a otro que los córners).

En todos, córners de cada equipo independientes y recortados a 14 al calcular medias, decaimiento 0.0018 y
encogimiento de 5 partidos como en v1.

## Medidas y criterio

- **Principal:** log-loss del resultado del duelo (gana local, mismos, gana visitante).
- **Secundarias:** acierto del resultado más probable, acierto del "no pierde" del favorito y calibración por tramos.
- **Se adopta el candidato** solo si en el test su log-loss es menor que el de v1 y el intervalo al 95 % de la
  diferencia (remuestreando partidos, 2000 veces, semilla 20261009) queda entero por debajo de 0. Si no, se queda v1.
- Lo que salga se publica igual, mejore o no. No se prueban más candidatos después de ver el test.

## Resultados

Se añaden debajo.

### 2026-10-13

Comprobación previa: la copia en Python de v1 da las mismas probabilidades que la web (diferencia máxima 1e-15).

**Selección (24/25, 1528 partidos):**

| Modelo | Log-loss | Más probable | No pierde |
|---|---:|---:|---:|
| v1 | 0.9220 | 56.2 % | 67.3 % |
| A | 0.9269 | 56.5 % | 67.5 % |
| B | 0.9135 | 56.6 % | 67.7 % |
| **C (elegido)** | **0.9107** | 57.4 % | 68.5 % |

**Test (25/26 y 26/27, 1808 partidos), una sola vez:**

| Modelo | Log-loss | Más probable | No pierde |
|---|---:|---:|---:|
| v1 | 0.9071 | 57.5 % | 67.7 % |
| C | 0.9022 | 58.1 % | 68.4 % |

C − v1 en log-loss: −0.0050 [−0.0121, +0.0020]. El intervalo incluye el 0: **se queda v1**, como fijaba el
criterio. C mejora un poco en todas las medidas, pero no lo bastante para descartar que sea suerte. Los dos siguen algo
optimistas en el tramo alto (C: predice 69.0 % y pasa el 65.6 %).
