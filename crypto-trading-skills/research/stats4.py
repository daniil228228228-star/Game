import csv, statistics as st, math, collections
r=list(csv.DictReader(open("kr4.csv"))); 
def block(rows,tag):
    for hz in ("8","24"):
        P=[float(x["pred"+hz]) for x in rows]; A=[float(x["act"+hz]) for x in rows]; n=len(P)
        if n<10: continue
        acc=sum((p>0)==(a>0) for p,a in zip(P,A))/n
        ma,mp=st.mean(A),st.mean(P)
        c=sum((a-ma)*(p-mp) for a,p in zip(A,P))/math.sqrt(sum((a-ma)**2 for a in A)*sum((p-mp)**2 for p in P))
        print(f"{tag:6} {hz:>2}h n={n:3d} accuracy={acc:4.0%} (+-{100*1.96*math.sqrt(.25/n):.0f}%) corr={c:+.2f} (noise +-{1.96/math.sqrt(n):.2f}) pred up {sum(p>0 for p in P)/n:.0%} actual up {sum(a>0 for a in A)/n:.0%}")
block(r,"ALL")
for k in ["BTC","ETH","SOL","XRP","DOGE","LINK","AVAX"]: block([x for x in r if x["coin"]==k],k)
# strong predictions only, 24h
for thr in (0.02,0.03):
    s=[x for x in r if float(x["pred24"])>thr]; t=[x for x in r if float(x["pred24"])<-thr]
    if s: print(f"pred24>+{thr:.0%}: n={len(s)} actual mean {st.mean(float(x['act24']) for x in s):+.2%} up {sum(float(x['act24'])>0 for x in s)/len(s):.0%}")
    if t: print(f"pred24<-{thr:.0%}: n={len(t)} actual mean {st.mean(float(x['act24']) for x in t):+.2%} up {sum(float(x['act24'])>0 for x in t)/len(t):.0%}")
# trade sim: long if pred24>0, short if <0, SL2/TP4 using hi/lo can't know order for short; use 24h close only
res=[]
for x in r:
    p=float(x["pred24"]); a=float(x["act24"]); d=1 if p>0 else -1; res.append(d*a-0.0011)
print("sign-trade 24h hold, fees included: n=%d avg=%+.3f%% win=%.0f%%"%(len(res),100*st.mean(res),100*sum(v>0 for v in res)/len(res)))
