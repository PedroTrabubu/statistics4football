"""Cuando toca capturar una liga de Pinnacle."""

from datetime import datetime, timedelta

from app.ingestion.pinnacle_schedule import capture_interval, is_due, next_capture_at

NOW = datetime(2026, 10, 10, 12, 0)
H = timedelta(hours=1)
M = timedelta(minutes=1)


def test_first_capture_is_due_at_once():
    assert is_due(None, [], NOW)
    assert next_capture_at(None, [NOW + 3 * 24 * H], NOW) == NOW


def test_interval_depends_on_the_next_kickoff():
    assert capture_interval(None) == 6 * H
    assert capture_interval(30 * H) == 6 * H
    assert capture_interval(10 * H) == H
    assert capture_interval(40 * M) == 12 * M


def test_far_from_the_matchday_every_six_hours():
    starts = [NOW + 3 * 24 * H]
    assert not is_due(NOW - 2 * H, starts, NOW)
    assert is_due(NOW - 6 * H, starts, NOW)
    assert not is_due(NOW - 5 * H, [], NOW)  # sin partidos: igual cada 6 h


def test_last_24_hours_every_hour_and_last_hour_every_12_minutes():
    assert not is_due(NOW - 30 * M, [NOW + 10 * H], NOW)
    assert is_due(NOW - 61 * M, [NOW + 10 * H], NOW)
    assert is_due(NOW - 13 * M, [NOW + 40 * M], NOW)
    assert not is_due(NOW - 5 * M, [NOW + 40 * M], NOW)


def test_final_capture_just_before_kickoff():
    start = NOW + 150 * timedelta(seconds=1)  # empieza en 2.5 min
    assert is_due(start - 12 * M, [start], NOW)  # la ultima fue hace 9.5 min: toca la final
    assert not is_due(start - 4 * M, [start], NOW)  # ya hay una en los ultimos 6 min
    # El momento objetivo de la captura final: 3 minutos antes (antes que la
    # siguiente de cada 12 minutos).
    soon = NOW + 10 * M
    assert next_capture_at(NOW, [soon], NOW) == soon - 3 * M
    # Con 30 minutos por delante manda la cadencia de la ultima hora.
    assert next_capture_at(NOW, [NOW + 30 * M], NOW) == NOW + 12 * M


def test_matches_at_the_same_time_share_one_pass():
    start = NOW + 2 * M
    assert not is_due(NOW - 1 * M, [start, start, start], NOW)


def test_a_recent_capture_counts_as_the_final_one():
    start = NOW + 2 * M
    assert not is_due(NOW - 1 * M, [start], NOW)  # la de hace 1 min ya es la final
    assert next_capture_at(NOW - 1 * M, [start], NOW) == NOW + 11 * M  # la siguiente, ya sin partido


def test_after_a_failure_retry_in_ten_minutes_not_before():
    assert not is_due(NOW - 7 * H, [], NOW, last_failure=NOW - 5 * M)
    assert is_due(NOW - 7 * H, [], NOW, last_failure=NOW - 11 * M)
    assert not is_due(None, [], NOW, last_failure=NOW - 1 * M)
    # Un fallo anterior a la ultima buena no cuenta.
    assert is_due(NOW - 7 * H, [], NOW, last_failure=NOW - 8 * H)
