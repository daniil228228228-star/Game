exec(open("ens.py").read().split('print("period:"')[0])
W=240  # ~8 months
P,R=run(["BTC","ETH"]); BP,BR=bh(["BTC","ETH"])
def windows(rets,step=7):
    out=[]
    for a in range(0,len(rets)-W,step):
        e=1
        for x in rets[a:a+W]: e*=1+x
        out.append(e-1)
    return out
def pct(v,p): s=sorted(v); return s[int(p*(len(s)-1))]
CAP=20000
def show(label,v,scale=1.0):
    v=[x*scale for x in v]
    print(f"{label:34} worst {min(v):+5.0%} | 10% {pct(v,.1):+5.0%} | median {pct(v,.5):+5.0%} | 90% {pct(v,.9):+5.0%} | best {max(v):+5.0%} | positive {sum(x>0 for x in v)/len(v):.0%} of {len(v)} windows")
    for lab,p in (("worst",0),("10%",.1),("median",.5),("90%",.9)):
        print(f"      {lab:7} -> {CAP*(1+pct(v,p)):>9,.0f} RUB")
sr=windows(R); br=windows(BR)
print("8-month windows since 2018 (all capital in strategy; BTC+ETH 50/50):")
show("strategy (trend ensemble)",sr)
show("buy & hold BTC+ETH",br)
# last 3 years only
n3=3*365; sr3=windows(R[-n3:]); br3=windows(BR[-n3:])
print("\nOnly last 3 years (2023-2026):")
show("strategy",sr3); show("buy & hold",br3)
# half capital in strategy, half in cash (0% return)
print("\nHalf of capital in strategy, half in cash:")
vh=[x/2 for x in sr]; show("strategy 50% / cash 50%",sr,0.5)
