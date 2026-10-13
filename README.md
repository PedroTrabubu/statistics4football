# statistics4football

**English** | [Español](README.es.md)

Football statistics for the **Premier League** and **LaLiga**: recent form, xG, Elo ratings, head-to-head, corners, cards and full season tables, plus match probabilities from a statistical model.

Every statistic is computed from real results. Match-level stats are **point-in-time**: they only use data from before the match, never the match itself or anything played later.

## Features

- **Season tables:** for every team, split into total, home and away. Includes W/D/L, points, goals for and against, over 1.5/2.5/3.5, both teams to score, clean sheets, failed to score, corners and cards.
- **Markets by team:** for each team, the hit rate and the full list of matches, green when the market landed and red when it didn't, split into home and away. Covers both teams to score (also with result), match and team goals, goals by half, half time/full time, result and clean sheets. Goals, corners, cards, booking points, shots, shots on target and fouls can each be checked for the whole match, the team, the opponent or each team, with over and under lines (plus corner handicap).
- **Referees:** the same view grouped by referee, for cards, booking points, corners and goals, in every league and season.
- **Match page:** form, head-to-head, rolling xG, Elo, corners and discipline for both teams, with a season summary for each.
- **Match probabilities:** 1X2, over/under 2.5 and both teams to score, from a Dixon-Coles model fitted on roughly the last three seasons. Each probability shows how many matches support it, so a newly promoted team with no history is flagged as a small sample instead of being shown with false confidence.
- **Market comparison (optional):** when pre-match odds are available, the model probability is compared against the bookmakers' implied probability (with the margin removed). A history tab shows every past pick with its real outcome, losses included.
- **Glossary:** plain-language explanations of every metric.

## How the probabilities work

1. **Dixon-Coles model:** a Poisson goals model with a correction for low scores, fitted by maximum likelihood with time decay and L2 regularisation.
2. **Monthly walk-forward refits:** to predict a given month, the model is refitted using only the data available before it.
3. **Small samples:** teams with few matches are shrunk towards a "weak team" prior. Promoted teams with no history start from that prior.
4. **Scoreline matrix:** 1X2, totals, both teams to score and Asian handicap probabilities are all derived from the predicted scoreline distribution.

This is an analysis tool, not a betting system. The out-of-sample backtest covers a single season, which is far too small a sample to prove an edge. Do not use it to bet real money.

## Tech stack

- **Backend:** Python, FastAPI, SQLAlchemy, Alembic, SQLite, NumPy/SciPy/pandas.
- **Frontend:** React, TypeScript, Vite, React Router.

## Data sources

