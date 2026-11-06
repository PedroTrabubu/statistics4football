from fastapi import APIRouter, HTTPException

from app.analysis.hit_rate import ALL, read_index, read_slice, read_team

# Pagina "Aciertos": solo lee lo que precalcula backend/scripts/report_hit_rate.py
# (data/model_cache/hit_rate/), sin calcular ni escribir nada en la peticion.
router = APIRouter(prefix="/hit-rate", tags=["hit-rate"])


@router.get("")
def get_hit_rate_index() -> dict:
    """Ligas, temporadas, fuentes y lo que solo esta en los protocolos (modelos
    sin historico por partido y retirados). Sin precalcular: {"available": false}."""
    index = read_index()
    return {"available": False} if index is None else {"available": True, **index}


@router.get("/slice")
def get_hit_rate_slice(league: str = ALL, season: str = ALL) -> dict:
    """Las cifras de cada modelo en una liga y temporada ("all": todas). Es el
    fichero <liga>/<temporada>.json tal cual: el export estatico publica esos."""
    data = read_slice(league, season)
    if data is None:
        raise HTTPException(status_code=404, detail="Sin aciertos precalculados para esa liga y temporada")
    return data


@router.get("/team")
def get_hit_rate_team(name: str) -> dict:
    """Los partidos de un equipo con lo que predijo cada modelo y si acerto
    (teams/<equipo>.json tal cual). Solo equipos del indice."""
    data = read_team(name)
    if data is None:
        raise HTTPException(status_code=404, detail="Sin partidos precalculados para ese equipo")
    return data
