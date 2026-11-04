import json, math, statistics as st
COINS=["BTC","ETH","SOL","XRP","DOGE","ADA","LINK","AVAX"]; FEE=0.00055*2; H=24
def load(k):
    d={}
    for n in range(1,10):
        for x in json.load(open(f"yr/{k}.{n}.json")): d[x[0]]=x
    return {x[0]//3600000:(float(x[1]),float(x[4])) for x in sorted(d.values())}   # hour -> (open,close)
def lf(k):
    d={}
    for t,r in json.load(open(f"fund/{k}.json")): d[t//3600000]=r
    return d
P={k:load(k) for k in COINS}; F={k:lf(k) for k in COINS}
hours=sorted(set.intersection(*[set(P[k]) for k in COINS]))
h0,h1=hours[0],hours[-1]; mid=(h0+h1)//2
def close(k,h): return P[k][h][1]
def opn(k,h): return P[k][h][0]
def fsum(k,a,b): return sum(F[k].get(h,0) for h in range(a,b))
def favg(k,a,b):
    v=[F[k][h] for h in range(a,b) if h in F[k]]; return sum(v)/len(v) if v else None
def pnl(k,h,d):  # enter at open of hour h+1, exit open h+1+24
    e=opn(k,h+1); x=opn(k,h+1+H)
    return d*(x/e-1)-FEE-d*fsum(k,h+1,h+1+H)
def zf(k,h):
    cur=favg(k,h-23,h+1); hist=[favg(k,s-23,s+1) for s in range(h-720,h,24)]
    hist=[x for x in hist if x is not None]
    if cur is None or len(hist)<15: return None
    sd=st.pstdev(hist); return (cur-st.mean(hist))/sd if sd>0 else None
def sma(k,h,n): return sum(close(k,x) for x in range(h-n+1,h+1))/n
R={}
def add(name,h,r): R.setdefault(name,[]).append((h,r))
for off in (0,12):
  hs=[h for h in hours if h%24==off and h-720>=h0 and h+30<=h1]
  for h in hs:
    # per coin rules
    for k in COINS:
        z=zf(k,h)
        if z is not None:
            if z>2: add(f"funding z>2 short @{off}h",h,pnl(k,h,-1))
            if z<-2: add(f"funding z<-2 long @{off}h",h,pnl(k,h,+1))
        r72=close(k,h)/close(k,h-72)-1; r168=close(k,h)/close(k,h-168)-1
        if r72<-0.10: add(f"3d drop>10% long @{off}h",h,pnl(k,h,+1))
        if r72>0.10: add(f"3d pump>10% short @{off}h",h,pnl(k,h,-1))
        if r168>0.10: add(f"7d mom>10% long @{off}h",h,pnl(k,h,+1))
        if r168<-0.10: add(f"7d mom<-10% short @{off}h",h,pnl(k,h,-1))
        d=1 if close(k,h)>sma(k,h,480) else -1
        add(f"trend SMA20d always @{off}h",h,pnl(k,h,d))
    # cross-sectional 7d
    rk=sorted(COINS,key=lambda k:close(k,h)/close(k,h-168)-1)
    mom=sum(pnl(k,h,+1) for k in rk[-2:])/4+sum(pnl(k,h,-1) for k in rk[:2])/4
    add(f"x-sec momentum L/S @{off}h",h,mom*2)
    add(f"x-sec reversal L/S @{off}h",h,-sum(pnl(k,h,+1) for k in rk[-2:])/4*0 + (sum(pnl(k,h,+1) for k in rk[:2])/4+sum(pnl(k,h,-1) for k in rk[-2:])/4)*2)
    # funding cross-section: short highest funding 2, long lowest 2
    fk=sorted([k for k in COINS if favg(k,h-23,h+1) is not None],key=lambda k:favg(k,h-23,h+1))
    if len(fk)==8: add(f"x-sec funding L/S @{off}h",h,(sum(pnl(k,h,+1) for k in fk[:2])/4+sum(pnl(k,h,-1) for k in fk[-2:])/4)*2)
print("rule | n | avg%/trade | win | t | 1st half | 2nd half")
rows=[]
for name,L in R.items():
    r=[x[1] for x in L]; n=len(r)
    if n<40: continue
    mu=st.mean(r); sd=st.pstdev(r) or 1e-9; t=mu/(sd/math.sqrt(n))
    a=[x[1] for x in L if x[0]<mid]; b=[x[1] for x in L if x[0]>=mid]
    rows.append((t,name,n,mu*100,sum(x>0 for x in r)/n,st.mean(a)*100 if a else 0,st.mean(b)*100 if b else 0))
for t,name,n,mu,w,a,b in sorted(rows,reverse=True): print(f"{name:34} {n:4d} {mu:+.3f}% {w:4.0%} t={t:+.1f}  {a:+.3f}% {b:+.3f}%")
print("combos:",len(rows)," window days:",(h1-h0)//24)
