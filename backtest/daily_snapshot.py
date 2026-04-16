#!/usr/bin/env python3
"""
daily_snapshot.py — Fetches live MapperLab scores, appends to score_history.jsonl,
runs signal engine on current scores, appends signals to signals.jsonl,
writes a markdown summary to data/signal_summary.md.

Usage:
  python backtest/daily_snapshot.py --server-url https://mapperlab.co
  python backtest/daily_snapshot.py --server-url http://localhost:3001  # local dev
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
SCORE_HISTORY_FILE = DATA_DIR / "score_history.jsonl"
SIGNALS_FILE       = DATA_DIR / "signals.jsonl"
SUMMARY_FILE       = DATA_DIR / "signal_summary.md"

# Add backtest dir to path for signal_engine import
sys.path.insert(0, str(Path(__file__).parent))
from signal_engine import compute_composite_signal


def fetch_scores(server_url: str) -> dict:
    """Fetch /api/heatmap from the live server."""
    url = server_url.rstrip("/") + "/api/heatmap"
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    return resp.json()


def fetch_status(server_url: str) -> dict:
    """Fetch /api/status."""
    url = server_url.rstrip("/") + "/api/status"
    resp = requests.get(url, timeout=10)
    resp.raise_for_status()
    return resp.json()


def snapshot_to_flat(heatmap: dict, snapshot_date: str) -> list[dict]:
    """
    Flatten heatmap response into a list of {date, node_id, score, velocity, breadth} records.
    One record per node (sector + industries).
    """
    records = []
    for sector in heatmap.get("sectors", []):
        records.append({
            "date":       snapshot_date,
            "node_id":    sector["id"],
            "node_type":  "sector",
            "name":       sector["name"],
            "score":      sector["score"],
            "direction":  sector.get("direction", ""),
            "velocity":   sector.get("velocity", 0),
            "tw_pct":     sector.get("breadth", {}).get("tw_pct", None),
            "hw_pct":     sector.get("breadth", {}).get("hw_pct", None),
        })
        for ind in sector.get("industries", []):
            records.append({
                "date":      snapshot_date,
                "node_id":   ind["id"],
                "node_type": "industry",
                "name":      ind["name"],
                "score":     ind["score"],
                "direction": ind.get("direction", ""),
                "velocity":  ind.get("velocity", 0),
                "tw_pct":    None,
                "hw_pct":    None,
            })
    return records


def load_recent_history(node_id: str, n: int = 20) -> list[float]:
    """
    Load the last N scores for a node from score_history.jsonl.
    Returns list of floats, oldest first.
    """
    if not SCORE_HISTORY_FILE.exists():
        return []

    scores = []
    with open(SCORE_HISTORY_FILE) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                if rec.get("node_id") == node_id:
                    scores.append(rec["score"])
            except json.JSONDecodeError:
                continue

    return scores[-n:] if len(scores) > n else scores


def generate_signals(heatmap: dict, snapshot_date: str) -> list[dict]:
    """
    Run signal engine on each sector using live scores + recent history.
    Returns list of signal dicts.
    """
    signals = []
    for sector in heatmap.get("sectors", []):
        sector_id = sector["id"]
        current_score = sector["score"]

        # Load historical scores for momentum calculation
        score_history = load_recent_history(sector_id, n=20)
        # Append today's score at the end (newest)
        score_history.append(current_score)

        # Industry scores for confluence
        industry_scores = [ind["score"] for ind in sector.get("industries", [])]

        # Macro state from sector scores (same proxy as run_backtest.py)
        rates_score = next((s["score"] for s in heatmap.get("sectors", []) if s["id"] == "rates"), 50)
        credit_score = next((s["score"] for s in heatmap.get("sectors", []) if s["id"] == "credit"), 50)
        fin_score = next((s["score"] for s in heatmap.get("sectors", []) if s["id"] == "financials"), 50)

        macro_state = {
            "vix":     max(10, 50 - rates_score * 0.4),
            "hy_oas":  max(200, 800 - credit_score * 6),
            "t10y2y":  (rates_score - 50) / 25,
            "stlfsi4": max(0, (50 - fin_score) / 20),
        }

        sig = compute_composite_signal(current_score, score_history, industry_scores, macro_state)

        signals.append({
            "date":              snapshot_date,
            "sector_id":         sector_id,
            "sector_name":       sector["name"],
            "score":             current_score,
            "direction":         sig["direction"],
            "regime":            sig["regime"],
            "position_pct":      round(sig["position_pct"], 4),
            "composite":         round(sig["composite"], 4),
            "level_signal":      round(sig["level_signal"], 4),
            "momentum_signal":   round(sig["momentum_signal"], 4),
            "confluence_signal": round(sig["confluence_signal"], 4),
            "velocity":          sector.get("velocity", 0),
            "breadth_tw":        sector.get("breadth", {}).get("tw_pct"),
            "breadth_hw":        sector.get("breadth", {}).get("hw_pct"),
        })

    return signals


def write_summary(signals: list[dict], status: dict, snapshot_date: str) -> None:
    """Write a markdown summary of today's signals."""
    longs  = [s for s in signals if s["direction"] == "long"]
    shorts = [s for s in signals if s["direction"] == "short"]
    flats  = [s for s in signals if s["direction"] == "flat"]
    regime = signals[0]["regime"] if signals else "UNKNOWN"

    longs.sort(key=lambda s: s["composite"], reverse=True)
    shorts.sort(key=lambda s: s["composite"])

    lines = [
        f"# MapperLab Signal Summary — {snapshot_date}",
        "",
        f"**Regime:** {regime}  ",
        f"**Server last update:** {status.get('lastUpdate', 'unknown')}  ",
        f"**Nodes scored:** {status.get('scoresCount', '?')}  ",
        "",
        f"## Signals: {len(longs)} LONG · {len(shorts)} SHORT · {len(flats)} FLAT",
        "",
    ]

    if longs:
        lines += ["### Long Signals", "| Sector | Score | Composite | Position % | Regime |",
                  "|--------|-------|-----------|------------|--------|"]
        for s in longs:
            lines.append(f"| {s['sector_name']} | {s['score']:.1f} | {s['composite']:+.3f} | {s['position_pct']:.1%} | {s['regime']} |")
        lines.append("")

    if shorts:
        lines += ["### Short Signals", "| Sector | Score | Composite | Position % | Regime |",
                  "|--------|-------|-----------|------------|--------|"]
        for s in shorts:
            lines.append(f"| {s['sector_name']} | {s['score']:.1f} | {s['composite']:+.3f} | {s['position_pct']:.1%} | {s['regime']} |")
        lines.append("")

    lines += ["*Generated by MapperLab daily snapshot*"]

    SUMMARY_FILE.write_text("\n".join(lines))


