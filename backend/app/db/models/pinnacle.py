"""Capturas de cuotas de Pinnacle (API publica, ver app/ingestion/pinnacle.py).

Tablas propias y solo de anadir, separadas de match_odds a proposito:
- match_odds se borra y se reescribe por partido en cada ingesta (Football-Data,
  fixtures.csv, the-odds-api), asi que no puede guardar un historial;
- su bookmaker "Pinnacle" ya existe (columnas PS* del CSV) y lo leen el
  indicador de coincidencia entre casas y los backtests: filas nuevas ahi
  cambiarian en silencio la referencia "Market Average" / "Market Max".

Nada de app/probability ni de app/picks lee estas tablas (lo comprueba
tests/test_pinnacle_store.py).

- PinnacleCapture: una pasada por liga (hora UTC, resultado, avisos, crudo).
- PinnacleMatchSnapshot: cada partido en cada pasada (estado, hora de cierre
  de apuestas, version, apuesta maxima).
- PinnaclePrice: una fila cuando una cuota aparece, cambia o se retira
  (is_removed); si no cambia no se escribe. El estado de cualquier cuota en
  cualquier captura es la ultima fila anterior o igual a esa captura.

Apertura, cierre y primera aparicion de cada mercado: vistas definidas en
OPENING_SQL, CLOSING_SQL y FIRST_SEEN_SQL (creadas por la migracion
e4b7c2d9f1a6 y usadas por app/ingestion/pinnacle_queries.py).
"""

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PinnacleCapture(Base):
    __tablename__ = "pinnacle_captures"

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(32), default="pinnacle")
    league_code: Mapped[str] = mapped_column(String(64), index=True)
    # UTC sin zona, como el resto de la base: momento de la respuesta.
    captured_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    # "running" | "ok" | "failed"
    status: Mapped[str] = mapped_column(String(16), default="running")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    requests: Mapped[int] = mapped_column(Integer, default=0)

    n_matchups: Mapped[int] = mapped_column(Integer, default=0)  # partidos de la respuesta
    n_matched: Mapped[int] = mapped_column(Integer, default=0)  # cruzados con un partido de la BD
    n_live_skipped: Mapped[int] = mapped_column(Integer, default=0)  # ya empezados: no son pre-partido
    n_prices: Mapped[int] = mapped_column(Integer, default=0)  # cuotas entendidas
    n_rows_written: Mapped[int] = mapped_column(Integer, default=0)  # nuevas o cambiadas
    n_removed: Mapped[int] = mapped_column(Integer, default=0)  # retiradas

    # JSON: lista de avisos (esquema, partidos sin cruzar...).
    warnings: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Crudo comprimido (JSON de las dos respuestas), relativo a data/pinnacle_raw.
    raw_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    raw_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)


