# ¿Hay value en el duelo de córners? (protocolo)

Escrito el 2026-10-13, antes de tener los datos. Se evalúa **una sola vez**, al llegar a 400 partidos; hasta entonces
`python scripts/report_corner_value.py` solo dice cuántos lleva.

## Datos

- **Partidos:** los que empiezan desde el 2026-10-14 (00:00 UTC), con cuota de cierre de córners de Pinnacle en
  nuestras capturas y córners registrados. Quedan fuera los 26 del 10 al 12 de octubre, que ya se miraron.
- **Ligas:** las cuatro de la web, juntas.
- **Mercados:** hándicap de córners 0 (el empate devuelve) y ±0.5 (gana el duelo frente a no lo pierde), partido
  entero, al cierre.
- **Córners:** los de la base al evaluar. Son los de Football-Data cuando ya los ha publicado, y si no, los de ESPN.
- **Modelo:** el duelo de córners actual de la web (v1, sin tocar). Su copia en Python
  (`scripts/experiments_corner_duel.py`) da las mismas probabilidades.

## Definiciones

- **Probabilidad de Pinnacle:** sin margen, con el método de Shin.
- **Probabilidad del modelo** del mismo suceso:
  - hándicap 0: P(gana) / (1 − P(mismos));
  - −0.5: P(gana);
  - +0.5: P(gana) + P(mismos).
- **Favorito:** la selección con más probabilidad según Pinnacle.
- **Apuesta con valor:** la selección en la que el modelo da más de 5 puntos por encima de Pinnacle. Como mucho una por
  mercado y partido, a stake fijo y a la cuota de cierre. En el hándicap 0, el empate devuelve la apuesta.

## Medidas

1. **Favoritos de Pinnacle:** acierto frente a la probabilidad media de Pinnacle y rentabilidad a su cuota.
2. **Apuestas con valor:** número, acierto, ventaja media prevista y rentabilidad a cuota de cierre, con intervalo al
   95 % remuestreando partidos (2000 veces, semilla 20261009).
3. **Modelo frente a Pinnacle:** log-loss en los mismos mercados, con la diferencia y su intervalo. En el hándicap 0
   no cuentan los empates.

## Criterio

- **Hay value frente a Pinnacle** si el límite inferior del intervalo de la rentabilidad de las apuestas con valor es
  mayor que 0.
- **El modelo sabe más que Pinnacle** si el intervalo de la diferencia de log-loss (modelo − Pinnacle) queda entero
  por debajo de 0.
- Si no se cumple, se dice así. No se cambia el umbral de 5 puntos, el modelo ni los mercados después de ver nada.
- Rentable frente a Pinnacle no significa rentable en Winamax, que tiene otras cuotas y más margen.

## Resultados

Se añaden debajo.
