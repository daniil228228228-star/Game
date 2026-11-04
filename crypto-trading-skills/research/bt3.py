import json, statistics as st
def load(k):
    d={}
    for n in (1,2,3):
        for x in json.load(open(f"kl/{k}.{n}.json")): d[x[0]]=x
    return [(x[0],float(x[2]),float(x[3]),float(x[4])) for x in sorted(d.values())]
def sim(c, side, sl=0.04, tp=0.08, fee=0.00055, hold=24, every=24):
    res=[]; i=50
    while i<len(c)-hold-1:
        entry=c[i][3]; r=None
        for j in range(i+1,i+1+hold):
            h,l=c[j][1],c[j][2]
            if side=="long": s_hit=l<=entry*(1-sl); t_hit=h>=entry*(1+tp)
            else: s_hit=h>=entry*(1+sl); t_hit=l<=entry*(1-tp)
            if s_hit: r=-sl; break
            if t_hit: r=tp; break
        if r is None:
            x=c[i+hold][3]; r=(x/entry-1) if side=="long" else (1-x/entry)
        res.append(r-2*fee); i+=every
    return res
tot={"long":[], "short":[]}
for k in ["DOGE","XRP","SOL","ADA","LINK","AVAX"]:
    c=load(k); days=(c[-1][0]-c[0][0])/86400000
    print(f"{k}: {len(c)} bars, {days:.0f} days, last close {c[-1][3]}, 30d move {c[-1][3]/c[-720][3]-1:+.0%}")
    for side in ("long","short"):
        r=sim(c,side); tot[side]+=r; w=sum(x>0 for x in r)/len(r)
        print(f"   {side:5} n={len(r)} win={w:.0%} avg={st.mean(r)*100:+.2f}%/trade")
for s,r in tot.items(): print("ALL",s,len(r),f"avg {st.mean(r)*100:+.2f}%  win {sum(x>0 for x in r)/len(r):.0%}")
