exec(open("research.py").read().split('half=len(days)//2')[0])
import datetime as dt
def date(d): return dt.datetime.fromtimestamp(d/1000,dt.timezone.utc).strftime("%Y-%m-%d")
def bh(k,a,b):
    c=ser(k); return [c[i+1]/c[i]-1 for i in range(a,b) if c[i] and c[i+1]]
print("data range:",date(days[0]),"->",date(days[-1]))
# by calendar slices for BTC: trend (SMA50/100/200) vs buy&hold
slices=[("2018-01-01","2019-12-31"),("2020-01-01","2021-12-31"),("2022-01-01","2023-12-31"),("2024-01-01","2026-12-31")]
def di(s): return min(range(len(days)),key=lambda i:abs(days[i]-dt.datetime.fromisoformat(s).replace(tzinfo=dt.timezone.utc).timestamp()*1000))
for k in ("BTC","ETH"):
    c=ser(k)
    for a,b in slices:
        ia,ib=di(a),min(di(b),len(days)-2)
        row=[]
        for n in (50,100,200):
            pos=0;prev=0;eq=1
            for i in range(max(ia,n),ib):
                if not(c[i] and c[i+1]): continue
                sma=sum(x for x in c[i-n+1:i+1] if x)/n; pos=1 if c[i]>sma else 0
                eq*=1+(c[i+1]/c[i]-1)*pos-(FEE if pos!=prev else 0); prev=pos
            row.append(eq-1)
        e=1
        for r in bh(k,ia,ib): e*=1+r
        print(f"{k} {a[:4]}-{b[:4]}: SMA50 {row[0]:+6.0%}  SMA100 {row[1]:+6.0%}  SMA200 {row[2]:+6.0%} | buy&hold {e-1:+6.0%}")
print("\nCURRENT SIGNALS (last completed daily close):")
for k in ("BTC","ETH"):
    c=ser(k); i=len(c)-2
    s=[sum(c[i-n+1:i+1])/n for n in (50,100,200)]
    print(f"{k} close {c[i]:.2f} ({date(days[i])}) | SMA50 {s[0]:.2f} SMA100 {s[1]:.2f} SMA200 {s[2]:.2f} | above: {[c[i]>x for x in s]}")
