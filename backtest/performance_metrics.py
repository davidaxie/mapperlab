#!/usr/bin/env python3
"""
performance_metrics.py — Computes hedge fund-grade performance metrics for backtest results.

Uses empyrical (Quantopian library) for standard Sharpe/Sortino/Calmar calculations.

Main function:
    compute(portfolio_returns, benchmark_returns, trades, sector_results) -> dict

Input types:
    portfolio_returns: pd.Series with DatetimeIndex, daily returns (e.g., 0.01 = 1%)
    benchmark_returns: pd.Series with DatetimeIndex, daily benchmark returns
    trades: list of dicts with keys: {date, sector, direction, entry_price, exit_price,
                                       entry_score, exit_score, return_pct, holding_days}
    sector_results: dict of sector_id -> {trades: list, returns: pd.Series}
"""

import numpy as np
import pandas as pd
import empyrical as ep
from scipy import stats


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _clean_returns(returns: pd.Series) -> pd.Series:
    """Drop NaN/Inf values and return a clean series."""
    if returns is None or len(returns) == 0:
        return pd.Series(dtype=float)
    cleaned = returns.replace([np.inf, -np.inf], np.nan).dropna()
    return cleaned


def _total_return(returns: pd.Series) -> float:
    """Compound total return from a daily return series."""
    if len(returns) == 0:
        return 0.0
    return float((1 + returns).prod() - 1)


def _annualized_return(returns: pd.Series, periods_per_year: int = 252) -> float:
    """Geometric annualized return."""
    if len(returns) == 0:
        return 0.0
    n = len(returns)
    total = (1 + returns).prod()
    if total <= 0:
        return -1.0
    return float(total ** (periods_per_year / n) - 1)


def _find_drawdown_periods(returns: pd.Series, top_n: int = 10) -> list:
    """Find top N drawdown periods by depth.

    Returns a list of dicts: {start, end, depth, recovery_days}
    """
    if len(returns) == 0:
        return []

    equity = (1 + returns).cumprod()
    peak = equity.cummax()
    drawdown = (equity - peak) / peak

    # Identify contiguous drawdown periods (drawdown < 0)
    in_drawdown = drawdown < -1e-10
    periods = []
    i = 0
    idx = drawdown.index

    while i < len(idx):
        if in_drawdown.iloc[i]:
            # Start of a drawdown period
            start = idx[i]
            # Find peak date just before this period
            peak_val = peak.iloc[i]
            depth = float(drawdown.iloc[i])
            j = i
            while j < len(idx) and in_drawdown.iloc[j]:
                if drawdown.iloc[j] < depth:
                    depth = float(drawdown.iloc[j])
                j += 1
            end_dd = idx[j - 1]  # last day in drawdown

            # Find recovery: first day after end_dd where equity >= peak_val
            recovery_days = -1
            k = j
            while k < len(idx):
                if equity.iloc[k] >= peak_val - 1e-10:
                    recovery_days = int((idx[k] - end_dd).days)
                    break
                k += 1

            periods.append({
                "start": str(start.date()),
                "end": str(end_dd.date()),
                "depth": depth,
                "recovery_days": recovery_days,
            })
            i = j
        else:
            i += 1

    # Sort by depth (most negative first) and take top N
    periods.sort(key=lambda x: x["depth"])
    return periods[:top_n]


def _max_drawdown_dates(returns: pd.Series):
    """Return (start_date_str, end_date_str) of the maximum drawdown period."""
    if len(returns) == 0:
        return "N/A", "N/A"

    equity = (1 + returns).cumprod()
    peak = equity.cummax()
    drawdown = (equity - peak) / peak

    end_idx = drawdown.idxmin()
    # Peak date is the most recent peak before end_idx
    before_end = equity[:end_idx]
    start_idx = before_end.idxmax()

    return str(start_idx.date()), str(end_idx.date())


def _max_drawdown_recovery_days(returns: pd.Series) -> int:
    """Days to recover from max drawdown peak-to-trough. -1 if not recovered."""
    if len(returns) == 0:
        return -1

    equity = (1 + returns).cumprod()
    peak = equity.cummax()
    drawdown = (equity - peak) / peak
    end_idx = drawdown.idxmin()

    before_end = equity[:end_idx]
    start_idx = before_end.idxmax()
    peak_val = float(equity[start_idx])

    # Look for recovery after trough
    after_trough = equity[end_idx:]
    recovered = after_trough[after_trough >= peak_val - 1e-10]
    if len(recovered) == 0:
        return -1
    return int((recovered.index[0] - end_idx).days)


