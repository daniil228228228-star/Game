---
name: trend-signal
description: Daily trend-following signal for BTC/ETH spot (no leverage). Use when the user asks whether to be in BTC/ETH or in cash, wants the long-horizon "profitable strategy", asks what the SMA50/100/200 rule says today, or wants a rough 8-month outcome range. Not for intraday signals (none were found profitable).
---

# trend-signal

The only idea in this project with out-of-sample support: since 2018 BTC trend-following was positive in every
2-year slice for all SMA lengths 40-300 (fees 0.1%). It mainly avoids bear-market drawdowns; max drawdown is still ~-47%.

## How to use
1. Run `python3 trend_signal.py` (BTC and ETH) or `python3 trend_signal.py SOL`. It reads public Binance Vision data, no key.
2. Report: last completed daily close, SMA50/100/200 status, 20-day high / 10-day low, and the **target weight**
   (share of SMA50/100/200 the close is above: 0, 1/3, 2/3, 1; the rest stays in USDT).
3. Spot only, no leverage. Check once a day after 00:00 UTC; change the position only when the weight changes.
4. Always add the caveats: history is BTC/ETH survivors in a huge bull market, expect much less, drawdowns of
   30-50% are normal, this is accumulation not "stable cash", not financial advice.

## Reference numbers (50/50 BTC+ETH ensemble, 2018-2026, fee 0.1%)
CAGR +45%, Sharpe 1.07, max drawdown -47% (buy&hold: +25%, -81%). Rolling 8-month windows: median +18%,
10th percentile -17%, worst -36%, positive in 73% (last 3 years: median +13%, worst -26%).
Conversion fees (P2P) of 1-3% each way and FX moves are NOT included.
