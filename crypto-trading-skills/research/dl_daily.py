import json, subprocess
COINS=["BTC","ETH","BNB","XRP","ADA","LTC","TRX","LINK","DOGE","XLM"]
for k in COINS:
    rows={}; start=1502928000000  # 2017-08-17
    for _ in range(6):
        p=subprocess.run(["curl","-sS","-m","25",f"https://data-api.binance.vision/api/v3/klines?symbol={k}USDT&interval=1d&limit=1000&startTime={start}"],capture_output=True,text=True)
        try: r=json.loads(p.stdout)
        except Exception: print(k,"bad",p.stdout[:80]); break
        if not r or isinstance(r,dict): break
        for x in r: rows[x[0]]=(x[0],float(x[4]))
        start=r[-1][0]+86400000
        if len(r)<1000: break
    json.dump(sorted(rows.values()),open(f"daily/{k}.json","w")); v=sorted(rows.values()); print(k,len(v),v[0][0]//86400000 if v else None)