| Data | Source |
|---|---|
| Historical and current season results, half-time score, referee (Premier League), corners, cards, shots, fouls and closing odds | [Football-Data.co.uk](https://www.football-data.co.uk/) via [soccerdata](https://github.com/probberechts/soccerdata) |
| xG per match | [Understat](https://understat.com/) via soccerdata |
| Elo ratings | [ClubElo](http://clubelo.com/) via soccerdata |
| Current season results and fixtures | [football-data.org](https://www.football-data.org/) (free tier) |
| Referees for LaLiga, LaLiga Hypermotion and Ligue 1, and LaLiga Hypermotion fixtures | [ESPN](https://www.espn.com/soccer/) (public API, no key) |
| Pre-match odds (optional) | [The Odds API](https://the-odds-api.com/) (free tier) |
| Pinnacle odds, from opening to closing (private use, not shown on the site) | Pinnacle's public API (no key) |
| Referees appointed before each match | APIs of [laliga.com](https://www.laliga.com/) (LaLiga and LaLiga Hypermotion), [premierleague.com](https://www.premierleague.com/) and [ligue1.com](https://ligue1.com/) |

Football-Data.co.uk also publishes the current season (updated a couple of times a week); football-data.org fills in the most recent results in between.

## Getting started

### Requirements

- Python 3.11 or later
- Node.js 20.19 or later
- Free API keys for [football-data.org](https://www.football-data.org/client/register) and, optionally, [The Odds API](https://the-odds-api.com/)

### 1. Configuration

Copy `.env.example` to `.env` in the project root and fill in your keys:

| Variable | Required | Purpose |
|---|---|---|
| `FOOTBALL_DATA_ORG_API_KEY` | Yes | Current season results and fixtures |
| `THE_ODDS_API_KEY` | No | Pre-match odds for upcoming matches |
| `ACTIVE_LEAGUES` | No | Leagues to load (default: `ENG-Premier League,ESP-La Liga,ESP-La Liga 2,FRA-Ligue 1`) |
| `VALIDATED_LEAGUES` | No | Leagues where Picks and Recommendations are offered, once backtested (default: `ENG-Premier League,ESP-La Liga,ESP-La Liga 2`; see [docs/LIGAS_NUEVAS.md](docs/LIGAS_NUEVAS.md)) |
| `EV_THRESHOLD` | No | Minimum expected value to flag a value pick (default: `0.05`) |

`.env` is in `.gitignore` and is never committed.

### 2. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1        # Windows (PowerShell)
# source .venv/bin/activate       # macOS / Linux
pip install -r requirements.txt
alembic upgrade head
python -m uvicorn app.main:app --reload
```

The API runs at http://127.0.0.1:8000. Interactive docs are at http://127.0.0.1:8000/docs.

### 3. Load the data

From `backend/`, with the virtual environment active:

```bash
python scripts/ingest_historical.py    # past seasons: results, corners, cards, odds
python scripts/ingest_xg.py            # xG from Understat
python scripts/ingest_elo.py           # Elo ratings from ClubElo
python scripts/ingest_matchdays.py     # matchdays of past seasons (run once)
python scripts/ingest_espn.py          # referees of past seasons (run once, ~1 hour)
python scripts/ingest_fixtures.py      # current season: results, stats, upcoming fixtures and their odds
python scripts/refresh_odds.py         # optional: fresher odds in validated leagues (uses credits)
python scripts/refresh_predictions.py  # probabilities for upcoming matches
```

`python scripts/scheduler.py --loop` runs `ingest_fixtures.py` by itself before and after each match (results, stats and appointed referees) and captures Pinnacle's odds; on Windows it is registered in Task Scheduler (see [docs/PROGRAMADOR.md](docs/PROGRAMADOR.md), in Spanish). `refresh_odds.py` and `refresh_predictions.py` are still run by hand. football-data.org does not include LaLiga Hypermotion for free: its fixtures come from ESPN, with provisional dates until kick-off times are set, and the times and odds of the next matchday come from Football-Data.co.uk's `fixtures.csv`, refreshed midweek and before the weekend. `python scripts/generate_predictions.py` runs the backtest on the last completed season. `python scripts/refresh_picks.py` builds the accumulators for the next matchday and `python scripts/backtest_picks.py` runs their pre-registered backtest (see [docs/PICKS_PROTOCOLO.md](docs/PICKS_PROTOCOLO.md)). `python scripts/backtest_pattern_model.py` runs the pre-registered backtest of the high-probability model (see [docs/MODELO_PATRONES.md](docs/MODELO_PATRONES.md)).

`python scripts/pinnacle_capture.py --loop` stores Pinnacle's odds from opening to closing, and `python scripts/report_picks_vs_pinnacle.py` measures the picks against them. Setup, data and settlement rules in [docs/PINNACLE.md](docs/PINNACLE.md); protocol and results in [docs/PINNACLE_PROTOCOLO.md](docs/PINNACLE_PROTOCOLO.md) (both in Spanish).

### 4. Frontend

In another terminal, with the backend running:

```bash
cd frontend
npm install
copy .env.example .env      # Windows; use cp on macOS / Linux
npm run dev
```

Open http://localhost:5173.

To publish it, set the domain in `VITE_SITE_URL` (see `frontend/.env.example`): the build adds `og:url` and makes the share image URL absolute. Without a domain, no `og:url` is emitted.

### Tests

```bash
cd backend
python -m pytest
```

## API

| Endpoint | Description |
|---|---|
| `GET /leagues` | Available leagues |
| `GET /leagues/{id}/seasons` | Seasons with played matches |
| `GET /leagues/{id}/season-stats?season=` | Season table for every team |
| `GET /leagues/{id}/results?season=` | Every played match of a season, with half-time score, referee and team stats |
| `GET /teams?league_id=` | Teams |
| `GET /teams/{id}/season-stats?season=` | Season stats for one team |
| `GET /matches` | Matches, filterable by league, season, status, team and dates |
| `GET /matches/{id}` | One match |
| `GET /matches/{id}/stats` | Point-in-time form, head-to-head, xG and Elo |
| `GET /matches/{id}/referee-stats?referee_scope=` | Previous matches of the appointed referee and of both teams (cards and booking points comparison) |
| `GET /matches/{id}/predictions` | Model probabilities for a match |
| `GET /picks?league=` | Accumulators for the next matchday: four odds tiers plus a likely same-match combo per match |
| `GET /picks/history?league=&kind=` | Past accumulators with their real outcome and the probability the model promised |
| `GET /recommendations?strategy=` | Upcoming picks (requires odds): `valor` (EV, default) or `alta_probabilidad` (high-probability model) |
| `GET /recommendations/history?strategy=` | Past picks with their real outcome, what the market expected and ROI where real odds exist |

## Project structure

```
backend/
  app/
    api/routers/   HTTP endpoints
    db/models/     database tables
    schemas/       API request and response models
    ingestion/     data loading from each source
    stats/         form, head-to-head, xG, Elo, discipline, season tables
    probability/   Dixon-Coles model, market maths, expected value
  alembic/         database migrations
  scripts/         data loading and prediction jobs
  tests/
frontend/
  src/
    pages/         matches, match detail, season stats, recommendations, glossary
    components/
docs/
  DEVLOG.md        phase-by-phase development log (Spanish)
```

## Development log

[docs/DEVLOG.md](docs/DEVLOG.md) (in Spanish) records how the project was built phase by phase: the real bugs found along the way and the design decisions they led to.