class PinnacleMatchSnapshot(Base):
    __tablename__ = "pinnacle_match_snapshots"
    __table_args__ = (UniqueConstraint("capture_id", "matchup_id", name="uq_pinnacle_snapshot_capture_matchup"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    capture_id: Mapped[int] = mapped_column(ForeignKey("pinnacle_captures.id"), index=True)
    matchup_id: Mapped[int] = mapped_column(BigInteger, index=True)  # id del partido en Pinnacle
    match_id: Mapped[int | None] = mapped_column(ForeignKey("matches.id"), nullable=True, index=True)
    home: Mapped[str] = mapped_column(String(100))  # nombres de Pinnacle
    away: Mapped[str] = mapped_column(String(100))
    start_time: Mapped[datetime] = mapped_column(DateTime)
    status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_live: Mapped[bool] = mapped_column(Boolean, default=False)
    cutoff_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # cierre de apuestas
    version: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Apuesta maxima del 1X2 del partido: con limite alto, un precio es mas fiable.
    max_stake: Mapped[float | None] = mapped_column(Float, nullable=True)
    n_prices: Mapped[int] = mapped_column(Integer, default=0)


class PinnaclePrice(Base):
    __tablename__ = "pinnacle_odds"
    __table_args__ = (
        Index("ix_pinnacle_odds_key", "matchup_id", "units", "period", "market", "team", "selection", "line"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Sin indices propios: es la tabla que mas crece y todas las consultas van
    # por partido (ix_pinnacle_odds_key empieza por matchup_id).
    capture_id: Mapped[int] = mapped_column(ForeignKey("pinnacle_captures.id"))
    captured_at: Mapped[datetime] = mapped_column(DateTime)
    matchup_id: Mapped[int] = mapped_column(BigInteger)
    match_id: Mapped[int | None] = mapped_column(ForeignKey("matches.id"), nullable=True, index=True)

    units: Mapped[str] = mapped_column(String(16))  # goals | corners | bookings
    period: Mapped[int] = mapped_column(Integer)  # 0 partido, 1 primera parte
    # moneyline | spread | total | team_total | btts | double_chance | draw_no_bet | team_to_score
    market: Mapped[str] = mapped_column(String(32))
    team: Mapped[str | None] = mapped_column(String(8), nullable=True)
    selection: Mapped[str] = mapped_column(String(16))
    line: Mapped[float | None] = mapped_column(Float, nullable=True)

    odds: Mapped[float | None] = mapped_column(Float, nullable=True)  # decimal; None si se retira
    max_stake: Mapped[float | None] = mapped_column(Float, nullable=True)
    market_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    market_version: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    alternate: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    is_removed: Mapped[bool] = mapped_column(Boolean, default=False)


_KEY = "o.matchup_id, o.units, o.period, o.market, o.team, o.selection, o.line"

# Primera vez que aparece cada mercado de cada partido (la apertura de corners
# y tarjetas no es la del 1X2).
FIRST_SEEN_SQL = """
SELECT o.matchup_id AS matchup_id, MAX(o.match_id) AS match_id, o.units AS units, o.period AS period,
       o.market AS market, MIN(o.captured_at) AS first_seen_at
FROM pinnacle_odds o
WHERE o.is_removed = 0
GROUP BY o.matchup_id, o.units, o.period, o.market
"""

# Apertura: la primera cuota capturada de cada seleccion y linea.
OPENING_SQL = f"""
SELECT * FROM (
  SELECT o.*, ROW_NUMBER() OVER (PARTITION BY {_KEY} ORDER BY o.captured_at, o.id) AS rn
  FROM pinnacle_odds o
  WHERE o.is_removed = 0
) WHERE rn = 1
"""

# Cierre: el estado de cada cuota en la ultima captura del partido anterior a
# su inicio (la hora de inicio es la de su ultima captura: los aplazamientos
# la cambian). Si en esa captura la cuota estaba retirada, no tiene cierre.
# En un partido aun sin empezar es la ultima cuota disponible.
CLOSING_SQL = f"""
SELECT * FROM (
  SELECT o.*, cl.closed_at AS closed_at,
         ROW_NUMBER() OVER (PARTITION BY {_KEY} ORDER BY o.captured_at DESC, o.id DESC) AS rn
  FROM pinnacle_odds o
  JOIN (
    SELECT s.matchup_id AS matchup_id, MAX(c.captured_at) AS closed_at
    FROM pinnacle_match_snapshots s
    JOIN pinnacle_captures c ON c.id = s.capture_id
    JOIN pinnacle_match_snapshots last ON last.id = (
      SELECT MAX(s2.id) FROM pinnacle_match_snapshots s2 WHERE s2.matchup_id = s.matchup_id
    )
    WHERE c.captured_at < last.start_time
    GROUP BY s.matchup_id
  ) cl ON cl.matchup_id = o.matchup_id
  WHERE o.captured_at <= cl.closed_at
) WHERE rn = 1 AND is_removed = 0
"""

VIEWS = {
    "pinnacle_market_first_seen": FIRST_SEEN_SQL,
    "pinnacle_opening_odds": OPENING_SQL,
    "pinnacle_closing_odds": CLOSING_SQL,
}
