#!/usr/bin/env python3
"""Download ~1 year of 1h candles from Binance Vision into ./yr/<COIN>.<n>.json (9 pages of 1000 bars each).
Usage: python3 dl_hourly.py [pages] [COIN ...]     default: 9 pages, 8 coins."""
import json, sys, os, time, urllib.request
pages = int(sys.argv[1]) if len(sys.argv) > 1 else 9
coins = sys.argv[2:] or ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "LINK", "AVAX"]
os.makedirs("yr", exist_ok=True)
for k in coins:
    end = int(time.time() * 1000)
    for n in range(1, pages + 1):
        url = f"https://data-api.binance.vision/api/v3/klines?symbol={k}USDT&interval=1h&limit=1000&endTime={end}"
        req = urllib.request.Request(url, headers={"User-Agent": "crypto-trading-skills/1.0"})
        rows = json.load(urllib.request.urlopen(req, timeout=25))
        if not rows: break
        json.dump(rows, open(f"yr/{k}.{n}.json", "w"))
        end = rows[0][0] - 1
    print(k, "ok")
