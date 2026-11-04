exec(open("research.py").read().split('half=len(days)//2')[0])
import datetime as dt
def date(d): return dt.datetime.fromtimestamp(d/1000,dt.timezone.utc).strftime("%Y-%m-%d")
LEN=(50,100,200)
def weights(c,i,lens=LEN):
    return sum(1 for n in lens if c[i]>sum(c[i-n+1:i+1])/n)/len(lens)
def run(ks,fee=FEE,lens=LEN,start=250,lag=1):
    cs=[ser(k) for k in ks]; w=[0]*len(ks); eq=1; path=[]; rets=[]
    for i in range(start,len(days)-1):
        new=[weights(c,i,lens) for c in cs]
        r=0
        for j,c in enumerate(cs):
            r+=(c[i+1]/c[i]-1)*new[j]/len(ks) - fee*abs(new[j]-w[j])/len(ks)
        w=new; eq*=1+r; path.append((days[i+1],eq)); rets.append(r)
    return path,rets
def bh(ks,start=250):
    cs=[ser(k) for k in ks]; eq=1; path=[]; rets=[]
    for i in range(start,len(days)-1):
        r=sum(c[i+1]/c[i]-1 for c in cs)/len(cs); eq*=1+r; path.append((days[i+1],eq)); rets.append(r)
    return path,rets
def mdd(path):
    p=1;m=0
    for _,e in path: p=max(p,e); m=min(m,e/p-1)
    return m
def summ(path,rets,label):
    eq=path[-1][1]; yrs=len(rets)/365; cagr=eq**(1/yrs)-1
    sh=st.mean(rets)/st.pstdev(rets)*math.sqrt(365)
    print(f"{label:28} CAGR {cagr:+6.0%} Sharpe {sh:+.2f} maxDD {mdd(path):6.0%} x{eq:.1f}")
print("period:",date(days[250]),"->",date(days[-1]))
print("== Ensemble (weight = share of SMA50/100/200 that are bullish), daily rebalance, fee 0.1% on turnover ==")
for ks,lab in (( ["BTC"],"BTC"),(["ETH"],"ETH"),(["BTC","ETH"],"50/50 BTC+ETH")):
    p,r=run(ks); summ(p,r,lab+" ensemble"); p2,r2=bh(ks); summ(p2,r2,lab+" buy&hold")
print("\n== By 2-year slices (return, maxDD inside slice) ==")
slices=[("2018-01-01","2019-12-31"),("2020-01-01","2021-12-31"),("2022-01-01","2023-12-31"),("2024-01-01","2026-12-31")]
P,R=run(["BTC","ETH"]); BP,BR=bh(["BTC","ETH"])
for a,b in slices:
    ta=dt.datetime.fromisoformat(a).replace(tzinfo=dt.timezone.utc).timestamp()*1000; tb=dt.datetime.fromisoformat(b).replace(tzinfo=dt.timezone.utc).timestamp()*1000
    def cut(path): 
        s=[(d,e) for d,e in path if ta<=d<=tb]; base=s[0][1]; s=[(d,e/base) for d,e in s]; return s[-1][1]-1, mdd(s)
    e=cut(P); b_=cut(BP); print(f"{a[:4]}-{b[:4]}: ensemble {e[0]:+6.0%} (DD {e[1]:5.0%}) | buy&hold {b_[0]:+6.0%} (DD {b_[1]:5.0%})")
print("\n== Robustness: BTC single SMA(n) CAGR and share of 2y-slices positive, n=20..300 ==")
for n in range(20,301,20):
    p,r=run(["BTC"],lens=(n,),start=300); cagr=p[-1][1]**(365/len(r))-1
    pos=0;tot=0
    for a,b in slices:
        ta=dt.datetime.fromisoformat(a).replace(tzinfo=dt.timezone.utc).timestamp()*1000; tb=dt.datetime.fromisoformat(b).replace(tzinfo=dt.timezone.utc).timestamp()*1000
        s=[(d,e) for d,e in p if ta<=d<=tb]
        if s: tot+=1; pos+= s[-1][1]/s[0][1]>1
    print(f"SMA{n:3d}: CAGR {cagr:+5.0%}  positive slices {pos}/{tot}")
print("\n== Cost sensitivity (50/50 ensemble): fee per side ==")
for f in (0.001,0.002,0.005): p,r=run(["BTC","ETH"],fee=f); summ(p,r,f"fee {f*100:.1f}%")
print("\n== Dollar view (50/50 BTC+ETH ensemble vs buy&hold, start 2018-01) ==")
i0=next(i for i,(d,_) in enumerate(P) if d>=1514764800000)
for cap in (100,500,1000):
    e=P[-1][1]/P[i0][1]*cap; b=BP[-1][1]/BP[i0][1]*cap
    # worst peak-to-trough in dollars on ensemble from 2018
    s=[(d,x/P[i0][1]*cap) for d,x in P[i0:]]; pk=0;w=0
    for _,x in s: pk=max(pk,x); w=min(w,x-pk)
    print(f"${cap:5d}: ensemble -> ${e:,.0f} | buy&hold -> ${b:,.0f} | worst drawdown ${w:,.0f}")
print("\n== Today ==")
for ks in (["BTC"],["ETH"]):
    c=ser(ks[0]); i=len(c)-2; print(ks[0],"target weight now: %.0f%% (SMA50/100/200 bullish: %s)"%(100*weights(c,i),[c[i]>sum(c[i-n+1:i+1])/n for n in LEN]))
