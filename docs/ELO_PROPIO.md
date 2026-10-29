# Elo propio (fila "Elo propio" de la ficha, bloque Forma)

Es el Elo evaluado en [EXPERIMENTO_ESTADISTICAS_1X2_PROTOCOLO.md](EXPERIMENTO_ESTADISTICAS_1X2_PROTOCOLO.md), calculado
con los resultados de la BD. Código: `backend/app/stats/own_elo.py`; versión `elo_propio_k20_h65_v1`.

## Reglas (fijas)

- K = 20 y ventaja local de 65 puntos; resultado 1 / 0,5 / 0, sin margen de goles.
- Solo ligas nacionales. La Champions no entra: mezcla ligas cuyos ratings no son comparables, y en sus partidos la
  ficha muestra "—".
- Por días naturales: todos los partidos de un día salen con el rating del final del día anterior.
- **Continuidad entre temporadas:** el rating sigue tal cual, sin regresión a la media de la liga. Es lo más simple y
  deja el Elo idéntico al del experimento; una regresión parcial exigiría otra versión y otra evaluación.
- **Equipos nuevos:** el primer partido de un equipo en la BD arranca en el percentil 25 de los equipos de su liga
  (1500 si hay menos de 6, como en la primera temporada de la BD, 20/21). Un recién ascendido de una liga que no está en
  la BD empieza así; uno que sube o baja entre dos ligas de la BD (LaLiga ↔ LaLiga 2) conserva su rating.
- **Historial suficiente:** se muestra con al menos 10 partidos jugados del equipo (el umbral de muestra baja de la web,
  `frontend/src/lib/sampleLevel.ts`); con menos, "—" y el motivo en la nota.

## Persistencia

- Tabla `own_elo_pre`: el rating previo de cada equipo en cada partido, con los partidos con que se calculó.
- Lo genera el programador, como último paso de cada actualización (paso "Elo propio" de
  `backend/app/ingestion/update.py`), y a mano `backend/scripts/refresh_own_elo.py`. Es incremental e idempotente:
  escribe las filas finales de los partidos jugados que faltan y reescribe las provisionales de los programados con el
  rating actual. Las finales ya escritas no se recalculan; si hoy saldrían distintas (un resultado anterior corregido),
  se cuentan como discrepancias. Cada pasada queda en `ingestion_runs` (`source = "own_elo.refresh"`); si falla, el
  registro queda como fallido y la actualización del programador sale con aviso.
- Cada fila guarda el último partido cuyo resultado incluye (`computed_until`): la nota de la ficha dice "Elo calculado
  hasta <fecha>".
- La ficha (`GET /matches/{id}/stats`) y `GET /leagues/{id}/elo?season=` (todos los partidos de una liga y temporada,
  para el export estático) solo leen la tabla.

## Limitación: recién ascendidos (diagnóstico del 2026-10-28)

Congelado como versión 1, sin reinicio de ascendidos. La nota de la ficha avisa de que "los recién ascendidos pueden
estar sobrevalorados al inicio". Diagnóstico de lectura (sin cambiar nada): en los primeros 10 partidos de liga de los
148 ascendidos de 21/22–25/26 (1.480 partidos), resultado real menos esperado por el Elo previo (1 / 0,5 / 0) =
−0,006, IC 95 % [−0,024; +0,013] (2000 remuestreos de equipo-temporada, semilla 20261028): no se detecta
sobrevaloración, aunque el IC no descarta una pequeña. Por origen: 67 que conservan rating −0,008 [−0,035; +0,020];
81 nuevos en la BD −0,004 [−0,028; +0,021].

## Lo que queda sin uso (ClubElo, sin tocar)

`backend/app/ingestion/elo_backfill.py`, `backend/scripts/ingest_elo.py`, `get_clubelo_reader` de
`soccerdata_client.py`, la tabla `elo_ratings` (vacía) con su modelo `EloRating`, `get_elo_at` de
`backend/app/stats/elo.py` (solo lo usa su test) y las columnas `elo_pre` / `elo_post` de `team_match_stats` (vacías).
