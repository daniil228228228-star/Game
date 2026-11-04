import sys, json, time, random, pandas as pd
import os; sys.path.insert(0, os.environ.get("KRONOS_PATH", "./Kronos"))
from model import Kronos, KronosTokenizer, KronosPredictor
tok=KronosTokenizer.from_pretrained("NeoQuasar/Kronos-Tokenizer-base"); mdl=Kronos.from_pretrained("NeoQuasar/Kronos-small")
pred=KronosPredictor(mdl,tok,device="cpu",max_context=512)
COLS=["open","high","low","close","volume","amount"]; H=24; L=400
d={}
for n in range(1,10):
    for x in json.load(open(f"yr/ADA.{n}.json")): d[x[0]]=x
rows=sorted(d.values())
D=pd.DataFrame({"timestamps":pd.to_datetime([r[0] for r in rows],unit="ms"),"open":[float(r[1]) for r in rows],"high":[float(r[2]) for r in rows],"low":[float(r[3]) for r in rows],"close":[float(r[4]) for r in rows],"volume":[float(r[5]) for r in rows],"amount":[float(r[7]) for r in rows]}).iloc[:-1]
random.seed(11); ends=sorted(random.sample(range(L+10,len(D)-H-2),50))
xs=[];xts=[];yts=[]
for e in ends:
    x=D.iloc[e-L+1:e+1]; xs.append(x[COLS]); xts.append(x["timestamps"].reset_index(drop=True))
    yts.append(pd.Series(pd.date_range(x["timestamps"].iloc[-1]+pd.Timedelta(hours=1),periods=H,freq="h")))
t0=time.time(); out=[]
for s in range(0,len(ends),10):   # chunks so partial results are saved
    res=pred.predict_batch(xs[s:s+10],xts[s:s+10],yts[s:s+10],pred_len=H,T=1.0,top_p=0.9,sample_count=5,verbose=False)
    for e,p in zip(ends[s:s+10],res):
        c0=D["close"].iloc[e]; fut=D.iloc[e+1:e+1+H]
        out.append({"end":e,"pred":float(p["close"].iloc[-1]/c0-1),"act":float(D["close"].iloc[e+H]/c0-1),"hi":float(fut["high"].max()/c0-1),"lo":float(fut["low"].min()/c0-1)})
    pd.DataFrame(out).to_csv("kr3.csv",index=False); print("done",len(out),"in %.0fs"%(time.time()-t0),flush=True)
print("ALL DONE",flush=True)
