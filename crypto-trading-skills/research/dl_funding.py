import json, subprocess, time
COINS=["BTC","ETH","SOL","XRP","DOGE","ADA","LINK","AVAX"]
start=1761397200000-8*3600_000  # about start of data window
import sys
for k in COINS:
    out={}; s=start
    for _ in range(40):
        p=subprocess.run(["curl","-sS","-m","25","-X","POST","https://api.hyperliquid.xyz/info","-H","content-type: application/json","-d",json.dumps({"type":"fundingHistory","coin":k,"startTime":s})],capture_output=True,text=True)
        try: r=json.loads(p.stdout)
        except Exception: print(k,"bad",p.stdout[:100]); break
        if not r: break
        for x in r: out[x["time"]]=float(x["fundingRate"])
        s=r[-1]["time"]+1
        if len(r)<500: break
        time.sleep(0.2)
    json.dump(sorted(out.items()),open(f"fund/{k}.json","w"))
    print(k,len(out))
