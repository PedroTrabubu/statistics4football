# Experimento: estadísticas de equipo en el 1X2 sin cuotas (protocolo, escrito antes de calcular)

1. **Hipótesis única:** V1 reduce el log-loss 1X2 frente a V0. **Éxito:** IC 95 % de la media pareada log-loss(V1) − log-loss(V0) con extremo superior < 0 en desarrollo (22/23–25/26); 26/27 se evalúa una vez como confirmación. El 70–80 % de acierto no guía ninguna decisión.
2. **Datos:** 11 ligas nacionales jugadas (sin Champions). Ningún modelo usa cuotas. Referencia: mercado sin margen (Shin sobre `Market Average` pre-partido, nunca cierre), solo en partidos con cuotas.
3. **V0:** logit de la esperanza Elo propio (K = 20, ventaja local 65, inicio 1500, recién llegado = percentil 25 de su liga); logit de Dixon-Coles mensual (local, empate, visitante; `fit_league_model` con lo anterior al primer partido del mes); puntos por partido en los últimos 5 y 10 de liga de cada equipo; local/visitante: interceptos por clase más puntos por partido del local en casa y del visitante fuera (últimos 5); descanso: días desde su partido anterior en la BD, con tope de 14.
4. **V1 = V0 +** medias de los últimos 5 y 10 partidos de liga de cada equipo, a favor y en contra: goles, tiros, tiros a puerta, córners y xG (solo donde existe); y patrones `pat_venue`/`pat_all` (logit) de local, empate y visitante.
5. **Point-in-time:** las variables de un partido se calculan con días naturales anteriores; los partidos del mismo día no se ven entre sí. Sin historial: media del entrenamiento.
6. **Modelo:** logística multinomial, L2 con λ = 1 sobre variables estandarizadas (intercepto sin penalizar), por liga.
7. **Walk-forward por día:** el día d se entrena con todos los partidos de esa liga de días < d (mínimo 300).
8. **Calibración:** temperatura ajustada con las últimas 1000 predicciones walk-forward previas de la liga (mínimo 200; si no, T = 1).
9. **Etapas:** piloto en ENG-Premier League 25/26. Hay señal si la media de V1 − V0 < 0; si la hay, se amplía a las 11 ligas (se evalúa 22/23–25/26; 21/22 solo entrena y calienta la calibración) y después se evalúa 26/27. Sin señal, se para y se informa del piloto.
10. **Métricas:** log-loss; acierto del resultado más probable; acierto de la mejor doble oportunidad (excluye el resultado menos probable).
11. **Tramos de doble oportunidad** (no acumulativos): [0,5–0,6), [0,6–0,7), [0,7–0,75), [0,75–0,8), [0,8–0,85), ≥ 0,85, con n, cobertura, acierto e IC de Wilson. Se muestran los del modelo que gane según el punto 1 (V1 si hay éxito; si no, V0).
12. **IC:** 2000 remuestreos de partidos, semilla 20261028, percentiles 2,5–97,5, para las diferencias V1 − V0 de las tres métricas.
13. **Una sola ejecución.** Antes solo se permite una prueba en seco que construye variables y ajusta un modelo, sin puntuar ningún resultado.
14. **Nada se cambia tras ver los resultados;** cualquier desviación se anota al final de este documento.

## Desviaciones

Ninguna. Resultado (2026-10-28, ejecución única): sin señal en el piloto ENG 25/26 (log-loss V1 − V0 = +0,015, IC [−0,005; +0,037]); se paró sin ampliar y 26/27 sigue sin evaluar.
