# MapperLab

A heatmap showing which sectors have policy and macro tailwinds or headwinds, built from central bank, regulator and market news.

## What it does

MapperLab reads the news flow a macro trader watches and turns it into one number per sector and industry. Each score runs from 0 to 100: 50 is neutral, 56 and above is a tailwind, and 44 and below is a headwind. The app shows all 63 nodes (15 sectors and their industries) as a heatmap. Click an industry to see the events that moved it, a sparkline, a timeline and the underlying sources.

A separate Python backtester asks whether those scores would have been worth trading. It replays historical policy events into score histories and trades sector ETFs against them.

## How it works

**Ingestion** (`services/dataIngestion.js`)
- Pulls 59 RSS feeds in parallel. Sources include central banks (Fed, ECB, BoE, BoJ, BIS, RBA), the IMF, the Federal Register, the SEC, financial news, crypto news, press-release wires and 17 finance subreddits.
- With API keys set, it also pulls 23 FRED series and 4 EIA energy series.
- Items older than 48 hours are dropped, and duplicates are removed by source and title.

**Scoring** (`services/aiAnalysis.js`)
- Events go to Claude Haiku in batches of 8. The model returns a delta from -15 to +15 for each affected node, plus a confidence level.
- Without an API key, or when the model returns nothing for an event, a deterministic fallback runs. It matches phrases to 42 named policy events in `config/impact_matrix.json` (for example, a 25bp Fed hike, an OPEC supply cut or semiconductor export controls). Each event carries hand-set deltas per sector, and generic tailwind and headwind keywords cover the rest.

**State** (`services/dataStore.js`, `services/updateService.js`)
- Deltas are scaled by confidence (high 1.5x, medium 1.0x, low 0.6x).
- Correlation cascades in `config/correlation_map.json` propagate second-order effects at half strength. For example, a big energy-commodities tailwind pushes transportation, chemicals and retail down.
- Every cycle, each score decays 1.5% toward 50, so stale news fades.
- Each node tracks an EMA of its score velocity, and each sector tracks breadth (the share of its industries in tailwind or headwind).

**Backtester** (`backtest/`)
- `score_replayer.py` replays 65 dated policy events (March 2020 to April 2026) through the impact matrix on the NYSE calendar to rebuild score histories.
- `signal_engine.py` combines four sub-signals into one composite: level (0.35), 7/14-day momentum (0.30), macro regime (0.20) and industry confluence (0.15). The regime uses VIX, HY OAS, STLFSI4 and the 2s10s curve; in the backtest these are estimated from score proxies. Position size scales with the composite and the regime, capped at 20% per sector, and the engine has explicit exit rules.
- `run_backtest.py` maps each node to a tradable ETF in `backtest/etf_map.json` (SPDR sector funds plus industry and asset ETFs such as SOXX, KBE, TLT and GLD), trades it using yfinance prices, and benchmarks against SPY.
- `performance_metrics.py` computes Sharpe, Sortino, Calmar, drawdowns, hit rate by sector and information ratio in plain numpy.
- `report_generator.py` writes an HTML report with seven Plotly charts.

**Automation** (`.github/workflows/`)
- `backtest.yml` runs the backtest weekly, with manual dispatch inputs for dates, capital and benchmark.
- `daily-snapshot.yml` is a weekday after-close job that snapshots scores and signals from a running server into `data/*.jsonl` (via `backtest/daily_snapshot.py`). The committed `data/` files hold one snapshot, from 15 April 2026.

## Tech stack

- **Server:** Node.js (ES modules), Express, node-cron, rss-parser, axios, Anthropic SDK
- **Frontend:** vanilla JavaScript ES modules and CSS, with no framework and no build step
- **Backtest:** Python 3.11, pandas, numpy, scipy, yfinance, pandas-market-calendars, Plotly, Jinja2
- **CI:** GitHub Actions

## Running locally

```bash
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY; FRED_API_KEY and EIA_API_KEY are optional
npm start                 # or: npm run dev
```

The server listens on `PORT` (3001 in `.env.example`, 3000 if unset). The landing page is at `/` and the heatmap app is at `/app.html`. The first scoring pass runs on startup. After that the server runs an update every 2 hours (a second cron every 4 hours lands on the same hours), the app re-reads the scores every 2 minutes, and `POST /api/update` (the Update button in the app) triggers one by hand.

Main endpoints: `GET /api/heatmap`, `/api/events`, `/api/score/:id`, `/api/sources/:id`, `/api/timeline/:id`, `/api/taxonomy`, `/api/status`.

Backtest:

```bash
pip install -r backtest/requirements.txt
python backtest/run_backtest.py --start 2020-01-01 --capital 1000000 --benchmark SPY --output-dir backtest/output
```

Output: `report.html`, `metrics.json`, `trades.csv` and `summary.md` in the output directory.

## Project layout

- `server.js`: Express server, API routes and the update schedule
- `services/`: ingestion, scoring, score state and the update pipeline
- `config/`: feed list (`sources.json`), taxonomy, impact matrix and correlation cascades
- `public/`: landing page (`index.html`, `landing.css`, `js/landing.js`) and the heatmap app (`app.html`, `styles.css`, `js/`)
- `backtest/`: the Python backtester and the daily snapshot script
- `data/`: committed score and signal snapshots
- `docs/superpowers/plans/`: the implementation plan for the April 2026 frontend redesign

## Status

This is a working prototype. Scores live in memory, so a restart rebuilds them from the baseline. There are no automated tests. The backtest's macro regime is estimated from score proxies rather than historical FRED data, so treat its results as research, not a track record. Nothing here is investment advice.
