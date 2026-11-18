"""Pick del partido de los partidos ya jugados, guardado, y su acierto por temporada.

Los de la ejecucion unica del protocolo (data/model_cache/match_pick.json, de
scripts/report_match_pick.py) llegan al 14/10/2026. Los jugados despues se
calculan con el mismo codigo, solo con lo anterior a su dia, y se guardan en
match_pick_played.json la primera vez: el pick de un partido jugado ya no
cambia, y calcularlo cuesta (unos 30 s una liga con un mes de partidos). Si se
cumplio se mira siempre en la base, con las estadisticas de hoy (llegan o se
corrigen despues del partido).
"""

from __future__ import annotations

import json
import os
import threading
from collections import defaultdict
from collections.abc import Iterable
from pathlib import Path

from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.config import PROJECT_ROOT
from app.db.models import League, Match, MatchStatus, Season
from app.picks.match_pick import CANDIDATES, Picked, outcome, pick_text
from app.picks.match_pick_data import run, to_match_data

CACHE_DIR = PROJECT_ROOT / "data" / "model_cache"
PROTOCOL_PATH = CACHE_DIR / "match_pick.json"
PLAYED_PATH = CACHE_DIR / "match_pick_played.json"
# Las ligas del protocolo; en el resto (y la Champions) no esta calibrado.
LEAGUES = {"ESP-La Liga", "ESP-La Liga 2", "ENG-Premier League", "FRA-Ligue 1", "GER-Bundesliga", "ITA-Serie A"}
# Primera temporada con pick del partido: 25/26 (desarrollo); 26/27, prueba.
FIRST_SEASON = "2526"

_BY_KEY = {c.key: c for c in CANDIDATES}
# Un solo calculo a la vez en este proceso: dos peticiones no calculan lo mismo.
_lock = threading.Lock()
_files: dict[Path, tuple[float, dict]] = {}


def _read(path: Path) -> dict:
    """El JSON del fichero, releido solo si cambio en disco."""
    if not path.exists():
        return {}
    mtime = path.stat().st_mtime
    cached = _files.get(path)
    if cached is None or cached[0] != mtime:
        cached = (mtime, json.loads(path.read_text(encoding="utf-8")))
        _files[path] = cached
    return cached[1]


def protocol() -> dict:
    """La ejecucion unica: picks de cada partido y acierto historico por tipo."""
    data = _read(PROTOCOL_PATH)
    return {"matches": data.get("matches", {}), "kinds": data.get("kinds", {})}


def _known(match_id: int) -> tuple[bool, dict | None]:
    """(guardado, pick): None es "sin pick del partido"."""
    key = str(match_id)
    for matches in (protocol()["matches"], _read(PLAYED_PATH).get("matches", {})):
        if key in matches:
            return True, matches[key]
    return False, None


def _save(new: dict[str, dict | None]) -> None:
    """Añade al fichero lo que ya tenga en disco (el programador y la API
    escriben los dos) y lo sustituye de una vez."""
    current = {**_read(PLAYED_PATH).get("matches", {}), **new}
    PLAYED_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = PLAYED_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps({"matches": current}, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, PLAYED_PATH)


def pick_dict(item: Picked) -> dict | None:
    """El pick de un partido como lo da la API (None: sin pick)."""
    pick = item.pick
    if pick is None:
        return None
    c = pick.candidate
    return {
        "text": pick_text(c, item.match.home_team, item.match.away_team),
        "family": c.family,
        "side": c.side,
        "option": c.option,
        "kind": c.kind,
        "p": pick.p,
        "base": pick.base,
        "n": pick.n,
        "hit": outcome(c, item.match),
    }


def _hit_today(pick: dict, match: Match) -> bool | None:
    candidate = _BY_KEY.get(f"{pick['family']}|{pick['side']}|{pick['option']}")
    return pick.get("hit") if candidate is None else outcome(candidate, to_match_data(match))


def played_picks(db: Session, matches: Iterable[Match]) -> dict[int, dict | None]:
    """Pick de cada partido jugado: el guardado o, si no lo hay, calculado (con
    lo anterior a su dia) y guardado. `hit`, con las estadisticas de hoy."""
    matches = list(matches)
    out: dict[int, dict | None] = {}
    missing: dict[int, set[int]] = defaultdict(set)
    for m in matches:
        found, pick = _known(m.id)
        if found:
            out[m.id] = pick
        else:
            missing[m.league_id].add(m.id)
    if missing:
        with _lock:
            new: dict[str, dict | None] = {}
            for league_id, ids in missing.items():
                # Otra peticion pudo calcularlos mientras esta esperaba.
                pending = {i for i in ids if not _known(i)[0]}
                if pending:
                    new.update({str(item.match.match_id): pick_dict(item) for item in run(db, league_id, pending)})
            if new:
                _save(new)
        for ids in missing.values():
            for i in ids:
                out[i] = _known(i)[1]
    return {m.id: None if out.get(m.id) is None else {**out[m.id], "hit": _hit_today(out[m.id], m)} for m in matches}


def _played_query(db: Session, league_id: int):
    return (
        db.query(Match)
        .join(Season, Season.id == Match.season_id)
        .filter(Match.league_id == league_id, Match.status == MatchStatus.HISTORICAL, Season.name >= FIRST_SEASON)
        .options(
            joinedload(Match.league),
            joinedload(Match.season),
            joinedload(Match.home_team),
            joinedload(Match.away_team),
            selectinload(Match.team_stats),
        )
    )


def refresh_played_picks(db: Session) -> str:
    """Programador: guarda el pick de los jugados que aun no lo tengan, para que
    el resumen no tenga que calcularlo al abrirse."""
    added = 0
    for league in db.query(League).filter(League.code.in_(LEAGUES)).all():
        pending = [m for m in _played_query(db, league.id).all() if not _known(m.id)[0]]
        if pending:
            played_picks(db, pending)
            added += len(pending)
    return f"partidos_nuevos={added}"


def summarize(rows: Iterable[tuple[str, dict | None]]) -> list[dict]:
    """Acierto por temporada de (temporada, pick) de partidos jugados. La base y
    la probabilidad, de media sobre los picks con dato para decidirlos."""
    acc: dict[str, dict] = {}
    for season, pick in rows:
        s = acc.setdefault(season, {"season": season, "matches": 0, "with_pick": 0, "decided": 0, "hits": 0, "base": 0.0, "p": 0.0})
        s["matches"] += 1
        if pick is None:
            continue
        s["with_pick"] += 1
        if pick["hit"] is None:
            continue
        s["decided"] += 1
        s["hits"] += int(pick["hit"])
        s["base"] += pick["base"]
        s["p"] += pick["p"]
    for s in acc.values():
        s["base"] = s["base"] / s["decided"] if s["decided"] else None
        s["p"] = s["p"] / s["decided"] if s["decided"] else None
    return sorted(acc.values(), key=lambda s: s["season"], reverse=True)


def season_summary(db: Session, league: League) -> list[dict]:
    """Acierto del pick del partido de cada temporada de la liga, desde la primera con pick."""
    matches = _played_query(db, league.id).all()
    picks = played_picks(db, matches)
    return summarize((m.season.name, picks[m.id]) for m in matches)
