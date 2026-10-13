"""Cuotas actuales de Pinnacle, de la API con la que su propia web las pinta.

guest.api.arcadia.pinnacle.com es la API que consulta pinnacle.com: publica,
sin clave ni sesion, pero no documentada, asi que puede cambiar sin aviso.
Lo que no se entienda se ignora en vez de fallar (check_schema lo cuenta como
aviso), y se pide poco y con pausa (dos peticiones por liga).

Solo da las cuotas de ahora, no hay historico: las de Pinnacle de partidos ya
jugados vienen del CSV de Football-Data (columnas PS*/PSC*, ver
odds_columns.py), y solo para 1X2, mas/menos 2.5 y handicap asiatico, hasta
mediados de enero de 2026. Lo que aporta esta API es lo que el CSV no trae:
corners, tarjetas, goles por equipo, primeras partes, lineas alternativas,
ambos marcan, doble oportunidad y empate no apuesta.

Cada partido de Pinnacle es un "matchup"; sus corners y sus tarjetas
("Bookings") son matchups hijos, en ligas aparte, que llegan en la misma
consulta de la liga. Ambos marcan, doble oportunidad, empate no apuesta y
"marca X" son matchups "special" del partido, con un precio por participante
("Yes"/"No", "Malaga Or Draw"...). Las cuotas vienen en formato americano.
"""

from __future__ import annotations

import logging
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

PINNACLE_API = "https://guest.api.arcadia.pinnacle.com/0.1"
PINNACLE_RULES_URL = "https://www.pinnacle.com/en/future/betting-rules"

# Codigo de la liga en la web -> id de la liga en Pinnacle (GET /sports/29/leagues).
LEAGUE_IDS: dict[str, int] = {
    "ENG-Premier League": 1980,
    "ESP-La Liga": 2196,
    "ESP-La Liga 2": 2432,
    "FRA-Ligue 1": 2036,
}

# "units" del matchup -> de que va la cuota.
UNITS = {"Regular": "goals", "Corners": "corners", "Bookings": "bookings"}
# Mercados "straight" que se entienden.
MARKET_TYPES = {"moneyline", "spread", "total", "team_total"}
SELECTIONS = {"home", "draw", "away", "over", "under"}

# Especiales que interesan (cubren picks de la web: "ambos marcan", "no
# pierde", "marca"). Los demas (resultado exacto, descanso/final, margen,
# goles exactos, primer equipo en marcar, combinadas...) se ignoran a
# proposito: no corresponden a ningun pick.
SPECIAL_MARKETS = {
    "Both Teams To Score?": "btts",
    "Double Chance": "double_chance",
    "Draw No Bet": "draw_no_bet",
}
TEAM_TO_SCORE_SUFFIX = " To Score?"  # "Malaga To Score?" -> team_to_score
FIRST_HALF_SUFFIX = " 1st Half"

# Reglas de resolucion publicadas por Pinnacle (la API no las trae). Copia
# literal de PINNACLE_RULES_URL, consultada el 2026-10-09.
MARKET_RULES: dict[str, str] = {
    "general": (
        "All match markets are based on the result at the end of a scheduled 90 minutes of play unless "
        "otherwise stated. This includes any added injury or stoppage time, but does not include extra "
        "time, a penalty shootout or a golden goal."
    ),
    "corners": (
        "In the event of a corner kick having to be retaken, only one corner kick will be counted. Corner "
        "kicks that are awarded and not taken are not counted."
    ),
    "bookings": (
        "Each yellow card is worth one booking, and each red card is worth two bookings. Second yellow "
        "cards on a competitor are ignored, so the maximum bookings for a player is three. Any cards shown "
        "to non-competitors (such as teammates on the bench, substituted players that are no longer taking "
        "part in the game, the manager, coach, or other staff) are not counted. Cards shown during the "
        "half-time break are counted towards the 2nd-half period Bookings markets. Any cards shown after "
        "the whistle that ends regulation time will not be counted towards the markets for that game."
    ),
}

