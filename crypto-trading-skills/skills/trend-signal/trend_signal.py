#!/usr/bin/env python3
"""Daily trend signal for BTC/ETH spot (no leverage). Standard library only.

Rule (the only idea in this project that held up in every 2-year slice since 2018):
  * target weight = share of SMA50 / SMA100 / SMA200 that the last COMPLETED daily close is above
    (0, 1/3, 2/3 or 1), the rest in cash (USDT)
  * breakout info: close vs 20-day high (entry) and 10-day low (exit) is shown for context

Usage:  python3 trend_signal.py            (BTC and ETH)
        python3 trend_signal.py BTC SOL    (any Binance spot symbol base)
Data:   https://data-api.binance.vision (public, no key). Not financial advice.
"""
import json, sys, urllib.request, datetime as dt

def closes(sym, limit=400):
    url = f"https://data-api.binance.vision/api/v3/klines?symbol={sym}USDT&interval=1d&limit={limit}"
    req = urllib.request.Request(url, headers={"User-Agent": "crypto-trading-skills/1.0"})
    rows = json.load(urllib.request.urlopen(req, timeout=20))[:-1]   # drop today's unfinished candle
    return [(r[0], float(r[4])) for r in rows]

def sma(c, n): return sum(c[-n:]) / n

def report(sym):
    data = closes(sym)
    c = [x[1] for x in data]
    day = dt.datetime.fromtimestamp(data[-1][0] / 1000, dt.timezone.utc).strftime("%Y-%m-%d")
    lens = (50, 100, 200)
    above = [c[-1] > sma(c, n) for n in lens]
    w = sum(above) / len(lens)
    hi20, lo10 = max(c[-21:-1]), min(c[-11:-1])
    print(f"{sym}: close {c[-1]:.4f} ({day})")
    for n, a in zip(lens, above):
        print(f"   SMA{n}: {sma(c, n):.4f}  -> {'above (bullish)' if a else 'below'}")
    print(f"   20d high {hi20:.4f} ({(c[-1]/hi20-1)*100:+.1f}%)   10d low {lo10:.4f} ({(c[-1]/lo10-1)*100:+.1f}%)")
    print(f"   TARGET WEIGHT: {w*100:.0f}% in {sym}, {100-w*100:.0f}% in USDT\n")

if __name__ == "__main__":
    for s in (sys.argv[1:] or ["BTC", "ETH"]):
        try: report(s.upper())
        except Exception as e: print(f"{s}: failed ({e})")
