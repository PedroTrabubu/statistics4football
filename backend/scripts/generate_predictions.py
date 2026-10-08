"""Ajusta Dixon-Coles por liga y genera predicciones/EV para los partidos de
la temporada mas reciente, a modo de backtest: se usan las cuotas de cierre
reales de esos partidos ya jugados como si fueran la cuota de mercado
disponible antes del partido (el mismo pipeline se reutilizara sin cambios
para partidos futuros reales en cuanto haya ingesta de
football-data.org/API-Football).

Reajuste "walk-forward" mes a mes dentro de la temporada de test: para
predecir los partidos de un mes, el modelo se reajusta con TODO lo anterior
a ese mes (incluyendo los meses ya jugados de la propia temporada de test).
Esto es importante: un ajuste unico para toda la temporada no ve que un
equipo se ha hundido a mitad de curso (ej. Wolves 2025-26: bien valorados
por su historico 2021-2025, pero con una temporada de descenso en la
realidad) y genera "valor" ilusorio contra equipos cuya forma cambio. Es
ademas el mismo patron que se usara en produccion: siempre se ajusta con
todo lo disponible hasta "hoy" antes de predecir.

Uso:
    python scripts/generate_predictions.py
    python scripts/generate_predictions.py --liga "ESP-La Liga 2" --temporadas 2526,2627
"""

import argparse
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings
from app.db.models import League, Match, MatchOdds, MatchStatus, Season
from app.db.session import SessionLocal
from app.probability.engine import fit_league_model, generate_predictions_for_match
from app.probability.outcomes import resolve_selection


def main() -> None:
    parser = argparse.ArgumentParser(description="Backtest walk-forward de las recomendaciones de valor.")
    parser.add_argument("--liga", action="append", help="liga a evaluar (por defecto, las validadas)")
    parser.add_argument("--temporadas", help="temporadas separadas por comas (por defecto, la ultima con partidos jugados)")
    args = parser.parse_args()

    settings = get_settings()
    db = SessionLocal()
    try:
        leagues = db.query(League).filter(League.code.in_(args.liga or settings.model_leagues)).all()

        for league in leagues:
            # Solo temporadas con partidos jugados: la temporada en curso creada
            # por ingest_fixtures.py solo con partidos SCHEDULED (antes de la
            # jornada 1) no sirve de test y dejaria sin backtest la anterior.
            seasons = sorted(
                {
                    m.season.name
                    for m in db.query(Match)
                    .filter_by(league_id=league.id, status=MatchStatus.HISTORICAL)
                    .all()
                }
            )
            if len(seasons) < 2:
                print(f"{league.code}: no hay suficientes temporadas para backtest, se omite.")
                continue

            test_seasons = args.temporadas.split(",") if args.temporadas else [seasons[-1]]
            test_matches_all = (
                db.query(Match)
                .filter(
                    Match.league_id == league.id,
                    Match.season.has(Season.name.in_(test_seasons)),
                    Match.status == MatchStatus.HISTORICAL,
                )
                .order_by(Match.date.asc())
                .all()
            )
            if not test_matches_all:
                print(f"{league.code}: temporadas {test_seasons} sin partidos, se omite.")
                continue

            print(f"\n{league.code}: backtest en {test_seasons}, reajustando cada mes con todo lo anterior")

            # Meses de la temporada de test, en orden: cada mes se predice con
            # un modelo reajustado con todo lo anterior a ese mes.
            months = sorted({(m.date.year, m.date.month) for m in test_matches_all})

            pnl: dict[str, float] = defaultdict(float)
            n_recommended: dict[str, int] = defaultdict(int)
            n_settled: dict[str, int] = defaultdict(int)
            n_predictions = 0
            last_model = None

            for year, month in months:
                month_matches = [
                    m for m in test_matches_all if (m.date.year, m.date.month) == (year, month)
                ]
                cutoff_date = min(m.date for m in month_matches)
                model = fit_league_model(db, league.id, before_date=cutoff_date)
                last_model = model

                for match in month_matches:
                    predictions = generate_predictions_for_match(
                        db, match, model, settings.ev_threshold
                    )
                    n_predictions += len(predictions)
                    for pred in predictions:
                        if not pred.is_recommended:
                            continue
                        n_recommended[pred.market] += 1
                        won = resolve_selection(match, pred.market, pred.selection)
                        if won is None:
                            continue
                        odds_row = (
                            db.query(MatchOdds)
                            .filter_by(
                                match_id=match.id,
                                market=pred.market,
                                selection=pred.selection,
                                bookmaker="Market Max",
                            )
                            .one_or_none()
                        )
                        if odds_row is None:
                            continue
                        n_settled[pred.market] += 1
                        pnl[pred.market] += (odds_row.odds - 1) if won else -1

            model = last_model
            print(
                f"  (ultimo reajuste) home_advantage={model.home_advantage:.3f} "
                f"rho={model.rho:.3f} equipos={len(model.team_ids)} "
                f"[{len(months)} reajustes mensuales]"
            )

            db.commit()

            print(f"  predicciones generadas: {n_predictions}")
            if not n_recommended:
                print("  ninguna seleccion supero el umbral de EV configurado.")
            for market, count in n_recommended.items():
                settled = n_settled[market]
                roi = (pnl[market] / settled * 100) if settled else 0.0
                print(
                    f"  {market}: {count} recomendadas ({settled} liquidadas), "
                    f"PnL(stake=1, mejor precio)={pnl[market]:+.2f}  ROI={roi:+.1f}%"
                )
    finally:
        db.close()


if __name__ == "__main__":
    main()
