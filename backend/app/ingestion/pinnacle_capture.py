"""Una pasada de captura de Pinnacle por liga: pide, guarda el crudo, valida,
cruza con nuestros partidos y anade a la base solo lo que ha cambiado.

Orden pensado para no perder nada si la API cambia:
1. Se registra la captura (hora, liga) antes de pedir nada.
2. Si la peticion falla, la captura queda como "failed" con el error.
3. El crudo (las dos respuestas JSON) se guarda comprimido antes de parsear.
4. check_schema anota avisos (campos que faltan o nuevos) sin parar.
5. Si el parseo o el cruce revientan, la captura queda "failed" con el crudo
   guardado para reparsear (load_raw + parse_league) cuando se arregle.

Solo se guardan cuotas pre-partido: un partido ya empezado (o en directo) se
cuenta en n_live_skipped y no escribe nada. Ver app/db/models/pinnacle.py.
"""

from __future__ import annotations

import json
import logging
import lzma
import re
from collections.abc import Iterable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import PROJECT_ROOT
from app.db.models import League, Match, PinnacleCapture, PinnacleMatchSnapshot, PinnaclePrice
from app.ingestion.pinnacle import LEAGUE_IDS, PinnacleMatch, PinnacleOdds, check_schema, parse_league
from app.ingestion.team_names import TeamResolver

logger = logging.getLogger(__name__)

RAW_DIR = PROJECT_ROOT / "data" / "pinnacle_raw"

# Margen para cruzar un partido de Pinnacle con el de la BD por fecha: las
# horas pueden no coincidir (aplazados, horas provisionales).
DATE_TOLERANCE = timedelta(days=2)

PriceKey = tuple[int, str, int, str, str | None, str, float | None]


class OddsSource(Protocol):
    requests: int

    def league_raw(self, league_code: str) -> tuple[list[dict], list[dict]]: ...


