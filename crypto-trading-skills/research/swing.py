exec(open("research.py").read().split('half=len(days)//2')[0])
import datetime as dt
SL=[("2018-01-01","2019-12-31"),("2020-01-01","2021-12-31"),("2022-01-01","2023-12-31"),("2024-01-01","2026-12-31")]
def ts(s): return dt.datetime.fromisoformat(s).replace(tzinfo=dt.timezone.utc).timestamp()*1000
def sim(k,rule,short=False):
    c=ser(k); pos=0; out=[]
    for i in range(210,len(c)-1):
        if not(c[i] and c[i+1]): continue
        sig=rule(c,i)          # +1 long, 0 flat, -1 short
        if not short and sig<0: sig=0
        r=(c[i+1]/c[i]-1)*sig-FEE*abs(sig-pos); pos=sig; out.append((days[i+1],r))
    return out
def sma_rule(n): return lambda c,i: 1 if c[i]>sum(c[i-n+1:i+1])/n else -1
def don_rule(n):
    def f(c,i):
        hi=max(c[i-n:i]); lo=min(c[i-n:i])
        if c[i]>hi: f.p=1
        elif c[i]<lo: f.p=-1
        elif c[i]<sum(c[i-n:i])/n and f.p==1 : f.p=0
        return f.p
    f.p=0; return f
def report(label,out):
    r=[x for _,x in out]; eq=1; pk=1; dd=0
    for x in r: eq*=1+x; pk=max(pk,eq); dd=min(dd,eq/pk-1)
    cagr=eq**(365/len(r))-1; sh=st.mean(r)/st.pstdev(r)*math.sqrt(365) if st.pstdev(r)>0 else 0
    sl=[]
    for a,b in SL:
        e=1
        for d,x in out:
            if ts(a)<=d<=ts(b): e*=1+x
        sl.append(e-1)
    print(f"{label:34} CAGR {cagr:+5.0%} Sh {sh:+.2f} DD {dd:5.0%} | slices: "+" ".join(f"{s:+5.0%}" for s in sl)+f" | {sum(s>0 for s in sl)}/4 up")
for k in ("BTC","ETH"):
    print("---",k)
    for n in (5,10,20,30,50): report(f"{k} long-only SMA{n}",sim(k,sma_rule(n)))
    for n in (10,20,30,50): report(f"{k} long/short SMA{n}",sim(k,sma_rule(n),True))
    for n in (10,20,55): report(f"{k} long Donchian{n}",sim(k,don_rule(n)))