def main():
    parser = argparse.ArgumentParser(description="Daily MapperLab score snapshot")
    parser.add_argument("--server-url", default="https://mapperlab.co",
                        help="MapperLab server base URL")
    args = parser.parse_args()

    snapshot_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    print(f"[snapshot] Date: {snapshot_date}")
    print(f"[snapshot] Server: {args.server_url}")

    # Fetch live data
    print("[snapshot] Fetching heatmap...")
    try:
        heatmap = fetch_scores(args.server_url)
        status  = fetch_status(args.server_url)
    except (requests.exceptions.HTTPError,
            requests.exceptions.ConnectionError,
            requests.exceptions.Timeout) as err:
        print(f"[snapshot] Server unavailable ({type(err).__name__}: {err}) — skipping today's snapshot.")
        DATA_DIR.mkdir(exist_ok=True)
        SUMMARY_FILE.write_text(
            f"# MapperLab Signal Summary — {snapshot_date}\n\n"
            f"**Status:** Server unavailable — `{args.server_url}` could not be reached.\n\n"
            f"**Error:** `{err}`\n\n"
            f"_Snapshot skipped. This is normal when the server is not deployed to this URL._\n"
        )
        print(f"[snapshot] Wrote fallback summary to {SUMMARY_FILE}")
        sys.exit(0)
    print(f"[snapshot] Got {len(heatmap.get('sectors', []))} sectors")

    # Create data/ directory
    DATA_DIR.mkdir(exist_ok=True)

    # Append flat records to score_history.jsonl
    records = snapshot_to_flat(heatmap, snapshot_date)
    with open(SCORE_HISTORY_FILE, "a") as f:
        for rec in records:
            f.write(json.dumps(rec) + "\n")
    print(f"[snapshot] Wrote {len(records)} node records to score_history.jsonl")

    # Generate and append signals
    signals = generate_signals(heatmap, snapshot_date)
    with open(SIGNALS_FILE, "a") as f:
        for sig in signals:
            f.write(json.dumps(sig) + "\n")
    print(f"[snapshot] Generated {len(signals)} sector signals")

    # Write markdown summary
    write_summary(signals, status, snapshot_date)
    print(f"[snapshot] Summary written to {SUMMARY_FILE}")

    # Print to stdout for CI visibility
    longs  = [s for s in signals if s["direction"] == "long"]
    shorts = [s for s in signals if s["direction"] == "short"]
    print(f"\nSIGNALS: {len(longs)} LONG, {len(shorts)} SHORT, {len(signals)-len(longs)-len(shorts)} FLAT")
    for s in sorted(signals, key=lambda x: abs(x["composite"]), reverse=True)[:8]:
        print(f"  {s['direction'].upper():5s} {s['sector_name']:<30} score={s['score']:.1f} composite={s['composite']:+.3f} pos={s['position_pct']:.1%}")


if __name__ == "__main__":
    main()
