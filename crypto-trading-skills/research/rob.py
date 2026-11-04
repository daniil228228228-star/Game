import json, math, statistics as st, datetime as dt
exec(open("scan24.py").read().split("R={}")[0])   # reuse loaders/helpers
def mom_rule(thr, off, lookback=168, d=-1):
    out=[]
    for h in [h for h in hours if h%24==off and h-720>=h0 and h+30<=h1]:
        for k in COINS:
            r=close(k,h)/close(k,h-lookback)-1
            if (d==-1 and r<-thr) or (d==1 and r>thr): out.append((h,k,pnl(k,h,d)))
    return out
def summ(L,label):
    r=[x[2] for x in L]; n=len(r)
    if n<20: print(label,"n",n); return
    mu=st.mean(r); sd=st.pstdev(r); t=mu/(sd/math.sqrt(n))
    days={}
    for h,k,x in L: days.setdefault(h//24,[]).append(x)
    dm=[st.mean(v) for v in days.values()]; td=st.mean(dm)/(st.pstdev(dm)/math.sqrt(len(dm)))
    print(f"{label:30} n={n:4d} avg={mu*100:+.3f}% win={sum(x>0 for x in r)/n:.0%} t={t:+.1f} | day-clustered: {len(dm)} days t={td:+.1f}")
print("== entry hour robustness (rule: 7d return < -10% -> short 24h)")
for off in (0,6,12,18): summ(mom_rule(0.10,off),f"entry {off:02d}:00 UTC")
print("== threshold robustness (entry 12:00)")
for thr in (0.05,0.08,0.10,0.15,0.20): summ(mom_rule(thr,12),f"7d < -{thr*100:.0f}%")
print("== lookback robustness (thr 10%, entry 12:00)")
for lb in (72,120,168,240): summ(mom_rule(0.10,12,lb),f"lookback {lb}h")
print("== per coin (entry 12:00, thr 10%)")
L=mom_rule(0.10,12)
for k in COINS: summ([x for x in L if x[1]==k],k)
print("== by quarter")
byq={}
for x in L: byq.setdefault(dt.datetime.fromtimestamp(x[0]*3600,dt.timezone.utc).strftime("%Y-Q")+str((dt.datetime.fromtimestamp(x[0]*3600,dt.timezone.utc).month-1)//3+1),[]).append(x)
for q,v in sorted(byq.items()): summ(v,q)
print("== opposite (7d > +10% long) for symmetry:"); summ(mom_rule(0.10,12,168,1),"7d > +10% -> long")
# what market did over the window
for k in ("BTC","SOL"): print(k,"window return %+.0f%%"%(100*(close(k,h1)/close(k,h0)-1)))
# adverse excursion in the 24h (using open/close of hourly bars, approx)
adv=[]
for h,k,_ in L:
    e=opn(k,h+1); mx=max(close(k,x) for x in range(h+1,h+26))/e-1; adv.append(mx)
adv.sort(); print("max adverse (price up vs short entry) quantiles 50/75/90/95: "+" ".join("%.1f%%"%(100*adv[int(p*(len(adv)-1))]) for p in (.5,.75,.9,.95)))
# current state
print("== NOW:", dt.datetime.fromtimestamp(h1*3600,dt.timezone.utc).strftime("%Y-%m-%d %H:00 UTC"))
for k in COINS:
    r=close(k,h1)/close(k,h1-168)-1; z=zf(k,h1); fa=favg(k,h1-23,h1+1)
    print(f"{k:5} price {close(k,h1):10.4f}  7d {r*100:+6.1f}%  24h {100*(close(k,h1)/close(k,h1-24)-1):+5.1f}%  funding24h avg {fa*100 if fa is not None else float('nan'):+.4f}%/h  z={z if z is None else round(z,1)}")
