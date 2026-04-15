#!/usr/bin/env python3
"""
score_replayer.py — Reconstructs historical MapperLab score timeseries
by replaying policy events from historical_events.json through impact_matrix.json.

Usage:
  python3 score_replayer.py --start 2022-01-01 --end 2022-12-31 --output /tmp/scores.json
  python3 score_replayer.py --start 2020-01-01 --end 2024-12-31  # prints summary

Returns JSON: { node_id: [{date, score}, ...], ... }
"""
import argparse
import json
import sys
from copy import deepcopy
from datetime import date, timedelta
from pathlib import Path

import pandas_market_calendars as mcal
from tqdm import tqdm

ROOT = Path(__file__).parent.parent  # /tmp/mapperlab
CONFIDENCE_MULT = {"high": 1.5, "medium": 1.0, "low": 0.6}
DECAY_RATE = 0.015

# Maps impact_matrix snake_case keys -> taxonomy kebab-case node IDs
DELTA_ID_MAP = {
    # Technology
    "technology": "technology",
    "semiconductors": "semiconductors",
    "software": "software",
    "cybersecurity": "cybersecurity",
    "ai_cloud": "software",          # maps to software node
    "hardware": "hardware",
    # Financials
    "financials": "financials",
    "banks": "banks",
    "insurance": "insurance",
    "insurance_life": "insurance",
    "insurance_pc": "insurance",
    "asset_management": "asset-management",
    "asset_management_alts": "asset-management",
    "fintech": "fintech",
    # Industrials
    "industrials": "industrials",
    "aerospace_defense": "aerospace-defense",
    "transportation": "transportation",
    "machinery": "machinery",
    "construction": "construction",
    "construction_homebuilders": "construction",
    # Consumer Discretionary
    "consumer_discretionary": "consumer-discretionary",
    "autos": "autos",
    "autos_ev": "autos",
    "retail": "retail",
    "travel": "travel",
    # Consumer Staples
    "consumer_staples": "consumer-staples",
    "food_staples": "food",
    "food": "food",
    "beverage": "beverage",
    "agribusiness": "agri-business",
    # Energy
    "energy": "energy",
    "energy_ep": "upstream",
    "upstream_oil": "upstream",
    "oil_services": "services",
    "refining": "refining",
    "renewables": "renewables",
    # Materials
    "materials": "materials",
    "metals_mining": "metals-mining",
    "metals_mining_iron_ore": "metals-mining",
    "chemicals": "chemicals",
    "paper": "paper",
    # Health Care
    "health_care": "health-care",
    "pharma": "pharma",
    "biotech": "biotech",
    "medical_devices": "medical-devices",
    "providers": "providers",
    "managed_care": "providers",
    # Utilities
    "utilities": "utilities",
    "electric_utilities": "electric",
    "electric": "electric",
    "water_utilities": "water",
    # Real Estate
    "real_estate": "real-estate",
    "residential_reits": "residential",
    "commercial_reits": "commercial",
    "commercial_reits_office": "commercial",
    "data_center_reits": "data-center",
    # Communications
    "communications": "communications",
    "media": "media",
    "media_streaming": "media",
    "telecom": "telecom",
    # FX
    "fx": "fx",
    "fx_usd": "g10",
    "fx_eur": "g10",
    "fx_jpy": "g10",
    "fx_em": "em-fx",
    "fx_cnh": "em-fx",
    "fx_mxn": "em-fx",
    "fx_brl": "em-fx",
    # Rates
    "rates": "rates",
    "rates_2y": "ust",
    "rates_10y": "ust",
    "rates_10y_ust": "ust",
    "rates_30y": "ust",
    "rates_credit_hy": "credit",
    "credit_ig": "credit",
    "credit_hy": "credit",
    "credit_em": "credit",
    "bunds": "bunds",
    # Commodities
    "commodities": "commodities",
    "commodities_metals": "metals",
    "gold": "metals",
    "copper": "metals",
    "commodities_energy": "energy-commodities",
    "wti": "energy-commodities",
    "nat_gas": "energy-commodities",
    "commodities_agriculture": "agriculture",
    "agriculture_soybeans": "agriculture",
    "livestock": "livestock",
    "lumber": "lumber",
    # Crypto
    "crypto": "crypto",
    "crypto_btc": "majors",
    "crypto_eth": "majors",
    "crypto_exchanges": "exchanges",
}

BASELINE_SCORES = {
    # Sectors
    "technology": 55, "financials": 56, "industrials": 55,
    "consumer-discretionary": 48, "consumer-staples": 55, "energy": 52,
    "materials": 50, "health-care": 52, "utilities": 55, "real-estate": 45,
    "communications": 56, "fx": 44, "rates": 42, "commodities": 58, "crypto": 72,
    # Technology
    "semiconductors": 45, "software": 62, "cybersecurity": 65, "hardware": 45,
    # Financials
    "banks": 56, "insurance": 38, "asset-management": 70, "fintech": 58,
    # Industrials
    "aerospace-defense": 68, "transportation": 50, "machinery": 52, "construction": 45,
    # Consumer Discretionary
    "autos": 42, "retail": 48, "travel": 52,
    # Consumer Staples
    "beverage": 55, "food": 55, "agri-business": 48,
    # Energy
    "upstream": 56, "services": 52, "refining": 50, "renewables": 35,
    # Materials
    "metals-mining": 48, "chemicals": 45, "paper": 50,
    # Health Care
    "pharma": 52, "biotech": 55, "medical-devices": 58, "providers": 45,
    # Utilities
    "electric": 55, "water": 56,
    # Real Estate
    "residential": 45, "commercial": 32, "data-center": 65,
    # Communications
    "media": 60, "telecom": 52,
    # FX
    "g10": 46, "em-fx": 40,
    # Rates
    "ust": 42, "bunds": 48, "credit": 45,
    # Commodities
    "metals": 72, "energy-commodities": 52, "agriculture": 42,
    "livestock": 50, "lumber": 48,
    # Crypto
    "majors": 72, "exchanges": 60,
}