# Claves vistas en las respuestas (octubre de 2026). Una que falte o una
# nueva se registra como aviso; no rompe la captura.
REQUIRED_MATCHUP_KEYS = {"id", "type", "units", "startTime", "participants", "parentId"}
KNOWN_MATCHUP_KEYS = REQUIRED_MATCHUP_KEYS | {
    "ageLimit", "altTeaser", "featureOrder", "hasAltSpread", "hasAltTotal", "hasBetshare", "hasLive",
    "hasMarkets", "isBetshareEnabled", "isFeatured", "isHighlighted", "isLive", "isPromoted", "league",
    "liveMode", "parent", "parlayRestriction", "periods", "rotation", "state", "status",
    "totalMarketCount", "version", "special",
}  # fmt: skip
REQUIRED_MARKET_KEYS = {"matchupId", "type", "key", "period", "prices"}
KNOWN_MARKET_KEYS = REQUIRED_MARKET_KEYS | {"cutoffAt", "limits", "version", "isAlternate", "status", "side"}
KNOWN_PRICE_KEYS = {"designation", "price", "points", "participantId"}
KNOWN_MATCHUP_UNITS = set(UNITS)

_PAUSE_SECONDS = 1.0
_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/128.0 Safari/537.36",
}


@dataclass(frozen=True)
class PinnacleMatch:
    matchup_id: int
    home: str
    away: str
    # UTC sin zona, como las fechas de la BD.
    start: datetime
    status: str | None = None  # "pending" antes de empezar
    is_live: bool = False
    version: int | None = None  # cambia cuando cambia algo del partido
    cutoff_at: datetime | None = None  # cierre de apuestas del partido entero


@dataclass(frozen=True)
class PinnacleOdds:
    # El partido (aunque la cuota sea de sus corners, sus tarjetas o un especial).
    matchup_id: int
    units: str  # "goals" | "corners" | "bookings"
    period: int  # 0 = partido entero, 1 = primera parte
    # "moneyline" | "spread" | "total" | "team_total" | "btts" | "double_chance"
    # | "draw_no_bet" | "team_to_score"
    market: str
    team: str | None  # team_total y team_to_score: "home" | "away"
    # "home" | "draw" | "away" | "over" | "under" | "yes" | "no"
    # | "home_draw" | "draw_away" | "home_away"
    selection: str
    line: float | None  # spread: la del equipo de la seleccion; total: la linea
    odds: float  # decimal
    alternate: bool | None  # None: esta consulta no lo dice
    max_stake: float | None = None  # apuesta maxima aceptada (liquidez)
    version: int | None = None  # version del mercado: cambia cuando se mueve
    key: str | None = None  # clave del mercado en Pinnacle ("s;0;ou;2.5")


@dataclass(frozen=True)
class SpecialMarket:
    """Un especial que se entiende: de que partido es y que es cada participante."""

    parent_id: int
    market: str
    team: str | None
    period: int
    selections: dict[int, str] = field(default_factory=dict)  # participantId -> seleccion


def american_to_decimal(price: float) -> float:
    """+201 -> 3.01; -122 -> 1.82."""
    if price == 0:
        raise ValueError("cuota americana 0")
    return round(1 + price / 100, 3) if price > 0 else round(1 + 100 / -price, 3)


def _parse_utc(iso: str) -> datetime:
    moment = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    if moment.tzinfo is not None:
        moment = moment.astimezone(timezone.utc).replace(tzinfo=None)
    return moment


def _cutoff(m: dict) -> datetime | None:
    for p in m.get("periods") or []:
        if isinstance(p, dict) and p.get("period") == 0 and p.get("cutoffAt"):
            try:
                return _parse_utc(p["cutoffAt"])
            except (TypeError, ValueError):
                return None
    return None