def _avg_drawdown(returns: pd.Series) -> float:
    """Average of all drawdown period depths."""
    if len(returns) == 0:
        return 0.0

    equity = (1 + returns).cumprod()
    peak = equity.cummax()
    drawdown = (equity - peak) / peak

    # Average only the negative values
    neg = drawdown[drawdown < 0]
    if len(neg) == 0:
        return 0.0
    return float(neg.mean())


def _monthly_returns_dict(returns: pd.Series) -> dict:
    """Convert daily returns to monthly returns nested dict {year: {month: return}}."""
    if len(returns) == 0:
        return {}

    monthly = (1 + returns).resample("ME").prod() - 1
    result = {}
    for dt, val in monthly.items():
        year = str(dt.year)
        month = f"{dt.month:02d}"
        if year not in result:
            result[year] = {}
        result[year][month] = round(float(val), 6)
    return result


def _rolling_sharpe(returns: pd.Series, window: int = 252) -> list:
    """Compute rolling Sharpe ratio. Returns list of {date: str, sharpe: float}."""
    if len(returns) < window:
        return []

    def _sharpe_window(x):
        s = pd.Series(x)
        std = s.std()
        if std == 0 or np.isnan(std):
            return np.nan
        return float(s.mean() / std * np.sqrt(window))

    rolled = returns.rolling(window).apply(_sharpe_window, raw=True)
    rolled = rolled.dropna()

    result = []
    for dt, val in rolled.items():
        if not np.isnan(val):
            result.append({"date": str(dt.date()), "sharpe": round(float(val), 4)})
    return result


def _sector_hit_rates(trades: list) -> dict:
    """Compute win rate and trade count per sector."""
    sector_data: dict = {}
    for t in trades:
        sector = t.get("sector", "unknown")
        ret = t.get("return_pct", 0.0) or 0.0
        if sector not in sector_data:
            sector_data[sector] = {"wins": 0, "total": 0}
        sector_data[sector]["total"] += 1
        if ret > 0:
            sector_data[sector]["wins"] += 1

    result = {}
    for sector, data in sector_data.items():
        total = data["total"]
        win_rate = data["wins"] / total if total > 0 else 0.0
        result[sector] = {"win_rate": round(win_rate, 4), "trade_count": total}
    return result


def _regime_returns(trades: list) -> dict:
    """Aggregate returns by regime."""
    regime_data: dict = {}
    for t in trades:
        regime = t.get("regime", "UNKNOWN") or "UNKNOWN"
        ret = t.get("return_pct", 0.0) or 0.0
        if regime not in regime_data:
            regime_data[regime] = {"total_return": 0.0, "trade_count": 0}
        regime_data[regime]["total_return"] += ret
        regime_data[regime]["trade_count"] += 1

    result = {}
    for regime, data in regime_data.items():
        result[regime] = {
            "return": round(data["total_return"], 6),
            "trade_count": data["trade_count"],
        }
    return result


def _information_ratio(
    portfolio_returns: pd.Series, benchmark_returns: pd.Series
) -> float:
    """Alpha / tracking_error where tracking_error = std(active_returns) * sqrt(252)."""
    if len(portfolio_returns) == 0 or len(benchmark_returns) == 0:
        return 0.0

    # Align on common dates
    common = portfolio_returns.index.intersection(benchmark_returns.index)
    if len(common) < 2:
        return 0.0

    port = portfolio_returns.loc[common]
    bench = benchmark_returns.loc[common]
    active = port - bench

    tracking_error = float(active.std() * np.sqrt(252))
    if tracking_error == 0 or np.isnan(tracking_error):
        return 0.0

    alpha = _annualized_return(port) - _annualized_return(bench)
    return round(float(alpha / tracking_error), 4)


def _annual_turnover(trades: list, period_years: float) -> float:
    """Estimate annual portfolio turnover %.

    Approximation: (num_trades * avg_holding_fraction) / period_years * 100
    We treat each trade as entering+exiting a position sized at 1/N of portfolio.
    Using the simpler (num_trades / period_years) * 100 as a % of portfolio turns.
    """
    if period_years <= 0 or len(trades) == 0:
        return 0.0
    # Each trade represents a round-trip (entry + exit counted as 1 turnover event)
    return round((len(trades) / period_years), 2)


def _transaction_costs(trades: list, total_return: float) -> float:
    """Total return lost to 5bps per trade (one-way), applied both entry and exit.

    Returns the cost as a positive fraction (e.g. 0.002 = 0.2%).
    """
    bps_per_side = 0.0005  # 5 bps
    cost_per_trade = 2 * bps_per_side  # entry + exit
    return round(len(trades) * cost_per_trade, 6)


# ---------------------------------------------------------------------------
# Main public function
# ---------------------------------------------------------------------------