def _load_json(path: Path) -> dict:
    with open(path, "r") as f:
        return json.load(f)


def reconstruct_scores(
    start_date,
    end_date,
    impact_matrix=None,
    historical_events=None,
    show_progress=False,
):
    """
    Reconstruct daily score timeseries for all nodes.

    Args:
        start_date: datetime.date or str (YYYY-MM-DD)
        end_date: datetime.date or str (YYYY-MM-DD)
        impact_matrix: dict (loaded from impact_matrix.json), or None to load from disk
        historical_events: list (loaded from historical_events.json), or None to load from disk
        show_progress: bool — show tqdm progress bar

    Returns:
        dict: { node_id: [{"date": "YYYY-MM-DD", "score": float}, ...] }
    """
    # Normalise date inputs
    if isinstance(start_date, str):
        start_date = date.fromisoformat(start_date)
    if isinstance(end_date, str):
        end_date = date.fromisoformat(end_date)

    # Load data from disk if not provided
    if impact_matrix is None:
        impact_matrix = _load_json(ROOT / "config" / "impact_matrix.json")
    if historical_events is None:
        raw = _load_json(ROOT / "backtest" / "historical_events.json")
        historical_events = raw["events"]

    policy_events = impact_matrix["policy_events"]

    # Build a lookup: date string -> list of event dicts
    events_by_date: dict[str, list] = {}
    for ev in historical_events:
        d = ev["date"]
        events_by_date.setdefault(d, []).append(ev)

    # Get NYSE trading days in range
    nyse = mcal.get_calendar("NYSE")
    schedule = nyse.schedule(
        start_date=start_date.isoformat(),
        end_date=end_date.isoformat(),
    )
    trading_days = [ts.date() for ts in schedule.index]

    # Initialise scores from baselines
    scores: dict[str, float] = {node: float(v) for node, v in BASELINE_SCORES.items()}

    # Output storage: node_id -> list of {date, score} dicts
    result: dict[str, list] = {node: [] for node in BASELINE_SCORES}

    iterator = tqdm(trading_days, desc="Replaying events") if show_progress else trading_days

    for trading_day in iterator:
        date_str = trading_day.isoformat()
        day_events = events_by_date.get(date_str, [])

        # Accumulate deltas across all events for this day
        accumulated: dict[str, float] = {}

        for ev in day_events:
            event_id = ev["event_id"]
            if event_id not in policy_events:
                # Unknown event ID — skip silently
                continue

            policy = policy_events[event_id]
            sector_deltas = policy.get("sector_deltas", {})
            confidence = policy.get("confidence", "medium")
            conf_mult = CONFIDENCE_MULT.get(confidence, 1.0)

            magnitude = float(ev.get("magnitude", 1))
            inverse = bool(ev.get("inverse", False))
            sign = -1.0 if inverse else 1.0

            for delta_key, raw_delta in sector_deltas.items():
                node_id = DELTA_ID_MAP.get(delta_key)
                if node_id is None:
                    # Key not in translation map — skip
                    continue
                if node_id not in scores:
                    # Node not in our baseline set — skip
                    continue

                adjusted_delta = raw_delta * magnitude * conf_mult * sign
                accumulated[node_id] = accumulated.get(node_id, 0.0) + adjusted_delta

        # Apply accumulated deltas, clamp, then decay
        for node_id in scores:
            delta = accumulated.get(node_id, 0.0)
            new_score = scores[node_id] + delta
            # Clamp to [0, 100]
            new_score = max(0.0, min(100.0, new_score))
            # Daily mean-reversion decay
            new_score += (50.0 - new_score) * DECAY_RATE
            scores[node_id] = new_score
            result[node_id].append({"date": date_str, "score": round(new_score, 4)})

    return result


def _print_summary(results: dict) -> None:
    """Print a quick statistical summary of the reconstructed scores."""
    print(f"\n{'Node':<25} {'Days':>5} {'Min':>7} {'Max':>7} {'Mean':>7} {'Final':>7}")
    print("-" * 60)
    for node_id in sorted(results):
        series = results[node_id]
        if not series:
            continue
        scores_list = [s["score"] for s in series]
        print(
            f"{node_id:<25} {len(scores_list):>5} "
            f"{min(scores_list):>7.1f} {max(scores_list):>7.1f} "
            f"{sum(scores_list)/len(scores_list):>7.1f} "
            f"{scores_list[-1]:>7.1f}"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Reconstruct MapperLab historical score timeseries"
    )
    parser.add_argument("--start", required=True, help="Start date YYYY-MM-DD")
    parser.add_argument("--end", required=True, help="End date YYYY-MM-DD")
    parser.add_argument(
        "--output", default=None, help="Path to write JSON output (omit for summary)"
    )
    args = parser.parse_args()

    results = reconstruct_scores(
        start_date=args.start,
        end_date=args.end,
        show_progress=True,
    )

    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w") as f:
            json.dump(results, f)
        print(f"\nWrote {len(results)} node timeseries to {out_path}")
        # Also print summary
        _print_summary(results)
    else:
        _print_summary(results)