def _line(value: object) -> float | None:
    # -0.0 y 0.0 son la misma linea.
    return None if value is None else float(value) + 0.0


def parse_matchups(raw: list[dict]) -> tuple[dict[int, PinnacleMatch], dict[int, tuple[int, str]]]:
    """Los partidos, y para cada matchup con cuotas utiles (el propio partido,
    sus corners y sus tarjetas) a que partido pertenece y de que van."""
    matches: dict[int, PinnacleMatch] = {}
    owners: dict[int, tuple[int, str]] = {}
    for m in raw:
        if not isinstance(m, dict):
            continue
        if m.get("type") != "matchup" or m.get("parentId") is not None or m.get("units") != "Regular":
            continue
        sides = {p.get("alignment"): p.get("name") for p in m.get("participants") or [] if isinstance(p, dict)}
        if not sides.get("home") or not sides.get("away") or not m.get("startTime"):
            continue
        try:
            start = _parse_utc(m["startTime"])
        except (TypeError, ValueError):
            continue
        matches[m["id"]] = PinnacleMatch(
            m["id"],
            sides["home"],
            sides["away"],
            start,
            status=m.get("status"),
            is_live=bool(m.get("isLive")),
            version=m.get("version"),
            cutoff_at=_cutoff(m),
        )
        owners[m["id"]] = (m["id"], "goals")
    for m in raw:
        if not isinstance(m, dict):
            continue
        units = UNITS.get(m.get("units"))
        if m.get("type") == "matchup" and m.get("parentId") in matches and units in ("corners", "bookings"):
            owners[m["id"]] = (m["parentId"], units)
    return matches, owners


def _special_selection(market: str, name: str, home: str, away: str) -> str | None:
    if market in ("btts", "team_to_score"):
        return {"Yes": "yes", "No": "no"}.get(name)
    if market == "draw_no_bet":
        return {home: "home", away: "away"}.get(name)
    if market == "double_chance":
        return {f"{home} Or Draw": "home_draw", f"Draw Or {away}": "draw_away", f"{home} Or {away}": "home_away"}.get(name)
    return None


def parse_specials(raw: list[dict], matches: dict[int, PinnacleMatch]) -> dict[int, SpecialMarket]:
    """Los especiales que cubren picks de la web, por id de su matchup. Un
    especial cuyos participantes no se reconocen se deja fuera."""
    specials: dict[int, SpecialMarket] = {}
    for m in raw:
        if not isinstance(m, dict) or m.get("type") != "special" or m.get("parentId") not in matches:
            continue
        description = str((m.get("special") or {}).get("description") or "")
        period = 0
        if description.endswith(FIRST_HALF_SUFFIX):
            description, period = description[: -len(FIRST_HALF_SUFFIX)], 1
        parent = matches[m["parentId"]]
        team = None
        market = SPECIAL_MARKETS.get(description)
        if market is None and description.endswith(TEAM_TO_SCORE_SUFFIX):
            who = description[: -len(TEAM_TO_SCORE_SUFFIX)]
            team = {parent.home: "home", parent.away: "away"}.get(who)
            market = "team_to_score" if team else None
        if market is None:
            continue
        selections = {}
        for p in m.get("participants") or []:
            if not isinstance(p, dict):
                continue
            selection = _special_selection(market, str(p.get("name")), parent.home, parent.away)
            if selection is not None and p.get("id") is not None:
                selections[p["id"]] = selection
        if selections:
            specials[m["id"]] = SpecialMarket(m["parentId"], market, team, period, selections)
    return specials


def _team_of(market: dict) -> str | None:
    if market.get("type") != "team_total":
        return None
    side = market.get("side") or str(market.get("key", "")).rsplit(";", 1)[-1]
    return side if side in ("home", "away") else None


def _max_stake(market: dict) -> float | None:
    for limit in market.get("limits") or []:
        if isinstance(limit, dict) and limit.get("type") == "maxRiskStake" and limit.get("amount") is not None:
            return float(limit["amount"])
    return None