def compute(
    portfolio_returns: pd.Series,
    benchmark_returns: pd.Series,
    trades: list,
    sector_results: dict,
) -> dict:
    """Compute all performance metrics.

    Parameters
    ----------
    portfolio_returns : pd.Series with DatetimeIndex, daily returns
    benchmark_returns : pd.Series with DatetimeIndex, daily benchmark returns
    trades : list of trade dicts
    sector_results : dict of sector_id -> {trades, returns}

    Returns
    -------
    dict with all performance metrics
    """
    # Clean inputs
    port = _clean_returns(portfolio_returns)
    bench = _clean_returns(benchmark_returns)
    trades = trades or []

    # Period length in years
    if len(port) >= 2:
        period_days = (port.index[-1] - port.index[0]).days
        period_years = max(period_days / 365.25, 1 / 252)
    else:
        period_years = 1.0

    # -----------------------------------------------------------------------
    # Returns
    # -----------------------------------------------------------------------
    total_ret = _total_return(port)
    ann_ret = _annualized_return(port)
    bench_total_ret = _total_return(bench)
    bench_ann_ret = _annualized_return(bench)

    # Alpha: annualized excess return
    common_idx = port.index.intersection(bench.index)
    if len(common_idx) >= 2:
        alpha = ann_ret - bench_ann_ret
    else:
        alpha = ann_ret

    # -----------------------------------------------------------------------
    # Risk-adjusted ratios (empyrical)
    # -----------------------------------------------------------------------
    if len(port) >= 2:
        try:
            sharpe = float(ep.sharpe_ratio(port, risk_free=0, annualization=252))
            if np.isnan(sharpe) or np.isinf(sharpe):
                sharpe = 0.0
        except Exception:
            sharpe = 0.0

        try:
            sortino = float(ep.sortino_ratio(port, required_return=0, annualization=252))
            if np.isnan(sortino) or np.isinf(sortino):
                sortino = 0.0
        except Exception:
            sortino = 0.0

        try:
            calmar = float(ep.calmar_ratio(port))
            if np.isnan(calmar) or np.isinf(calmar):
                calmar = 0.0
        except Exception:
            calmar = 0.0
    else:
        sharpe = 0.0
        sortino = 0.0
        calmar = 0.0

    ir = _information_ratio(port, bench)

    # -----------------------------------------------------------------------
    # Drawdown metrics
    # -----------------------------------------------------------------------
    if len(port) >= 2:
        try:
            max_dd = float(ep.max_drawdown(port))
            if np.isnan(max_dd):
                max_dd = 0.0
        except Exception:
            max_dd = 0.0
    else:
        max_dd = 0.0

    if len(port) >= 2:
        dd_start, dd_end = _max_drawdown_dates(port)
        dd_recovery = _max_drawdown_recovery_days(port)
        avg_dd = _avg_drawdown(port)
        dd_periods = _find_drawdown_periods(port, top_n=10)
    else:
        dd_start, dd_end = "N/A", "N/A"
        dd_recovery = -1
        avg_dd = 0.0
        dd_periods = []

    # -----------------------------------------------------------------------
    # Trade statistics
    # -----------------------------------------------------------------------
    total_trades = len(trades)

    if total_trades > 0:
        returns_list = [t.get("return_pct", 0.0) or 0.0 for t in trades]
        wins = [r for r in returns_list if r > 0]
        losses = [r for r in returns_list if r <= 0]

        win_rate = len(wins) / total_trades
        avg_win = float(np.mean(wins)) if wins else 0.0
        avg_loss = float(np.mean(losses)) if losses else 0.0

        total_wins = sum(wins)
        total_losses = abs(sum(losses))
        profit_factor = (
            total_wins / total_losses if total_losses > 0 else float("inf") if total_wins > 0 else 0.0
        )

        holding_days = [t.get("holding_days", 0) or 0 for t in trades]
        avg_holding = float(np.mean(holding_days))
    else:
        win_rate = 0.0
        avg_win = 0.0
        avg_loss = 0.0
        profit_factor = 0.0
        avg_holding = 0.0

    # -----------------------------------------------------------------------
    # Turnover & transaction costs
    # -----------------------------------------------------------------------
    annual_turnover = _annual_turnover(trades, period_years)
    est_transaction_costs = _transaction_costs(trades, total_ret)

    # -----------------------------------------------------------------------
    # Monthly returns heatmap data
    # -----------------------------------------------------------------------
    monthly_returns = _monthly_returns_dict(port)

    # -----------------------------------------------------------------------
    # Sector hit rates
    # -----------------------------------------------------------------------
    sector_hit_rates = _sector_hit_rates(trades)

    # -----------------------------------------------------------------------
    # Rolling 252-day Sharpe
    # -----------------------------------------------------------------------
    rolling_sharpe = _rolling_sharpe(port, window=252)

    # -----------------------------------------------------------------------
    # Regime performance
    # -----------------------------------------------------------------------
    regime_returns_data = _regime_returns(trades)

    # -----------------------------------------------------------------------
    # Assemble output dict
    # -----------------------------------------------------------------------
    return {
        # Returns
        "total_return": round(total_ret, 6),
        "annualized_return": round(ann_ret, 6),
        "benchmark_total_return": round(bench_total_ret, 6),
        "benchmark_annualized_return": round(bench_ann_ret, 6),
        "alpha": round(alpha, 6),
        # Risk-adjusted
        "sharpe": round(sharpe, 4),
        "sortino": round(sortino, 4),
        "calmar": round(calmar, 4),
        "information_ratio": round(ir, 4),
        # Drawdown
        "max_drawdown": round(max_dd, 6),
        "max_drawdown_start": dd_start,
        "max_drawdown_end": dd_end,
        "max_drawdown_recovery_days": dd_recovery,
        "avg_drawdown": round(avg_dd, 6),
        "drawdown_periods": dd_periods,
        # Trade statistics
        "total_trades": total_trades,
        "win_rate": round(win_rate, 4),
        "avg_win": round(avg_win, 6),
        "avg_loss": round(avg_loss, 6),
        "profit_factor": round(profit_factor, 4) if profit_factor != float("inf") else float("inf"),
        "avg_holding_days": round(avg_holding, 2),
        # Turnover
        "annual_turnover_pct": annual_turnover,
        "estimated_transaction_costs": est_transaction_costs,
        # Monthly returns heatmap
        "monthly_returns": monthly_returns,
        # Sector hit rates
        "sector_hit_rates": sector_hit_rates,
        # Rolling Sharpe
        "rolling_sharpe_252d": rolling_sharpe,
        # Regime performance
        "regime_returns": regime_returns_data,
    }


