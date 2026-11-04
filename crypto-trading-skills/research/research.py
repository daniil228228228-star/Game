import json, math, statistics as st, datetime as dt
COINS=["BTC","ETH","BNB","XRP","ADA","LTC","TRX","LINK","DOGE","XLM"]
D={k:dict(json.load(open(f"daily/{k}.json"))) for k in COINS}   # day_ms -> close
days=sorted(set(D["BTC"])); idx={d:i for i,d in enumerate(days)}
def ser(k): return [D[k].get(d) for d in days]
FEE=0.001
def stats(rets, label, ppy=365):
    if not rets: return
    eq=1; peak=1; mdd=0
    for r in rets: eq*=1+r; peak=max(peak,eq); mdd=min(mdd,eq/peak-1)
    yrs=len(rets)/ppy; cagr=eq**(1/yrs)-1 if eq>0 else -1
    sd=st.pstdev(rets); sh=st.mean(rets)/sd*math.sqrt(ppy) if sd>0 else 0
    print(f"{label:40} CAGR {cagr:+6.0%}  Sharpe {sh:+.2f}  maxDD {mdd:6.0%}  total x{eq:.2f}")
def trend(k,n,start=0):
    c=ser(k); pos=0; out=[]; prev=0
    for i in range(max(n,start),len(c)-1):
        if c[i] is None or c[i+1] is None: continue
        sma=sum(x for x in c[i-n+1:i+1] if x)/n
        pos=1 if c[i]>sma else 0
        r=(c[i+1]/c[i]-1)*pos - (FEE if pos!=prev else 0); prev=pos; out.append(r)
    return out
half=len(days)//2
print("== A. TREND FOLLOWING (long when close > SMA(n), else cash), fees 0.1%/switch ==")
for k in ("BTC","ETH"):
    for n in (50,100,200):
        r=trend(k,n); stats(r,f"{k} SMA{n} all ({len(r)}d)")
        stats(r[:len(r)//2],f"   1st half"); stats(r[len(r)//2:],f"   2nd half")
    c=ser(k); bh=[c[i+1]/c[i]-1 for i in range(200,len(c)-1)]; stats(bh,f"{k} buy&hold"); 
print()
print("== B. CROSS-SECTIONAL MOMENTUM (weekly, long-only top3 of up to 10, by 28d return) ==")
def xsec(top=3,look=28,rev=False,hold=7):
    out=[]; i=look+60
    while i+hold<len(days):
        cand=[]
        for k in COINS:
            c=ser(k)
            if c[i] and c[i-look] and c[i+hold]: cand.append((c[i]/c[i-look]-1,k))
        if len(cand)>=6:
            cand.sort(reverse=rev is False and True or False)
            sel=[k for _,k in (sorted(cand,reverse=not rev)[:top])]
            r=sum(ser(k)[i+hold]/ser(k)[i]-1 for k in sel)/len(sel)-2*FEE   # in & out each week
            allr=sum(ser(k)[i+hold]/ser(k)[i]-1 for _,k in cand)/len(cand)
            out.append((r,allr))
        i+=hold
    return out
for label,rev in (("top3 momentum",False),("bottom3 (reversal)",True)):
    o=xsec(rev=rev); stats([a for a,_ in o],f"{label} weekly",52)
    stats([a for a,_ in o][:len(o)//2],"   1st half",52); stats([a for a,_ in o][len(o)//2:],"   2nd half",52)
stats([b for _,b in xsec()],"equal-weight all coins (no fee)",52)
print()
print("== C. FUNDING CARRY (Hyperliquid, last ~1y): short perp + long spot ==")
for k in ["BTC","ETH","SOL","XRP","DOGE","ADA","LINK","AVAX"]:
    f=json.load(open(f"fund/{k}.json")); rates=[r for _,r in f]
    apr=st.mean(rates)*24*365; pos=sum(r>0 for r in rates)/len(rates)
    # 30-day rolling worst
    w=min(sum(rates[i:i+720]) for i in range(0,len(rates)-720,24))
    print(f"{k:5} avg funding {apr:+6.1%}/yr   positive {pos:3.0%} of hours   worst 30d {w:+.2%}")
