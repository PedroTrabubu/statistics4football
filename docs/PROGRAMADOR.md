# Programador: actualización automática y designaciones arbitrales

`backend/scripts/scheduler.py --loop` mantiene los datos al día sin ejecutar nada a mano. Hace dos cosas:

1. **Actualiza la temporada en curso** antes y después de cada partido: resultados, estadísticas, xG, cuotas de la
   próxima jornada, árbitros y designaciones (los mismos pasos que `ingest_fixtures.py`, en
   `app/ingestion/update.py`).
2. **Captura las cuotas de Pinnacle** de la apertura al cierre ([PINNACLE.md](PINNACLE.md)).

## Cuándo actualiza

| Momento | Para qué |
|---|---|
| 36 h, 24 h, 18 h, 12 h y 6 h antes de cada partido | Árbitros designados, horas y cuotas de la próxima jornada |
| 3 h y 12 h después del inicio | Resultado y árbitro del partido jugado |
| Una vez al día, hasta 5 días después, mientras falten las estadísticas | Córners, tarjetas, faltas y tiros |

Una actualización sirve para todos los partidos: toca si ha pasado algún punto de control desde la anterior, así que
varios partidos a la misma hora comparten una. Tarda alrededor de un minuto y medio.

Las estadísticas de un partido jugado salen del CSV de Football-Data.co.uk, que se actualiza un par de veces por semana.
Hasta entonces el partido tiene marcador, xG y árbitro, pero no córners, tarjetas, faltas ni tiros, y los picks de esas
estadísticas salen como "sin dato en el partido".

## Designaciones arbitrales

`app/ingestion/designations.py`. Fuentes, comprobadas el 2026-10-10:

| Liga | Fuente principal | Contraste |
|---|---|---|
| LaLiga y LaLiga Hypermotion | API pública de laliga.com, la que usa su web | — |
| Premier League | API oficial de premierleague.com | API de laliga.com |
| Ligue 1 | API oficial de ligue1.com | API de laliga.com |

- La **RFEF** publica las designaciones de Primera y Segunda como imagen, sin texto que leer. La API de laliga.com trae
  las mismas en cuanto salen: la víspera de cada día de partido (las del sábado, el viernes a las 13:00).
- La **Premier** y la **Ligue 1** las publican varios días antes; el 10 de octubre ya estaban todas las de su jornada.
- La clave de la API de laliga.com es pública y va en la configuración de cada página de su web: se lee de ahí en cada
  pasada, por si cambia.
- Si la fuente oficial y la de contraste no coinciden, manda la oficial y queda un aviso en `discrepancias`.
- Los nombres se pasan al formato de la base con el mismo emparejador que ESPN: un árbitro conocido conserva su nombre
  ("José María Sánchez Martínez" queda "J Sánchez Martínez") y uno nuevo se lista en `arbitros_nuevos`.
- Solo se tocan partidos por jugar, donde el designado sustituye al que hubiera, y jugados sin árbitro.
- `data/arbitros_manual.csv` se aplica después y siempre prevalece. Los espacios de más en sus campos ya no dejan una
  fila sin partido.

Cada pasada queda en `ingestion_runs` con `source = "designations.sync"`: cuántas designaciones trajo cada fuente,
partidos actualizados, árbitros nuevos, discrepancias, equipos sin resolver y errores.

## Puesta en marcha

Está registrado en el Programador de tareas de Windows como **"Stadistics4bet programador"**:

- **Arranque:** al iniciar sesión y cada 5 minutos. Si ya está en marcha, el Programador no abre otro, y el propio
  script tampoco (bloqueo en `data/scheduler.lock`). Si se cae, vuelve a arrancar en menos de 5 minutos.
- **Sin ventana:** se ejecuta con `pythonw.exe` y no tiene límite de tiempo.
- **Requisito:** solo funciona con la sesión iniciada y el equipo encendido. Si el equipo duerme, se pone al día al
  despertar.

Desde `backend/`, con el entorno virtual activado:

```bash
python scripts/scheduler.py --status       # última actualización, próxima, partidos sin árbitro y si está en marcha
python scripts/scheduler.py --update-now   # actualizar ya
python scripts/scheduler.py --loop         # lanzarlo a mano (si la tarea no está en marcha)
```

- **Registro:** `backend/logs/scheduler.log`.
- **Historial:** cada actualización queda en `ingestion_runs` con `source = "scheduler.update"`, con su estado y los pasos
  con aviso.

Para pararlo o quitarlo, en PowerShell:

```powershell
Stop-ScheduledTask -TaskName "Stadistics4bet programador"         # parar ahora (vuelve a arrancar en 5 min)
Disable-ScheduledTask -TaskName "Stadistics4bet programador"      # desactivarlo
Unregister-ScheduledTask -TaskName "Stadistics4bet programador"   # quitarlo
```

Las predicciones del modelo (`refresh_predictions.py`) y las combinadas (`refresh_picks.py`) no están en el programador:
se siguen lanzando a mano.
