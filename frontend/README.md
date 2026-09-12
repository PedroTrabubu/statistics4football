# Stadistics4bet — frontend

React + TypeScript (Vite). Consume la API de `../backend`.

## Setup

```powershell
cd frontend
npm install
copy .env.example .env
npm run dev
```

Abre http://localhost:5173. Necesita el backend corriendo en http://127.0.0.1:8000
(ver `../backend/README.md`).

## Paginas

- `/` — listado de partidos (filtros por liga/estado).
- `/matches/:id` — ficha de partido: forma reciente, H2H, xG, Elo, y las
  probabilidades/EV del motor (siempre con confianza/riesgo, nunca el EV solo).
- `/recommendations` — recomendaciones filtrables por liga/mercado/riesgo/EV minimo.
