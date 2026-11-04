import json, math, numpy as np, warnings; warnings.filterwarnings("ignore")
from arch import arch_model
COINS=["ADA","BTC","ETH","SOL","XRP","DOGE","LINK","AVAX"]
def closes(k):
    d={}
    for n in range(1,10):
        for x in json.load(open(f"yr/{k}.{n}.json")): d[x[0]]=x
    return np.array([float(x[4]) for _,x in sorted(d.items())][:-1]),np.array([x[0] for _,x in sorted(d.items())][:-1])
print("coin  last   1h-sigma  24h-sigma(GARCH)  24h-sigma(naive 7d)  P(touch -2%)  P(touch -3%)  P(touch +4%)")
for k in COINS:
    c,_=closes(k); r=100*np.diff(np.log(c))
    am=arch_model(r[-3000:],vol="GARCH",p=1,q=1,dist="t",mean="Zero"); res=am.fit(disp="off")
    f=res.forecast(horizon=24); var=f.variance.values[-1]; s24=math.sqrt(var.sum()); s1=math.sqrt(var[0])
    naive=100*np.std(np.diff(np.log(c))[-168:])*math.sqrt(24)
    # prob. of touching a barrier within 24h (reflection principle, driftless)
    from math import erf, sqrt
    Phi=lambda x:0.5*(1+erf(x/sqrt(2)))
    touch=lambda b:2*(1-Phi(b/s24))
    print(f"{k:5} {c[-1]:9.4f} {s1:6.2f}%   {s24:6.2f}%          {naive:6.2f}%          {touch(2):4.0%}          {touch(3):4.0%}          {touch(4):4.0%}")
# walk-forward quality check for ADA & others: does GARCH forecast of 24h vol track realized 24h move?
import statistics as st
print("\nWalk-forward check (refit every 24h, last 120 days): corr(predicted 24h sigma, realized |24h return|) vs naive")
for k in ["ADA","SOL","BTC"]:
    c,_=closes(k); r=100*np.diff(np.log(c)); P=[];N=[];A=[]
    start=len(r)-120*24
    for i in range(start,len(r)-24,24):
        am=arch_model(r[max(0,i-2000):i],vol="GARCH",p=1,q=1,dist="t",mean="Zero"); res=am.fit(disp="off",show_warning=False)
        P.append(math.sqrt(res.forecast(horizon=24).variance.values[-1].sum())); N.append(np.std(r[i-168:i])*math.sqrt(24)); A.append(abs(r[i:i+24].sum()))
    cor=lambda a,b:float(np.corrcoef(a,b)[0,1])
    print(f"{k}: n={len(A)} corr(GARCH,realized)={cor(P,A):+.2f}  corr(naive7d,realized)={cor(N,A):+.2f}")
