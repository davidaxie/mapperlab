#!/usr/bin/env python3
"""
run_backtest.py — MapperLab backtesting orchestrator.

Downloads ETF price history via yfinance, replays historical policy events
to reconstruct score timeseries, generates composite signals, executes
hypothetical trades, and produces a performance report.

Usage:
  python backtest/run_backtest.py \\
    --start 2020-01-01 \\
    --end 2024-12-31 \\
    --capital 1000000 \\
    --benchmark SPY \\
    --output-dir backtest/output

Outputs:
  backtest/output/report.html   — Interactive HTML report with Plotly charts
  backtest/output/metrics.json  — All performance metrics as JSON
  backtest/output/trades.csv    — Trade log
  backtest/output/summary.md    — Markdown summary (used in GitHub Actions step summary)
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import date
from pathlib import Path

# Ensure backtest/ package is importable when called as:
#   python backtest/run_backtest.py
sys.path.insert(0, str(Path(__file__).parent))

import pandas as pd
import pandas_market_calendars as mcal
from tqdm import tqdm

from score_replayer import reconstruct_scores
from signal_engine import compute_composite_signal, should_exit
from performance_metrics import compute as compute_metrics
from report_generator import generate as generate_report

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = Path(__file__).parent.parent  # /tmp/mapperlab

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("run_backtest")


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _get_score_on_date(timeseries: list, date_str: str) -> float:
    """Get score for a node on a specific date. Returns 50.0 if date not found (neutral).

    timeseries is a list of {date, score} dicts sorted ascending by date.
    Uses the most-recent available score on or before date_str.
    """
    if not timeseries:
        return 50.0

    # Binary-search for the rightmost entry whose date <= date_str
    lo, hi = 0, len(timeseries) - 1
    result_score = None

    while lo <= hi:
        mid = (lo + hi) // 2
        entry_date = timeseries[mid]["date"]
        if entry_date <= date_str:
            result_score = timeseries[mid]["score"]
            lo = mid + 1
        else:
            hi = mid - 1

    return result_score if result_score is not None else 50.0


def _get_score_history(timeseries: list, as_of_date: str, n: int = 20) -> list:
    """Get last N scores up to (and including) as_of_date. Returns oldest-first list."""
    if not timeseries:
        return []

    # Find the index of the last entry whose date <= as_of_date
    lo, hi = 0, len(timeseries) - 1
    last_idx = -1

    while lo <= hi:
        mid = (lo + hi) // 2
        if timeseries[mid]["date"] <= as_of_date:
            last_idx = mid
            lo = mid + 1
        else:
            hi = mid - 1

    if last_idx < 0:
        return []

    start_idx = max(0, last_idx - n + 1)
    return [timeseries[i]["score"] for i in range(start_idx, last_idx + 1)]


def _get_etf_price(prices_df: pd.DataFrame, etf_map_entry: dict, date_str: str) -> float | None:
    """Get ETF closing price for a date, with fallback to prior close.

    Tries primary ticker first; if data is NaN/missing (pre-inception), tries fallback.
    Falls back to the most-recent prior trading-day close if the exact date is missing.
    """
    target_ts = pd.Timestamp(date_str)

    def _price_for_ticker(ticker: str) -> float | None:
        if ticker not in prices_df.columns:
            return None

        series = prices_df[ticker]

        # Exact date
        if target_ts in series.index:
            val = series.loc[target_ts]
            if pd.notna(val) and val > 0:
                return float(val)

        # Fall back to most-recent prior close
        prior = series.loc[:target_ts].dropna()
        if not prior.empty and prior.iloc[-1] > 0:
            return float(prior.iloc[-1])

        return None

    primary = etf_map_entry.get("ticker")
    fallback = etf_map_entry.get("fallback")

    price = _price_for_ticker(primary) if primary else None
    if price is not None:
        return price

    if fallback and fallback != primary:
        price = _price_for_ticker(fallback)

    return price


def _estimate_macro_state(score_timeseries: dict, date_str: str) -> dict:
    """
    Estimate macro state from score timeseries proxies.
    Since we don't have live FRED data in backtest, use score proxies:

    Returns dict with vix, hy_oas, t10y2y, stlfsi4 estimates.
    """
    rates_score = _get_score_on_date(score_timeseries.get("rates", []), date_str)
    credit_score = _get_score_on_date(score_timeseries.get("credit", []), date_str)

    # When rates score is very low (headwind), VIX is likely high
    # Simple linear mapping: rates 0->100 maps to vix 50->10
    estimated_vix = max(10, 50 - rates_score * 0.4)

    # When credit score is low, HY OAS is high
    estimated_hy_oas = max(200, 800 - credit_score * 6)

    # T10Y2Y: low rates score → inverted curve
    estimated_t10y2y = (rates_score - 50) / 25  # -2 to +2 range

    # STLFSI4: financial stress — proxy from financials score
    fin_score = _get_score_on_date(score_timeseries.get("financials", []), date_str)
    estimated_stlfsi4 = max(0, (50 - fin_score) / 20)  # 0 to ~2.5

    return {
        "vix": estimated_vix,
        "hy_oas": estimated_hy_oas,
        "t10y2y": estimated_t10y2y,
        "stlfsi4": estimated_stlfsi4,
    }


def _compute_portfolio_value(
    cash: float,
    positions: dict,
    prices_df: pd.DataFrame,
    date_str: str,
) -> float:
    """Compute total portfolio value: cash + sum of position market values."""
    total = cash
    for sector_id, pos in positions.items():
        entry_price = pos.get("entry_price")
        size = pos.get("size", 0.0)
        direction = pos.get("direction", "long")

        if not entry_price or entry_price <= 0 or size <= 0:
            total += size  # treat as cash if no price
            continue

        # We need current price for mark-to-market
        # positions don't store etf_map_entry directly; caller must resolve
        # We use a placeholder: return entry price (i.e., no MTM) — callers
        # that need MTM will override this via the etf_map lookup below.
        total += size  # default: no MTM — use entry value

    return total


def _compute_portfolio_value_mtm(
    cash: float,
    positions: dict,
    prices_df: pd.DataFrame,
    etf_map: dict,
    date_str: str,
) -> float:
    """Mark-to-market portfolio value using current prices."""
    total = cash
    for sector_id, pos in positions.items():
        entry_price = pos.get("entry_price")
        size = pos.get("size", 0.0)
        direction = pos.get("direction", "long")

        if not entry_price or entry_price <= 0 or size <= 0:
            total += size
            continue

        etf_entry = etf_map.get(sector_id)
        if etf_entry is None:
            total += size
            continue

        current_price = _get_etf_price(prices_df, etf_entry, date_str)
        if current_price is None or current_price <= 0:
            total += size
            continue

        # Number of units held (virtual)
        units = size / entry_price
        ret = (current_price / entry_price - 1) * (1 if direction == "long" else -1)
        mtm_value = size * (1 + ret)
        total += mtm_value

    return total


# ---------------------------------------------------------------------------
# Download ETF prices
# ---------------------------------------------------------------------------

def _download_prices(
    etf_map: dict,
    benchmark: str,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """Download all ETF prices via yfinance. Returns a flat DataFrame with tickers as columns."""
    import yfinance as yf

    tickers: set[str] = set()
    for node_data in etf_map.values():
        if node_data.get("ticker"):
            tickers.add(node_data["ticker"])
        if node_data.get("fallback"):
            tickers.add(node_data["fallback"])
    tickers.add(benchmark)

    ticker_list = sorted(tickers)
    log.info("Downloading prices for %d tickers (%s … %s)", len(ticker_list), start_date, end_date)

    try:
        raw = yf.download(
            ticker_list,
            start=start_date,
            end=end_date,
            auto_adjust=True,
            progress=False,
        )
        # yfinance returns MultiIndex columns when >1 ticker: (field, ticker)
        if isinstance(raw.columns, pd.MultiIndex):
            prices = raw["Close"].copy()
        else:
            # Single ticker — raw is already a flat OHLCV DataFrame
            prices = raw[["Close"]].copy()
            prices.columns = ticker_list  # rename to the ticker name

        log.info("Downloaded prices: shape=%s, columns=%d", prices.shape, len(prices.columns))
        return prices

    except Exception as exc:
        log.error("yfinance download failed: %s", exc)
        return pd.DataFrame()


# ---------------------------------------------------------------------------
# Build sector → industry mapping from taxonomy
# ---------------------------------------------------------------------------

def _build_sector_to_industries(taxonomy: dict) -> dict[str, list[str]]:
    """Return {sector_id: [industry_id, ...]} from taxonomy.json."""
    mapping: dict[str, list[str]] = {}
    for sector in taxonomy.get("sectors", []):
        sector_id = sector["id"]
        industries = [ind["id"] for ind in sector.get("industries", [])]
        mapping[sector_id] = industries
    return mapping


# ---------------------------------------------------------------------------
# Main orchestration
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="MapperLab backtesting orchestrator",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--start",
        default="2020-01-01",
        help="Backtest start date (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--end",
        default=date.today().isoformat(),
        help="Backtest end date (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--capital",
        type=float,
        default=1_000_000,
        help="Initial capital in USD",
    )
    parser.add_argument(
        "--benchmark",
        default="SPY",
        help="Benchmark ticker symbol",
    )
    parser.add_argument(
        "--output-dir",
        default="backtest/output",
        help="Directory for output files",
    )
    args = parser.parse_args()

    start_date: str = args.start
    end_date: str = args.end
    initial_capital: float = args.capital
    benchmark: str = args.benchmark
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    log.info("=== MapperLab Backtest ===")
    log.info("Period : %s → %s", start_date, end_date)
    log.info("Capital: $%,.0f", initial_capital)
    log.info("Bench  : %s", benchmark)
    log.info("Output : %s", output_dir)

    # ------------------------------------------------------------------
    # 2. Load config files
    # ------------------------------------------------------------------
    log.info("Loading config files…")

    with open(ROOT / "config" / "impact_matrix.json") as f:
        impact_matrix = json.load(f)

    with open(ROOT / "backtest" / "historical_events.json") as f:
        raw_events = json.load(f)
    historical_events = raw_events["events"]

    with open(ROOT / "backtest" / "etf_map.json") as f:
        etf_map: dict = json.load(f)

    with open(ROOT / "config" / "taxonomy.json") as f:
        taxonomy = json.load(f)

    # ------------------------------------------------------------------
    # 3. Reconstruct score timeseries
    # ------------------------------------------------------------------
    log.info("Reconstructing score timeseries…")
    score_timeseries: dict = reconstruct_scores(
        start_date=start_date,
        end_date=end_date,
        impact_matrix=impact_matrix,
        historical_events=historical_events,
        show_progress=True,
    )
    log.info("Score timeseries: %d nodes", len(score_timeseries))

    # ------------------------------------------------------------------
    # 4. Download ETF prices
    # ------------------------------------------------------------------
    prices = _download_prices(etf_map, benchmark, start_date, end_date)

    if prices.empty:
        log.error("No price data downloaded — aborting.")
        sys.exit(1)

    # ------------------------------------------------------------------
    # 5. Build sector → industries mapping
    # ------------------------------------------------------------------
    sector_to_industries = _build_sector_to_industries(taxonomy)

    # Determine which sectors have valid ETF data
    valid_sectors: dict[str, dict] = {}
    for sector_id, etf_entry in etf_map.items():
        price = _get_etf_price(prices, etf_entry, start_date)
        if price is not None:
            valid_sectors[sector_id] = etf_entry

    log.info(
        "Valid sectors (have ETF price data): %d / %d",
        len(valid_sectors),
        len(etf_map),
    )

    # ------------------------------------------------------------------
    # 6. Get NYSE trading days
    # ------------------------------------------------------------------
    nyse = mcal.get_calendar("NYSE")
    schedule = nyse.schedule(start_date=start_date, end_date=end_date)
    trading_days = list(schedule.index)  # pandas Timestamps

    log.info("Trading days in range: %d", len(trading_days))

    # ------------------------------------------------------------------
    # 7. Signal generation + trade simulation loop
    # ------------------------------------------------------------------
    portfolio_cash = initial_capital
    portfolio_positions: dict[str, dict] = {}
    trades: list[dict] = []
    portfolio_values: dict[str, float] = {}

    log.info("Running signal generation and trade simulation…")

    for trade_date in tqdm(trading_days, desc="Simulating"):
        date_str = trade_date.strftime("%Y-%m-%d")

        # Estimate macro state from score proxies
        macro_state = _estimate_macro_state(score_timeseries, date_str)

        for sector_id, etf_entry in valid_sectors.items():
            node_ts = score_timeseries.get(sector_id, [])
            current_score = _get_score_on_date(node_ts, date_str)
            score_history = _get_score_history(node_ts, date_str, n=20)

            industry_ids = sector_to_industries.get(sector_id, [])
            industry_scores = [
                _get_score_on_date(score_timeseries.get(ind_id, []), date_str)
                for ind_id in industry_ids
                if ind_id in score_timeseries
            ]

            signal = compute_composite_signal(
                current_score,
                score_history,
                industry_scores,
                macro_state,
            )

            # ---- EXIT existing position ----
            if sector_id in portfolio_positions:
                pos = portfolio_positions[sector_id]
                vel_7d = (
                    (score_history[-1] - score_history[-8])
                    if len(score_history) >= 8
                    else 0.0
                )
                current_composite = signal["composite"]

                if should_exit(
                    current_score,
                    current_composite,
                    pos["direction"],
                    pos["entry_score"],
                    vel_7d,
                ):
                    exit_price = _get_etf_price(prices, etf_entry, date_str)
                    entry_price = pos["entry_price"]

                    if exit_price and entry_price:
                        raw_ret = (exit_price / entry_price - 1) * (
                            1 if pos["direction"] == "long" else -1
                        )
                        # 5 bps each side (entry + exit)
                        ret = raw_ret - 0.0005 * 2

                        trades.append({
                            "sector": sector_id,
                            "direction": pos["direction"],
                            "entry_date": pos["entry_date"],
                            "exit_date": date_str,
                            "entry_score": pos["entry_score"],
                            "exit_score": current_score,
                            "entry_price": entry_price,
                            "exit_price": exit_price,
                            "return_pct": ret,
                            "holding_days": (
                                trade_date - pd.Timestamp(pos["entry_date"])
                            ).days,
                            "regime": signal["regime"],
                        })

                        # Return proceeds to cash
                        portfolio_cash += pos["size"] * (1 + ret)

                    del portfolio_positions[sector_id]

            # ---- ENTRY (only if not already in a position) ----
            elif signal["direction"] != "flat" and signal["position_pct"] > 0:
                entry_price = _get_etf_price(prices, etf_entry, date_str)
                if entry_price:
                    position_size = initial_capital * signal["position_pct"]
                    if position_size <= portfolio_cash:
                        portfolio_cash -= position_size
                        portfolio_positions[sector_id] = {
                            "direction": signal["direction"],
                            "size": position_size,
                            "entry_price": entry_price,
                            "entry_score": current_score,
                            "entry_date": date_str,
                            "entry_composite": signal["composite"],
                        }

        # Mark-to-market portfolio value for this day
        portfolio_values[date_str] = _compute_portfolio_value_mtm(
            portfolio_cash,
            portfolio_positions,
            prices,
            etf_map,
            date_str,
        )

    # Close any remaining open positions at last available price
    last_date_str = trading_days[-1].strftime("%Y-%m-%d") if trading_days else end_date
    for sector_id, pos in list(portfolio_positions.items()):
        etf_entry = valid_sectors.get(sector_id)
        if etf_entry is None:
            continue
        exit_price = _get_etf_price(prices, etf_entry, last_date_str)
        entry_price = pos["entry_price"]
        if exit_price and entry_price:
            raw_ret = (exit_price / entry_price - 1) * (
                1 if pos["direction"] == "long" else -1
            )
            ret = raw_ret - 0.0005 * 2
            trades.append({
                "sector": sector_id,
                "direction": pos["direction"],
                "entry_date": pos["entry_date"],
                "exit_date": last_date_str,
                "entry_score": pos["entry_score"],
                "exit_score": _get_score_on_date(
                    score_timeseries.get(sector_id, []), last_date_str
                ),
                "entry_price": entry_price,
                "exit_price": exit_price,
                "return_pct": ret,
                "holding_days": (
                    pd.Timestamp(last_date_str) - pd.Timestamp(pos["entry_date"])
                ).days,
                "regime": "NEUTRAL",
            })
            portfolio_cash += pos["size"] * (1 + ret)
        del portfolio_positions[sector_id]

    log.info("Total trades executed: %d", len(trades))

    # ------------------------------------------------------------------
    # 8. Compute portfolio and benchmark returns
    # ------------------------------------------------------------------
    if not portfolio_values:
        log.error("No portfolio values computed — aborting.")
        sys.exit(1)

    port_series = pd.Series(portfolio_values).sort_index()
    port_series.index = pd.DatetimeIndex(port_series.index)
    port_returns = port_series.pct_change().dropna()

    # Benchmark returns
    bench_prices: pd.Series | None = None
    if benchmark in prices.columns:
        bench_prices = prices[benchmark]
    else:
        # Try case-insensitive match
        for col in prices.columns:
            if col.upper() == benchmark.upper():
                bench_prices = prices[col]
                break

    if bench_prices is not None:
        bench_returns = bench_prices.pct_change().dropna()
        # Align to trading days in our range
        bench_returns = bench_returns.loc[
            (bench_returns.index >= pd.Timestamp(start_date))
            & (bench_returns.index <= pd.Timestamp(end_date))
        ]
    else:
        log.warning("Benchmark %s not in prices — using zero returns.", benchmark)
        bench_returns = pd.Series(0.0, index=port_returns.index, dtype=float)

    log.info(
        "Portfolio returns: %d days, total=%.2f%%",
        len(port_returns),
        (port_series.iloc[-1] / port_series.iloc[0] - 1) * 100 if len(port_series) >= 2 else 0,
    )

    # ------------------------------------------------------------------
    # 9. Compute performance metrics
    # ------------------------------------------------------------------
    log.info("Computing performance metrics…")

    # Build sector_results (per-sector returns are not tracked in this implementation;
    # pass empty per-sector series so compute() still works)
    sector_results: dict = {}
    for sector_id in valid_sectors:
        sector_trades = [t for t in trades if t["sector"] == sector_id]
        sector_results[sector_id] = {
            "trades": sector_trades,
            "returns": pd.Series(dtype=float),
        }

    metrics = compute_metrics(
        portfolio_returns=port_returns,
        benchmark_returns=bench_returns,
        trades=trades,
        sector_results=sector_results,
    )

    log.info(
        "Metrics: sharpe=%.2f  total_return=%.1f%%  max_dd=%.1f%%  trades=%d",
        metrics.get("sharpe", 0),
        metrics.get("total_return", 0) * 100,
        metrics.get("max_drawdown", 0) * 100,
        metrics.get("total_trades", 0),
    )

    # ------------------------------------------------------------------
    # 10. Write trades.csv
    # ------------------------------------------------------------------
    trades_df = pd.DataFrame(trades)
    trades_path = output_dir / "trades.csv"
    trades_df.to_csv(trades_path, index=False)
    log.info("Wrote %s (%d rows)", trades_path, len(trades_df))

    # ------------------------------------------------------------------
    # 11. Generate report
    # ------------------------------------------------------------------
    log.info("Generating report…")
    generate_report(
        metrics=metrics,
        portfolio_returns=port_returns,
        benchmark_returns=bench_returns,
        score_timeseries=score_timeseries,
        trades=trades,
        output_dir=output_dir,
        start_date=start_date,
        end_date=end_date,
        initial_capital=initial_capital,
    )

    log.info("=== Backtest complete ===")
    log.info("Output directory: %s", output_dir.resolve())
    for fname in ["report.html", "metrics.json", "trades.csv", "summary.md"]:
        fpath = output_dir / fname
        if fpath.exists():
            log.info("  %s  (%d bytes)", fname, fpath.stat().st_size)


if __name__ == "__main__":
    main()