def parse_markets(
    raw: list[dict],
    owners: dict[int, tuple[int, str]],
    specials: dict[int, SpecialMarket] | None = None,
) -> list[PinnacleOdds]:
    """Las cuotas de los matchups que interesan, en decimal. Ignora los mercados
    cerrados, los especiales que no interesan y los precios que no se entienden."""
    specials = specials or {}
    odds: list[PinnacleOdds] = []
    for market in raw:
        if not isinstance(market, dict):
            continue
        if market.get("status") not in (None, "open"):
            continue
        try:
            period = int(market.get("period", 0))
        except (TypeError, ValueError):
            continue
        common = {
            "max_stake": _max_stake(market),
            "version": market.get("version"),
            "key": market.get("key"),
        }
        special = specials.get(market.get("matchupId"))
        if special is not None:
            if market.get("type") != "moneyline":
                continue
            for price in market.get("prices") or []:
                selection = special.selections.get(price.get("participantId")) if isinstance(price, dict) else None
                if selection is None or not price.get("price"):
                    continue
                odds.append(
                    PinnacleOdds(
                        matchup_id=special.parent_id,
                        units="goals",
                        period=period,
                        market=special.market,
                        team=special.team,
                        selection=selection,
                        line=None,
                        odds=american_to_decimal(price["price"]),
                        alternate=None,
                        **common,
                    )
                )
            continue
        owner = owners.get(market.get("matchupId"))
        if owner is None or market.get("type") not in MARKET_TYPES:
            continue
        team = _team_of(market)
        if market["type"] == "team_total" and team is None:
            continue
        for price in market.get("prices") or []:
            if not isinstance(price, dict):
                continue
            selection = price.get("designation")
            if selection not in SELECTIONS or not price.get("price"):
                continue
            try:
                line = _line(price.get("points"))
            except (TypeError, ValueError):
                continue
            odds.append(
                PinnacleOdds(
                    matchup_id=owner[0],
                    units=owner[1],
                    period=period,
                    market=market["type"],
                    team=team,
                    selection=selection,
                    line=line,
                    odds=american_to_decimal(price["price"]),
                    alternate=market.get("isAlternate"),
                    **common,
                )
            )
    return odds


def check_schema(matchups: object, markets: object) -> list[str]:
    """Avisos si la respuesta no tiene la forma conocida: campos que faltan,
    campos nuevos, tipos de mercado o unidades desconocidos. Nunca lanza: la
    captura sigue con lo que se entienda y el crudo queda guardado."""
    warnings: list[str] = []
    for name, payload, required, known in (
        ("matchups", matchups, REQUIRED_MATCHUP_KEYS, KNOWN_MATCHUP_KEYS),
        ("markets", markets, REQUIRED_MARKET_KEYS, KNOWN_MARKET_KEYS),
    ):
        if not isinstance(payload, list):
            warnings.append(f"{name}: se esperaba una lista y llegó {type(payload).__name__}")
            continue
        missing: Counter[str] = Counter()
        unknown: Counter[str] = Counter()
        not_dict = 0
        for item in payload:
            if not isinstance(item, dict):
                not_dict += 1
                continue
            missing.update(required - item.keys())
            unknown.update(item.keys() - known)
        if not_dict:
            warnings.append(f"{name}: {not_dict} elementos que no son objetos")
        for key, n in sorted(missing.items()):
            warnings.append(f"{name}: falta el campo '{key}' en {n} elementos")
        for key, n in sorted(unknown.items()):
            warnings.append(f"{name}: campo nuevo '{key}' en {n} elementos")
    if isinstance(matchups, list):
        units = Counter(
            m.get("units") for m in matchups if isinstance(m, dict) and m.get("type") == "matchup"
        )
        for unit, n in sorted((u, n) for u, n in units.items() if u not in KNOWN_MATCHUP_UNITS):
            warnings.append(f"matchups: unidades desconocidas '{unit}' en {n} partidos")
    if isinstance(markets, list):
        types = Counter(m.get("type") for m in markets if isinstance(m, dict))
        for kind, n in sorted((str(t), n) for t, n in types.items() if t not in MARKET_TYPES):
            warnings.append(f"markets: tipo de mercado desconocido '{kind}' en {n} mercados")
        price_keys: Counter[str] = Counter()
        for m in markets:
            if isinstance(m, dict):
                for p in m.get("prices") or []:
                    if isinstance(p, dict):
                        price_keys.update(p.keys() - KNOWN_PRICE_KEYS)
        for key, n in sorted(price_keys.items()):
            warnings.append(f"markets: campo nuevo '{key}' en {n} precios")
    return warnings


