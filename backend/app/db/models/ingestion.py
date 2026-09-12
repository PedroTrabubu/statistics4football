import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class IngestionStatus(str, enum.Enum):
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"


class IngestionRun(Base):
    """Auditoria de cada ejecucion de un job de ingesta (rate limits, errores...)."""

    __tablename__ = "ingestion_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    # p.ej. "soccerdata.match_history", "football_data_org.fixtures", "api_football.odds"
    source: Mapped[str] = mapped_column(String(64), index=True)

    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[IngestionStatus] = mapped_column(
        Enum(IngestionStatus, native_enum=False), default=IngestionStatus.RUNNING
    )

    rows_ingested: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
