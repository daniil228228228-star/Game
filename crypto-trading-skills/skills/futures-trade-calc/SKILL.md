---
name: futures-trade-calc
description: Position, stop, take-profit and liquidation calculator for isolated-margin USDT perpetual futures (Bybit-style). Use whenever the user wants to size a futures trade, asks what leverage is safe, or wants levels checked against a screenshot of their position.
---

# futures-trade-calc

## How to use
`python3 calc.py --side long|short --entry PRICE --margin USDT --leverage X --stop-pct P --tp-pct Q`

It prints position size, stop and take-profit prices, money lost at the stop and gained at the target (taker fees included),
approximate liquidation price, reward/risk and the break-even win rate, and warns if liquidation is too close to the stop.

## Rules of thumb this project settled on
- Isolated margin only; stop and take-profit are set **in the order form** at entry; close manually after ~24h if neither hit.
- Stop at about 2x the 1h ATR (1-3% on majors). Liquidation must be well beyond the stop (check the warning).
- Leverage up to 10x; above 10x a normal 1% hourly move eats a large part of the margin.
- Do not raise size or leverage after a win. Risk per trade should stay a small fraction of the account.
- No short-term signal tested had an edge after fees, so present any setup as a coin flip with capped loss, never as a forecast.
