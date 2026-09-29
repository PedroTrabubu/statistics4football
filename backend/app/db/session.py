"""Engine y sesion de SQLAlchemy."""

from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

settings = get_settings()

is_sqlite = settings.database_url.startswith("sqlite")
connect_args = {"check_same_thread": False, "timeout": 30} if is_sqlite else {}

engine = create_engine(settings.database_url, connect_args=connect_args)

if is_sqlite:
    # WAL permite lectores concurrentes con un escritor, y busy_timeout hace
    # que una segunda escritura espere en vez de fallar al instante con
    # "database is locked" (p. ej. un script de refresh corriendo a la vez
    # que el backend atiende una peticion que escribe predicciones).
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
