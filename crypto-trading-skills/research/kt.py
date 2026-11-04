import json, random, time, csv, numpy as np, torch
H=24; L=400
def load(k):
    d={}
    for n in range(1,10):
        for x in json.load(open(f"yr/{k}.{n}.json")): d[x[0]]=x
    rows=sorted(d.values()); return np.array([float(r[4]) for r in rows][:-1],dtype=np.float32)
COINS=["BTC","ETH","SOL","XRP","DOGE","LINK","AVAX"]
pts=[]
for k in COINS:
    c=load(k); random.seed(21); ends=sorted(random.sample(range(L+10,len(c)-H-2),30))
    for e in ends: pts.append((k,e,c[e-L+1:e+1].copy(),float(c[e]),float(c[e+8]),float(c[e+H])))
print("points",len(pts),flush=True)
t0=time.time()
from chronos import Chronos2Pipeline
pipe=Chronos2Pipeline.from_pretrained("amazon/chronos-2",device_map="cpu")
try:
    q,_=pipe.predict_quantiles([torch.tensor(p[2]) for p in pts],prediction_length=H,quantile_levels=[0.5])
    ch=[x[0,:,0].numpy() for x in q]   # (variate=1, pred_len, quantile=1)
except Exception as e:
    print("predict_quantiles failed:",e); out=pipe.predict([torch.tensor(p[2]) for p in pts],prediction_length=H)
    ch=[x[0,x.shape[1]//2,:].numpy() for x in out]
print("chronos done %.0fs"%(time.time()-t0),flush=True)
import timesfm
m=timesfm.TimesFM_2p5_200M_torch.from_pretrained("google/timesfm-2.5-200m-pytorch")
m.compile(timesfm.ForecastConfig(max_context=512,max_horizon=64,normalize_inputs=True,use_continuous_quantile_head=True,force_flip_invariance=True,infer_is_positive=True,fix_quantile_crossing=True))
pt,_=m.forecast(horizon=H,inputs=[p[2] for p in pts])
print("timesfm done %.0fs"%(time.time()-t0),flush=True)
with open("kt.csv","w",newline="") as f:
    w=csv.writer(f); w.writerow(["coin","end","c0","act8","act24","ch8","ch24","tf8","tf24"])
    for p,a,b in zip(pts,ch,pt):
        c0=p[3]; w.writerow([p[0],p[1],c0,p[4]/c0-1,p[5]/c0-1,a[7]/c0-1,a[23]/c0-1,b[7]/c0-1,b[23]/c0-1])
print("ALL DONE",flush=True)
