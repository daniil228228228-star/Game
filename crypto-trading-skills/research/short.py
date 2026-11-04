import json, math, statistics as st, datetime as dt, collections
COINS=["BTC","ETH","SOL","XRP","DOGE","ADA","LINK","AVAX"]; FEE=0.0011
def load(k):
    d={}
    for n in range(1,10):
        for x in json.load(open(f"yr/{k}.{n}.json")): d[x[0]]=x
    return {x[0]//3600000:(float(x[1]),float(x[4])) for x in d.values()}
P={k:load(k) for k in COINS}
hs=sorted(set.intersection(*[set(P[k]) for k in COINS])); H0,H1=hs[0],hs[-1]; MID=(H0+H1)//2
def tstat(v):
    n=len(v); 
    if n<30: return 0
    sd=st.pstdev(v); return st.mean(v)/(sd/math.sqrt(n)) if sd>0 else 0
def hr(h): return h%24
def dow(h): return dt.datetime.fromtimestamp(h*3600,dt.timezone.utc).weekday()
# ---- 1) time-of-day: buy at open of hour X (UTC), hold k hours, pooled over coins (average per day -> day-clustered)
print("== 1) TIME OF DAY (long at open of UTC hour, hold k h) ==  net of 0.11% fees; day-clustered t; 1st half / 2nd half mean")
res=[]
for side in (1,-1):
  for k in (1,2,4,8):
    for X in range(24):
        byday={}
        for h in hs:
            if hr(h)!=X or h+k-1 not in P["BTC"]: continue
            r=sum(side*(P[c][h+k-1][1]/P[c][h][0]-1) for c in COINS)/len(COINS)-FEE
            byday[h//24]=r
        v=list(byday.values()); a=[r for d,r in byday.items() if d*24<MID]; b=[r for d,r in byday.items() if d*24>=MID]
        res.append((tstat(a),tstat(v),side,k,X,st.mean(v),st.mean(a),st.mean(b),len(v)))
res.sort(reverse=True)
print("top by 1st-half t:   side hold hour | all-t   all-mean  1st   2nd")
for t1,t,s,k,X,m,a,b,n in res[:8]: print(f"   {'long ' if s==1 else 'short'} {k}h  {X:02d}:00 | t={t:+.1f} {m*100:+.3f}% {a*100:+.3f}% {b*100:+.3f}%  (n={n})")
print("combos tested:",len(res)," (expect |t|>3 by luck about",round(len(res)*0.0027,1),"times)")
# ---- 2) day of week (daily open->close 24h from 00:00 UTC)
print("\n== 2) DAY OF WEEK (long from 00:00 UTC for 24h) ==")
for wd in range(7):
    v=[];a=[];b=[]
    for h in hs:
        if hr(h)!=0 or dow(h)!=wd or h+23 not in P["BTC"]: continue
        r=sum(P[c][h+23][1]/P[c][h][0]-1 for c in COINS)/len(COINS)-FEE; v.append(r); (a if h<MID else b).append(r)
    print(f"{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][wd]}: mean {st.mean(v)*100:+.2f}% t={tstat(v):+.1f} | 1st {st.mean(a)*100:+.2f}% 2nd {st.mean(b)*100:+.2f}%")
# ---- 3) BTC leads alts
print("\n== 3) BTC LEAD-LAG: after BTC 1h move > +-X, trade alt next hour ==")
alts=[c for c in COINS if c!="BTC"]
for X in (0.005,0.01,0.015):
    for mode,sgn in (("follow BTC",1),("fade BTC",-1)):
        v=[];a=[];b=[]
        for h in hs:
            if h+1 not in P["BTC"]: continue
            m=P["BTC"][h][1]/P["BTC"][h][0]-1
            if abs(m)<X: continue
            d=sgn*(1 if m>0 else -1)
            r=sum(d*(P[c][h+1][1]/P[c][h+1][0]-1) for c in alts)/len(alts)-FEE; v.append(r); (a if h<MID else b).append(r)
        if len(v)>20: print(f"|BTC 1h|>{X*100:.1f}% {mode:10}: n={len(v):3d} mean {st.mean(v)*100:+.3f}% t={tstat(v):+.1f} | 1st {st.mean(a)*100:+.3f}% 2nd {st.mean(b)*100:+.3f}%")
# ---- 4) extreme 1h move continuation / reversal per coin
print("\n== 4) AFTER A BIG 1h MOVE (any coin, move>X in one hour), trade next 1/4 hours ==")
for X in (0.02,0.03,0.04):
    for k in (1,4):
        for mode,sgn in (("continue",1),("reverse",-1)):
            v=[];a=[];b=[]
            for c in COINS:
                for h in hs:
                    if h+k not in P[c]: continue
                    m=P[c][h][1]/P[c][h][0]-1
                    if abs(m)<X: continue
                    d=sgn*(1 if m>0 else -1); r=d*(P[c][h+k][1]/P[c][h+1][0]-1)-FEE; v.append(r); (a if h<MID else b).append(r)
            if len(v)>30: print(f"move>{X*100:.0f}% {mode:8} hold {k}h: n={len(v):3d} mean {st.mean(v)*100:+.3f}% t={tstat(v):+.1f} | 1st {st.mean(a)*100:+.3f}% 2nd {st.mean(b)*100:+.3f}%")
