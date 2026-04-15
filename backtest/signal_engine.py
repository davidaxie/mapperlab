#!/usr/bin/env python3
"""
signal_engine.py — Composite buy/sell signal generator for MapperLab sector scores.

Signal combines 4 sub-signals:
  1. Level (0.35): Score position in [0,100]
  2. Momentum (0.30): 7-day velocity with 14-day confirmation
  3. Regime (0.20): Macro state from VIX, HY OAS, STLFSI4, T10Y2Y
  4. Confluence (0.15): Industry breadth within sector

Output: {direction, regime, position_pct, composite, level_signal,
         momentum_signal, confluence_signal, regime_mult, regime_name}

Usage:
  from backtest.signal_engine import compute_composite_signal

  sig = compute_composite_signal(
      score=72,
      score_history=[50]*15,        # list of 15+ prior scores (oldest first)
      industry_scores=[68, 70, 72, 74],  # scores of industries within sector
      macro_state={"vix": 15, "hy_oas": 320, "t10y2y": 0.2, "stlfsi4": 0.1}
  )
"""


def compute_level_signal(score: float) -> float:
    """Returns signed level signal in [-1.0, 1.0]."""
    if score >= 70:
        return +1.0
    elif score >= 62:
        return +0.65
    elif score >= 56:
        return +0.30
    elif score <= 30:
        return -1.0
    elif score <= 38:
        return -0.65
    elif score <= 44:
        return -0.30
    else:
        # Neutral band [44, 56]
        return 0.0


def compute_momentum_signal(score_history: list) -> float:
    """Returns signed momentum signal in [-1.0, 1.0]. score_history is oldest-first."""
    if len(score_history) < 8:
        return 0.0

    vel_7d = score_history[-1] - score_history[-8]

    # Dead zone — noise
    if abs(vel_7d) < 0.3:
        return 0.0

    # Need 15 points for 14-day velocity check
    if len(score_history) >= 15:
        vel_14d = score_history[-1] - score_history[-15]
        # Conflicting signals: opposite signs
        if (vel_7d > 0 and vel_14d < 0) or (vel_7d < 0 and vel_14d > 0):
            return 0.0

    direction = 1.0 if vel_7d > 0 else -1.0
    strength = min(abs(vel_7d) / 2.0, 1.0)
    return direction * strength


def compute_regime(macro_state: dict | None) -> tuple[str, float, float]:
    """Returns (regime_name, regime_mult, regime_input)."""
    if macro_state is None:
        return ("NEUTRAL", 1.0, 0.0)

    vix = macro_state.get("vix")
    hy_oas = macro_state.get("hy_oas")
    t10y2y = macro_state.get("t10y2y")
    stlfsi4 = macro_state.get("stlfsi4")

    # CRISIS: any one sufficient
    crisis = False
    if vix is not None and vix > 35:
        crisis = True
    if stlfsi4 is not None and stlfsi4 > 2.0:
        crisis = True

    if crisis:
        return ("CRISIS", 0.3, -0.40)

    # RISK_OFF: any one sufficient (checked after CRISIS)
    risk_off = False
    if vix is not None and vix > 22:
        risk_off = True
    if hy_oas is not None and hy_oas > 500:
        risk_off = True
    if stlfsi4 is not None and stlfsi4 > 1.5:
        risk_off = True

    if risk_off:
        return ("RISK_OFF", 0.6, -0.20)

    # RISK_ON: all must be true
    risk_on_conditions = []
    if vix is not None:
        risk_on_conditions.append(vix < 16)
    if hy_oas is not None:
        risk_on_conditions.append(hy_oas < 350)
    if t10y2y is not None:
        risk_on_conditions.append(t10y2y > 0.1)

    if risk_on_conditions and all(risk_on_conditions):
        return ("RISK_ON", 1.2, +0.20)

    return ("NEUTRAL", 1.0, 0.0)


def compute_confluence_signal(industry_scores: list | None) -> float:
    """Returns signed confluence signal in [-1.0, 1.0]."""
    if not industry_scores:
        return 0.0

    n = len(industry_scores)
    tw_count = sum(1 for s in industry_scores if s >= 56)
    hw_count = sum(1 for s in industry_scores if s <= 44)

    tw_pct = tw_count / n
    hw_pct = hw_count / n

    if tw_pct >= 0.70:
        return +1.0
    elif tw_pct >= 0.50:
        return +0.55
    elif hw_pct >= 0.70:
        return -1.0
    elif hw_pct >= 0.50:
        return -0.55
    else:
        return 0.0


