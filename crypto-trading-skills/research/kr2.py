import sys, json, time, random, numpy as np, pandas as pd
import os; sys.path.insert(0, os.environ.get("KRONOS_PATH", "./Kronos"))
from model import Kronos, KronosTokenizer, KronosPredictor
tok=KronosTokenizer.from_pretrained("NeoQuasar/Kronos-Tokenizer-base"); mdl=Kronos.from_pretrained("NeoQuasar/Kronos-small")
pred=KronosPredictor(mdl,tok,device="cpu",max_context=512)
COINS=["BTC","ETH","SOL","XRP","DOGE","ADA","LINK","AVAX"]; COLS=["open","high","low","close","volume","amount"]
def load(k):
    d={}
    for n in range(1,10):
        for x in json.load(open(f"yr/{k}.{n}.json")): d[x[0]]=x
    rows=sorted(d.values())
    return pd.DataFrame({"timestamps":pd.to_datetime([r[0] for r in rows],unit="ms"),"open":[float(r[1]) for r in rows],"high":[float(r[2]) for r in rows],"low":[float(r[3]) for r in rows],"close":[float(r[4]) for r in rows],"volume":[float(r[5]) for r in rows],"amount":[float(r[7]) for r in rows]}).iloc[:-1]
D={k:load(k) for k in COINS}
H=24; L=400
def run(items,sc):
    xs=[];xts=[];yts=[]
    for k,e in items:
        x=D[k].iloc[e-L+1:e+1]; xs.append(x[COLS]); xts.append(x["timestamps"].reset_index(drop=True))
        yts.append(pd.Series(pd.date_range(x["timestamps"].iloc[-1]+pd.Timedelta(hours=1),periods=H,freq="h")))
    return pred.predict_batch(xs,xts,yts,pred_len=H,T=1.0,top_p=0.9,sample_count=sc,verbose=False)
# 1) LIVE forecast
t0=time.time()
live=run([(k,len(D[k])-1) for k in COINS],20)
out={}
for k,p in zip(COINS,live):
    last=D[k]["close"].iloc[-1]
    out[k]={"last":last,"pred24":float(p["close"].iloc[-1]),"pred_ret":float(p["close"].iloc[-1]/last-1),"pred_hi":float(p["high"].max()),"pred_lo":float(p["low"].min())}
json.dump(out,open("kr_live.json","w")); print("live done %.0fs"%(time.time()-t0),flush=True)
# 2) BACKTEST
random.seed(7); rows=[]
for k in COINS:
    ends=sorted(random.sample(range(L+10,len(D[k])-H-2),40)); items=[(k,e) for e in ends]
    res=run(items,5)
    for (kk,e),p in zip(items,res):
        c0=D[k]["close"].iloc[e]; act=D[k]["close"].iloc[e+H]/c0-1; pr=float(p["close"].iloc[-1]/c0-1)
        rows.append((k,e,pr,act))
    print(k,"done %.0fs"%(time.time()-t0),flush=True)
pd.DataFrame(rows,columns=["coin","end","pred","act"]).to_csv("kr_bt.csv",index=False); print("ALL DONE",flush=True)