def main_total(odds: list[PinnacleOdds], matchup_id: int, units: str, period: int = 0) -> tuple[float, float, float] | None:
    """La linea principal de un total (la mas equilibrada: cuotas de mas y de
    menos mas parecidas), como (linea, cuota de mas, cuota de menos)."""
    lines: dict[float, dict[str, float]] = {}
    for o in odds:
        if (o.matchup_id, o.units, o.period, o.market) == (matchup_id, units, period, "total") and o.line is not None:
            lines.setdefault(o.line, {})[o.selection] = o.odds
    pairs = [(line, s["over"], s["under"]) for line, s in lines.items() if "over" in s and "under" in s]
    return min(pairs, key=lambda p: abs(p[1] - p[2])) if pairs else None


def moneyline(odds: list[PinnacleOdds], matchup_id: int, units: str = "goals") -> dict[str, float]:
    """1X2 del partido entero: {"home": 3.01, "draw": 3.24, "away": 2.59}."""
    return {
        o.selection: o.odds
        for o in odds
        if (o.matchup_id, o.units, o.period, o.market) == (matchup_id, units, 0, "moneyline")
    }


def parse_league(matchups: list[dict], markets: list[dict]) -> tuple[dict[int, PinnacleMatch], list[PinnacleOdds]]:
    """Partidos y cuotas de las dos respuestas de una liga (tambien sirve para
    reparsear un crudo guardado)."""
    matches, owners = parse_matchups(matchups)
    specials = parse_specials(matchups, matches)
    return matches, parse_markets(markets, owners, specials)


class PinnacleClient:
    def __init__(self) -> None:
        self._http = httpx.Client(base_url=PINNACLE_API, timeout=30, headers=_HEADERS, follow_redirects=True)
        self._last_request = 0.0
        self.requests = 0

    def __enter__(self) -> PinnacleClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self._http.close()

    def _get(self, path: str) -> list[dict]:
        pause = _PAUSE_SECONDS - (time.monotonic() - self._last_request)
        if pause > 0:
            time.sleep(pause)
        self._last_request = time.monotonic()
        self.requests += 1
        response = self._http.get(path)
        if response.status_code != 200:
            raise ConnectionError(f"Pinnacle respondió {response.status_code} a {response.url}")
        return response.json()

    def league_raw(self, league_code: str) -> tuple[list[dict], list[dict]]:
        """Las dos respuestas tal cual (partidos y mercados) de una liga."""
        league_id = LEAGUE_IDS[league_code]
        return self._get(f"/leagues/{league_id}/matchups"), self._get(f"/leagues/{league_id}/markets/straight")

    def league_odds(self, league_code: str) -> tuple[dict[int, PinnacleMatch], list[PinnacleOdds]]:
        """Partidos pendientes de una liga y todas sus cuotas (goles, corners,
        tarjetas y los especiales que interesan)."""
        matches, odds = parse_league(*self.league_raw(league_code))
        logger.info("Pinnacle %s: %d partidos, %d cuotas", league_code, len(matches), len(odds))
        return matches, odds
