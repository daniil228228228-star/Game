import sys, json, time, random, pandas as pd
import os; sys.path.insert(0, os.environ.get("KRONOS_PATH", "./Kronos"))
from model import Kronos, KronosTokenizer, KronosPredictor
tok=KronosTokenizer.from_pretrained("NeoQuasar/Kronos-Tokenizer-base"); mdl=Kronos.from_pretrained("NeoQuasar/Kronos-small")
pred=KronosPredictor(mdl,tok,device="cpu",max_context=512)
COLS=["open","high","low","close","volume","amount"]; H=24; L=400
def load(k):
    d={}
    for n in range(1,10):
        for x in json.load(open(f"yr/{k}.{n}.json")): d[x[0]]=x
    rows=sorted(d.values())
    return pd.DataFrame({"timestamps":pd.to_datetime([r[0] for r in rows],unit="ms"),"open":[float(r[1]) for r in rows],"high":[float(r[2]) for r in rows],"low":[float(r[3]) for r in rows],"close":[float(r[4]) for r in rows],"volume":[float(r[5]) for r in rows],"amount":[float(r[7]) for r in rows]}).iloc[:-1]
out=[]; t0=time.time()
for k in ["BTC","ETH","SOL","XRP","DOGE","LINK","AVAX"]:
    D=load(k); random.seed(21); ends=sorted(random.sample(range(L+10,len(D)-H-2),30))
    for s in range(0,30,10):
        xs=[];xts=[];yts=[]
        for e in ends[s:s+10]:
            x=D.iloc[e-L+1:e+1]; xs.append(x[COLS]); xts.append(x["timestamps"].reset_index(drop=True))
            yts.append(pd.Series(pd.date_range(x["timestamps"].iloc[-1]+pd.Timedelta(hours=1),periods=H,freq="h")))
        res=pred.predict_batch(xs,xts,yts,pred_len=H,T=1.0,top_p=0.9,sample_count=3,verbose=False)
        for e,p in zip(ends[s:s+10],res):
            c0=D["close"].iloc[e]; fut=D.iloc[e+1:e+1+H]
            out.append({"coin":k,"end":e,"pred8":float(p["close"].iloc[7]/c0-1),"pred24":float(p["close"].iloc[-1]/c0-1),
                        "act8":float(D["close"].iloc[e+8]/c0-1),"act24":float(D["close"].iloc[e+H]/c0-1),
                        "hi":float(fut["high"].max()/c0-1),"lo":float(fut["low"].min()/c0-1)})
        pd.DataFrame(out).to_csv("kr4.csv",index=False)
    print(k,"done %.0fs"%(time.time()-t0),flush=True)
print("ALL DONE",flush=True)
