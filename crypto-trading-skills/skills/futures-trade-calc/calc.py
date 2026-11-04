#!/usr/bin/env python3
"""Position calculator for isolated-margin USDT perpetuals (Bybit-style). Standard library only.

Example:
  python3 calc.py --side short --entry 9.04 --margin 2 --leverage 10 --stop-pct 2.5 --tp-pct 3.75
Prints: position size, stop/TP prices, money at stop and at TP (fees included), approximate liquidation,
and a warning when liquidation is too close to the stop. Liquidation is an estimate (maintenance margin ~0.5%).
"""
import argparse

ap = argparse.ArgumentParser()
ap.add_argument("--side", choices=["long", "short"], required=True)
ap.add_argument("--entry", type=float, required=True)
ap.add_argument("--margin", type=float, required=True, help="USDT put into the position")
ap.add_argument("--leverage", type=float, required=True)
ap.add_argument("--stop-pct", type=float, required=True, help="stop distance in percent of price")
ap.add_argument("--tp-pct", type=float, required=True, help="take-profit distance in percent of price")
ap.add_argument("--fee", type=float, default=0.00055, help="taker fee per side (Bybit linear default 0.055%%)")
ap.add_argument("--mmr", type=float, default=0.005, help="assumed maintenance margin rate")
a = ap.parse_args()

d = 1 if a.side == "long" else -1
notional = a.margin * a.leverage
qty = notional / a.entry
stop = a.entry * (1 - d * a.stop_pct / 100)
tp = a.entry * (1 + d * a.tp_pct / 100)
liq = a.entry * (1 - d * (1 / a.leverage - a.mmr))
fees = notional * a.fee * 2
loss = notional * a.stop_pct / 100 + fees
gain = notional * a.tp_pct / 100 - fees
liq_dist = abs(liq / a.entry - 1) * 100

print(f"{a.side.upper()} {qty:.4f} units (position ${notional:.2f}, margin ${a.margin:.2f}, {a.leverage:g}x isolated)")
print(f"entry {a.entry:g} | stop {stop:.4f} | take-profit {tp:.4f} | liquidation ~{liq:.4f} ({liq_dist:.1f}% away)")
print(f"loss at stop  ${-loss:+.2f} ({loss / a.margin * 100:.0f}% of margin)")
print(f"gain at TP    ${gain:+.2f} ({gain / a.margin * 100:.0f}% of margin)")
print(f"reward/risk {gain / loss:.2f} | break-even win rate {loss / (loss + gain) * 100:.0f}%")
if liq_dist < a.stop_pct * 1.5:
    print("WARNING: liquidation is too close to the stop (price may jump past the stop first). Lower the leverage.")
if a.leverage > 10:
    print("NOTE: above 10x a normal 1% hourly move uses a large part of the margin.")
