"""Motor de probabilidades/EV.

1. market.py: vig-stripping de cuotas (Shin / multiplicativo).
2. poisson_model.py: Dixon-Coles ajustado por maxima verosimilitud sobre el
   historico de goles.
3. score_markets.py: deriva 1X2 / over-under / BTTS / hancicap asiatico de la
   matriz de marcadores del modelo.
4. ev.py: EV = prob_modelo x cuota - 1, con nivel de confianza/riesgo
   siempre adjunto (nunca solo el numero de EV).
5. engine.py: orquesta lo anterior contra la BD real (ajusta el modelo por
   liga, genera ModelPrediction para un partido).
"""
