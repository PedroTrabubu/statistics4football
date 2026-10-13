"""Estadísticas por partido: Football-Data.co.uk frente a ESPN.

Compara córners, amarillas, rojas, faltas, tiros y tiros a puerta de los
partidos jugados de 25/26 y 26/27 que tienen dato de Football-Data. Las
respuestas de ESPN se guardan en data/espn_cache/boxscores.jsonl: si se corta,
no se repiten. Las diferencias van a data/reports/stats_sources_diff.csv.

Uso (desde backend/, con el venv activado):
    python scripts/compare_stats_sources.py
"""

import csv
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import PROJECT_ROOT  # noqa: E402
from app.db.models import League, Match, MatchStatus, Season, Team, TeamMatchStats  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.ingestion.espn import CACHE_DIR, EspnClient, _JsonLinesCache, _resolve, espn_code  # noqa: E402
from app.ingestion.espn_stats import parse_boxscore  # noqa: E402
from app.ingestion.team_names import TeamResolver  # noqa: E402

SEASONS = ("2526", "2627")
FIELDS = ("corners_for", "yellow_cards", "red_cards", "fouls", "shots", "shots_on_target")
LABEL = {"corners_for": "Córners", "yellow_cards": "Amarillas", "red_cards": "Rojas", "fouls": "Faltas",
         "shots": "Tiros", "shots_on_target": "Tiros a puerta"}  # fmt: skip


def main() -> None:
    db = SessionLocal()
    resolver = TeamResolver(db)
    cache = _JsonLinesCache(CACHE_DIR / "boxscores.jsonl")
    rows = (
        db.query(Match, League.code)
        .join(League, League.id == Match.league_id)
        .join(Season, Season.id == Match.season_id)
        .filter(Season.name.in_(SEASONS), Match.status == MatchStatus.HISTORICAL)
        .all()
    )
    rows = [(m, code) for m, code in rows if (m.source_ids or {}).get("match_history_game_id")]
    stats = {(s.match_id, s.team_id): s for s in db.query(TeamMatchStats).filter(TeamMatchStats.match_id.in_([m.id for m, _ in rows]))}
    names = {t.id: t.name for t in db.query(Team)}

    with EspnClient() as client:
        # Partidos sin enlace con ESPN: se buscan en su calendario del día.
        event_of = {m.id: (m.source_ids or {}).get("espn_event_id") for m, _ in rows}
        missing = defaultdict(list)
        for m, code in rows:
            if not event_of[m.id]:
                missing[(code, m.date.date())].append(m)
        for (code, day), ms in missing.items():
            league = espn_code(code)
            for event in client.day_events(league, day, cacheable=True):
                home, away = _resolve(resolver, event.home_names), _resolve(resolver, event.away_names)
                for m in ms:
                    if home and away and (home.id, away.id) == (m.home_team_id, m.away_team_id):
                        event_of[m.id] = event.id

        compared, diffs = 0, []
        agree = defaultdict(lambda: [0, 0, 0])  # campo -> [iguales, total, |dif| >= 2]
        by_league = defaultdict(lambda: defaultdict(lambda: [0, 0]))
        zero_cards = []
        for m, code in rows:
            event = event_of[m.id]
            fd_h, fd_a = stats.get((m.id, m.home_team_id)), stats.get((m.id, m.away_team_id))
            if not event or not fd_h or not fd_a:
                continue
            key = f"{code}|{event}"
            if key not in cache:
                cache.put(key, parse_boxscore(client._get(f"{espn_code(code)}/summary", {"event": event})))
            espn = cache.get(key)
            if not espn:
                continue
            compared += 1
            if (fd_h.yellow_cards, fd_a.yellow_cards, fd_h.red_cards, fd_a.red_cards) == (0, 0, 0, 0):
                zero_cards.append(m.id)
            for side, fd in (("home", fd_h), ("away", fd_a)):
                for field in FIELDS:
                    a, b = getattr(fd, field), espn[side].get(field)
                    if a is None or b is None:
                        continue
                    agree[field][1] += 1
                    by_league[code][field][1] += 1
                    if a == b:
                        agree[field][0] += 1
                        by_league[code][field][0] += 1
                    else:
                        agree[field][2] += abs(a - b) >= 2
                        diffs.append([code, m.date.date(), names[m.home_team_id], names[m.away_team_id], side, field, a, b])
    db.close()

    print(f"Partidos comparados: {compared} de {len(rows)}")
    print("| Estadística | Iguales | Diferencia de 2 o más |")
    for field in FIELDS:
        same, total, big = agree[field]
        if total:
            print(f"| {LABEL[field]} | {same / total:.1%} ({total} datos) | {big / total:.1%} |")
    print("Por liga (iguales): " + " · ".join(
        f"{code}: córners {v['corners_for'][0] / max(v['corners_for'][1], 1):.0%}, amarillas {v['yellow_cards'][0] / max(v['yellow_cards'][1], 1):.0%}"
        for code, v in sorted(by_league.items())))  # fmt: skip
    print(f"Partidos con 0 tarjetas en los dos equipos según Football-Data: {len(zero_cards)}")
    out = PROJECT_ROOT / "data" / "reports" / "stats_sources_diff.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["liga", "fecha", "local", "visitante", "equipo", "estadistica", "football_data", "espn"])
        w.writerows(diffs)
    print(f"Diferencias: {out}")


if __name__ == "__main__":
    main()