def compute_composite_signal(
    score: float,
    score_history: list,
    industry_scores: list | None = None,
    macro_state: dict | None = None,
) -> dict:
    """
    Compute the full composite signal for a sector.

    Returns:
        {
          "direction": "long" | "short" | "flat",
          "regime": "RISK_ON" | "NEUTRAL" | "RISK_OFF" | "CRISIS",
          "regime_mult": float,
          "position_pct": float,
          "composite": float,
          "level_signal": float,
          "momentum_signal": float,
          "confluence_signal": float,
          "regime_input": float,
        }
    """
    level_signed = compute_level_signal(score)
    momentum_signed = compute_momentum_signal(score_history)
    regime_name, regime_mult, regime_input = compute_regime(macro_state)
    confluence_signed = compute_confluence_signal(industry_scores)

    composite = (
        0.35 * level_signed
        + 0.30 * momentum_signed
        + 0.20 * regime_input
        + 0.15 * confluence_signed
    )

    # Entry rule checks
    min_strength_ok = abs(composite) >= 0.35

    # Level and momentum must agree in direction OR momentum is 0.0
    if momentum_signed == 0.0:
        direction_agree = True
    else:
        direction_agree = (level_signed > 0 and momentum_signed > 0) or (
            level_signed < 0 and momentum_signed < 0
        )

    if not (min_strength_ok and direction_agree):
        return {
            "direction": "flat",
            "regime": regime_name,
            "regime_mult": regime_mult,
            "position_pct": 0.0,
            "composite": composite,
            "level_signal": level_signed,
            "momentum_signal": momentum_signed,
            "confluence_signal": confluence_signed,
            "regime_input": regime_input,
        }

    # Position sizing
    base_position = abs(composite) * 0.15
    position_pct = min(base_position * regime_mult, 0.20)
    direction = "long" if composite > 0 else "short"

    return {
        "direction": direction,
        "regime": regime_name,
        "regime_mult": regime_mult,
        "position_pct": position_pct,
        "composite": composite,
        "level_signal": level_signed,
        "momentum_signal": momentum_signed,
        "confluence_signal": confluence_signed,
        "regime_input": regime_input,
    }


def should_exit(
    current_score: float,
    current_composite: float,
    entry_direction: str,
    entry_score: float,
    vel_7d: float,
) -> bool:
    """
    Returns True if position should be exited.

    Exit if:
      - score crosses 50 in opposite direction of entry
      - abs(current_composite) < 0.20
      - vel_7d reverses > 0.5 pts from entry direction
    """
    # Score crosses 50 in opposite direction of entry
    if entry_direction == "long" and current_score < 50 and entry_score >= 50:
        return True
    if entry_direction == "short" and current_score > 50 and entry_score <= 50:
        return True

    # Composite too weak
    if abs(current_composite) < 0.20:
        return True

    # Momentum flip: vel_7d reverses > 0.5 pts from entry direction
    if entry_direction == "long" and vel_7d < -0.5:
        return True
    if entry_direction == "short" and vel_7d > 0.5:
        return True

    return False


if __name__ == "__main__":
    # Test 1: Strong RISK_ON tailwind
    sig = compute_composite_signal(
        score=72,
        score_history=[55, 58, 61, 64, 66, 68, 70, 72],  # 8 pts, rising
        industry_scores=[68, 70, 72, 74],
        macro_state={"vix": 15, "hy_oas": 320, "t10y2y": 0.2, "stlfsi4": 0.1}
    )
    assert sig["direction"] == "long", f"Test 1 failed: {sig}"
    assert sig["regime"] == "RISK_ON", f"Test 1 regime failed: {sig}"
    assert sig["position_pct"] > 0.05, f"Test 1 position too small: {sig}"
    print("Test 1 PASS:", sig["direction"], sig["regime"], f"pos={sig['position_pct']:.3f}")

    # Test 2: CRISIS regime reduces position
    sig_crisis = compute_composite_signal(
        score=72,
        score_history=[55, 58, 61, 64, 66, 68, 70, 72],
        industry_scores=[68, 70, 72, 74],
        macro_state={"vix": 40, "hy_oas": 800, "t10y2y": -0.5, "stlfsi4": 3.0}
    )
    assert sig_crisis["regime"] == "CRISIS", f"Test 2 crisis failed: {sig_crisis}"
    # CRISIS: even if long signal, position should be much smaller or flat
    print("Test 2 PASS:", sig_crisis["direction"], sig_crisis["regime"], f"pos={sig_crisis['position_pct']:.3f}")

    # Test 3: Neutral zone → flat
    sig_flat = compute_composite_signal(
        score=51,  # neutral zone
        score_history=[50]*15,
        industry_scores=[50, 51, 49, 52],
        macro_state={"vix": 18, "hy_oas": 400, "t10y2y": 0.0, "stlfsi4": 0.5}
    )
    assert sig_flat["direction"] == "flat", f"Test 3 failed: {sig_flat}"
    print("Test 3 PASS:", sig_flat["direction"], f"composite={sig_flat['composite']:.3f}")

    print("\nAll tests passed!")