def utcnow() -> datetime:
    """UTC sin zona, como el resto de la base."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def price_key(o: PinnacleOdds | PinnaclePrice) -> PriceKey:
    line = None if o.line is None else float(o.line) + 0.0
    return (int(o.matchup_id), o.units, int(o.period), o.market, o.team, o.selection, line)


# --- crudo -------------------------------------------------------------------


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def save_raw(raw_dir: Path, capture: PinnacleCapture, matchups: object, markets: object) -> tuple[str, int]:
    """Guarda las dos respuestas tal cual, comprimidas (xz). Devuelve la ruta
    relativa a raw_dir y los bytes escritos."""
    rel = Path(_slug(capture.league_code)) / f"{capture.captured_at:%Y-%m-%d}" / (
        f"{capture.captured_at:%H%M%S}_{capture.id}.json.xz"
    )
    payload = {
        "source": "pinnacle",
        "captured_at": capture.captured_at.isoformat() + "Z",
        "league_code": capture.league_code,
        "league_id": LEAGUE_IDS.get(capture.league_code),
        "matchups": matchups,
        "markets": markets,
    }
    data = lzma.compress(json.dumps(payload, ensure_ascii=False).encode("utf-8"), preset=6)
    path = raw_dir / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return rel.as_posix(), len(data)


def load_raw(raw_dir: Path, rel_path: str) -> dict:
    """El crudo de una captura: {"matchups": [...], "markets": [...], ...}.
    Para reparsear: parse_league(raw["matchups"], raw["markets"])."""
    return json.loads(lzma.decompress((raw_dir / rel_path).read_bytes()).decode("utf-8"))


# --- cruce con la BD ---------------------------------------------------------


def find_match(db: Session, league_id: int, resolver: TeamResolver, pm: PinnacleMatch) -> Match | None:
    """El partido de la BD de esa liga con esos equipos mas cercano a la hora de Pinnacle."""
    home = resolver.resolve(pm.home)
    away = resolver.resolve(pm.away)
    if home is None or away is None:
        return None
    candidates = (
        db.query(Match)
        .filter(
            Match.league_id == league_id,
            Match.home_team_id == home.id,
            Match.away_team_id == away.id,
            Match.date.between(pm.start - DATE_TOLERANCE, pm.start + DATE_TOLERANCE),
        )
        .all()
    )
    return min(candidates, key=lambda m: abs(m.date - pm.start)) if candidates else None


# --- persistencia ------------------------------------------------------------


def latest_prices(db: Session, matchup_ids: Iterable[int]) -> dict[PriceKey, PinnaclePrice]:
    """La ultima fila de cada cuota de esos partidos (su estado actual)."""
    ids = list(matchup_ids)
    if not ids:
        return {}
    last_ids = (
        select(func.max(PinnaclePrice.id))
        .where(PinnaclePrice.matchup_id.in_(ids))
        .group_by(
            PinnaclePrice.matchup_id,
            PinnaclePrice.units,
            PinnaclePrice.period,
            PinnaclePrice.market,
            PinnaclePrice.team,
            PinnaclePrice.selection,
            PinnaclePrice.line,
        )
    )
    rows = db.scalars(select(PinnaclePrice).where(PinnaclePrice.id.in_(last_ids))).all()
    return {price_key(r): r for r in rows}


def changed_prices(
    capture: PinnacleCapture,
    odds: list[PinnacleOdds],
    match_ids: dict[int, int | None],
    latest: dict[PriceKey, PinnaclePrice],
) -> tuple[list[PinnaclePrice], list[PinnaclePrice]]:
    """Filas a anadir: cuotas nuevas o que han cambiado, y retiradas (cuotas
    que estaban y ya no estan, de partidos presentes en esta captura).

    La version del mercado de Pinnacle cambia cuando se mueve: si es la misma
    que la de la ultima fila, no hay nada que comparar."""
    written: list[PinnaclePrice] = []
    seen: set[PriceKey] = set()
    for o in odds:
        if o.matchup_id not in match_ids:
            continue
        key = price_key(o)
        if key in seen:
            continue
        seen.add(key)
        prev = latest.get(key)
        if prev is not None and not prev.is_removed:
            if o.version is not None and prev.market_version == o.version:
                continue
            if prev.odds == o.odds:
                continue
        written.append(
            PinnaclePrice(
                capture_id=capture.id,
                captured_at=capture.captured_at,
                matchup_id=o.matchup_id,
                match_id=match_ids[o.matchup_id],
                units=o.units,
                period=o.period,
                market=o.market,
                team=o.team,
                selection=o.selection,
                line=key[6],
                odds=o.odds,
                max_stake=o.max_stake,
                market_key=o.key,
                market_version=o.version,
                alternate=o.alternate,
                is_removed=False,
            )
        )
    removed = [
        PinnaclePrice(
            capture_id=capture.id,
            captured_at=capture.captured_at,
            matchup_id=prev.matchup_id,
            match_id=match_ids[key[0]],
            units=prev.units,
            period=prev.period,
            market=prev.market,
            team=prev.team,
            selection=prev.selection,
            line=prev.line,
            odds=None,
            max_stake=None,
            market_key=prev.market_key,
            market_version=None,
            alternate=prev.alternate,
            is_removed=True,
        )
        for key, prev in latest.items()
        if key[0] in match_ids and key not in seen and not prev.is_removed
    ]
    return written, removed


def _snapshot(capture: PinnacleCapture, pm: PinnacleMatch, match_id: int | None, odds: list[PinnacleOdds]) -> PinnacleMatchSnapshot:
    own = [o for o in odds if o.matchup_id == pm.matchup_id]
    moneyline = next(
        (o for o in own if (o.units, o.period, o.market) == ("goals", 0, "moneyline") and o.max_stake is not None),
        None,
    )
    return PinnacleMatchSnapshot(
        capture_id=capture.id,
        matchup_id=pm.matchup_id,
        match_id=match_id,
        home=pm.home,
        away=pm.away,
        start_time=pm.start,
        status=pm.status,
        is_live=pm.is_live,
        cutoff_at=pm.cutoff_at,
        version=pm.version,
        max_stake=moneyline.max_stake if moneyline else None,
        n_prices=len(own),
    )


def capture_league(
    db: Session,
    client: OddsSource,
    league_code: str,
    *,
    raw_dir: Path = RAW_DIR,
    resolver: TeamResolver | None = None,
    clock=utcnow,
) -> PinnacleCapture:
    """Una pasada de una liga (dos peticiones). Siempre deja una fila en
    pinnacle_captures con su resultado; nunca escribe en match_odds."""
    capture = PinnacleCapture(
        source="pinnacle",
        league_code=league_code,
        captured_at=clock(),
        status="running",
        requests=0,
        n_matchups=0,
        n_matched=0,
        n_live_skipped=0,
        n_prices=0,
        n_rows_written=0,
        n_removed=0,
    )
    db.add(capture)
    db.commit()

    before = client.requests
    try:
        matchups, markets = client.league_raw(league_code)
    except Exception as exc:  # noqa: BLE001  (red, 4xx/5xx, JSON roto: se anota y se sigue)
        capture.requests = client.requests - before
        capture.status = "failed"
        capture.error = f"{type(exc).__name__}: {exc}"[:2000]
        db.commit()
        logger.error("Pinnacle %s: la petición falló: %s", league_code, capture.error)
        return capture
    capture.captured_at = clock()  # hora de la respuesta
    capture.requests = client.requests - before

    warnings: list[str] = []
    try:
        capture.raw_path, capture.raw_bytes = save_raw(raw_dir, capture, matchups, markets)
    except OSError as exc:
        warnings.append(f"no se pudo guardar el crudo: {exc}")
    warnings += check_schema(matchups, markets)

    try:
        if not isinstance(matchups, list) or not isinstance(markets, list):
            raise ValueError("formato inesperado: se esperaban dos listas")
        matches, odds = parse_league(matchups, markets)
        league = db.query(League).filter_by(code=league_code).one_or_none()
        resolver = resolver or TeamResolver(db)
        stored: dict[int, int | None] = {}
        live = 0
        for pm in matches.values():
            if pm.is_live or pm.start <= capture.captured_at:
                live += 1
                continue
            match = find_match(db, league.id, resolver, pm) if league else None
            if match is None:
                warnings.append(f"sin partido en la BD: {pm.home} - {pm.away} ({pm.start:%d/%m %H:%M} UTC)")
            stored[pm.matchup_id] = match.id if match else None
        if stored and not any(o.matchup_id in stored for o in odds):
            # Partidos sin ninguna cuota entendida: mas probable un cambio de
            # formato que un mercado vacio. No se escriben retiradas falsas.
            raise ValueError(f"{len(stored)} partidos pendientes y ninguna cuota entendida")
        written, removed = changed_prices(capture, odds, stored, latest_prices(db, stored))
        snapshots = [_snapshot(capture, matches[mid], stored[mid], odds) for mid in stored]
    except Exception as exc:  # noqa: BLE001  (formato inesperado: queda el crudo)
        kept = (capture.captured_at, capture.requests, capture.raw_path, capture.raw_bytes)
        db.rollback()
        capture.captured_at, capture.requests, capture.raw_path, capture.raw_bytes = kept
        capture.status = "failed"
        capture.error = f"parseo: {type(exc).__name__}: {exc}"[:2000]
        capture.warnings = json.dumps(warnings, ensure_ascii=False) if warnings else None
        db.commit()
        logger.exception("Pinnacle %s: no se pudo parsear la respuesta (crudo en %s)", league_code, capture.raw_path)
        return capture

    db.add_all(snapshots)
    db.add_all(written)
    db.add_all(removed)
    capture.n_matchups = len(matches)
    capture.n_matched = sum(1 for match_id in stored.values() if match_id is not None)
    capture.n_live_skipped = live
    capture.n_prices = sum(1 for o in odds if o.matchup_id in stored)
    capture.n_rows_written = len(written)
    capture.n_removed = len(removed)
    capture.warnings = json.dumps(warnings, ensure_ascii=False) if warnings else None
    capture.status = "ok"
    db.commit()
    logger.info(
        "Pinnacle %s: %d partidos (%d cruzados, %d ya empezados), %d cuotas, %d filas nuevas, %d retiradas, %d avisos",
        league_code,
        capture.n_matchups,
        capture.n_matched,
        capture.n_live_skipped,
        capture.n_prices,
        capture.n_rows_written,
        capture.n_removed,
        len(warnings),
    )
    return capture
