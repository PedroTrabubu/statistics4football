"""La base guarda UTC: el CSV de Football-Data.co.uk viene en hora de Reino Unido."""

from datetime import datetime

from app.ingestion.historical_backfill import uk_local_to_utc


def test_uk_summer_time_is_one_hour_ahead_of_utc():
    # Elche - Barcelona: 20:30 en el CSV (hora britanica de verano) = 19:30 UTC = 21:30 en Espana.
    assert uk_local_to_utc(datetime(2026, 8, 23, 20, 30)) == datetime(2026, 8, 23, 19, 30)


def test_uk_winter_time_equals_utc():
    assert uk_local_to_utc(datetime(2026, 1, 10, 15, 0)) == datetime(2026, 1, 10, 15, 0)