# ---------------------------------------------------------------------------
# Test block
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import pandas as pd
    import numpy as np

    # Generate synthetic returns for testing
    np.random.seed(42)
    dates = pd.date_range("2022-01-01", "2023-12-31", freq="B")
    port_returns = pd.Series(np.random.normal(0.0003, 0.01, len(dates)), index=dates)
    bench_returns = pd.Series(np.random.normal(0.0001, 0.012, len(dates)), index=dates)

    # Synthetic trades
    trades = [
        {"sector": "technology", "direction": "long", "return_pct": 0.05, "holding_days": 30, "date": "2022-03-01", "regime": "NEUTRAL"},
        {"sector": "rates", "direction": "short", "return_pct": 0.12, "holding_days": 45, "date": "2022-06-01", "regime": "RISK_OFF"},
        {"sector": "technology", "direction": "long", "return_pct": -0.03, "holding_days": 20, "date": "2022-09-01", "regime": "RISK_OFF"},
    ]

    metrics = compute(port_returns, bench_returns, trades, {})

    # Validate key metrics exist and are reasonable
    assert "sharpe" in metrics, "Missing sharpe"
    assert "max_drawdown" in metrics, "Missing max_drawdown"
    assert "win_rate" in metrics, "Missing win_rate"
    assert "monthly_returns" in metrics, "Missing monthly_returns"
    assert len(metrics["rolling_sharpe_252d"]) > 0, "Missing rolling sharpe data"
    assert metrics["total_trades"] == 3, f"Wrong trade count: {metrics['total_trades']}"
    assert 0.0 <= metrics["win_rate"] <= 1.0, f"Invalid win rate: {metrics['win_rate']}"

    print(f"Sharpe: {metrics['sharpe']:.3f}")
    print(f"Max drawdown: {metrics['max_drawdown']:.3f}")
    print(f"Win rate: {metrics['win_rate']:.2%}")
    print(f"Total return: {metrics['total_return']:.2%}")
    print(f"Monthly returns keys: {list(metrics['monthly_returns'].keys())[:2]}")
    print(f"Sortino: {metrics['sortino']:.3f}")
    print(f"Calmar: {metrics['calmar']:.3f}")
    print(f"Alpha: {metrics['alpha']:.4f}")
    print(f"Information ratio: {metrics['information_ratio']:.4f}")
    print(f"Max DD start/end: {metrics['max_drawdown_start']} / {metrics['max_drawdown_end']}")
    print(f"Drawdown periods (top {len(metrics['drawdown_periods'])}): depth of first = {metrics['drawdown_periods'][0]['depth']:.3f}")
    print(f"Rolling Sharpe entries: {len(metrics['rolling_sharpe_252d'])}")
    print(f"Regime returns: {metrics['regime_returns']}")
    print(f"Sector hit rates: {metrics['sector_hit_rates']}")
    print("All tests PASSED!")
