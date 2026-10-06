from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routers import admin, health, leagues, matches, picks, recommendations, teams
from app.core.config import get_settings
from app.core.logging import configure_logging

configure_logging()
settings = get_settings()

app = FastAPI(
    title="Stadistics4bet API",
    description="Probabilidades reales y EV frente a cuotas de mercado para futbol.",
    version="0.1.0",
)

# Frontend React en local (Vite) durante desarrollo.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(leagues.router)
app.include_router(teams.router)
app.include_router(matches.router)
app.include_router(recommendations.router)
app.include_router(picks.router)
app.include_router(admin.router)


@app.get("/")
def root() -> dict:
    return {
        "name": "Stadistics4bet",
        "leagues": settings.leagues,
    }
