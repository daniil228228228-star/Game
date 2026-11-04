import json, math, statistics as st, itertools
COINS=["BTC","ETH","SOL","XRP","DOGE","ADA","LINK","AVAX"]
def load(k):
    d={}
    for n in range(1,10):
        for x in json.load(open(f"yr/{k}.{n}.json")): d[x[0]]=x
    return [tuple([x[0]]+[float(v) for v in x[1:6]]) for x in sorted(d.values())]  # ts,o,h,l,c,v
FEE=0.00055*2
def feats(b):
    n=len(b); c=[x[4] for x in b]; v=[x[5] for x in b]
    rsi=[None]*n; ema=[None]*n; atr=[None]*n
    e=c[0]
    for i in range(n): e=e*(1-2/201)+c[i]*2/201; ema[i]=e
    g=l=0
    tr=[0]*n
    for i in range(1,n):
        tr[i]=max(b[i][2]-b[i][3],abs(b[i][2]-c[i-1]),abs(b[i][3]-c[i-1]))
    for i in range(14,n):
        gs=sum(max(c[j]-c[j-1],0) for j in range(i-13,i+1))/14; ls=sum(max(c[j-1]-c[j],0) for j in range(i-13,i+1))/14
        rsi[i]=100-100/(1+gs/ls) if ls else 100
        atr[i]=sum(tr[i-13:i+1])/14
    return c,v,rsi,ema,atr
RULES={
 "RSI<25 long":      (lambda f,i:f["rsi"][i] is not None and f["rsi"][i]<25, "long"),
 "RSI>75 short":     (lambda f,i:f["rsi"][i] is not None and f["rsi"][i]>75, "short"),
 "drop>5%/24h long": (lambda f,i:i>=24 and f["c"][i]/f["c"][i-24]-1<-0.05, "long"),
 "pump>5%/24h short":(lambda f,i:i>=24 and f["c"][i]/f["c"][i-24]-1>0.05, "short"),
 "breakout24h+vol long": (lambda f,i:i>=25 and f["c"][i]>max(x[2] for x in f["b"][i-24:i]) and f["v"][i]>2*st.mean(f["v"][i-24:i]), "long"),
 "breakdown24h+vol short":(lambda f,i:i>=25 and f["c"][i]<min(x[3] for x in f["b"][i-24:i]) and f["v"][i]>2*st.mean(f["v"][i-24:i]), "short"),
 "uptrend pullback long":(lambda f,i:i>=24 and f["c"][i]>f["ema"][i] and f["rsi"][i] is not None and f["rsi"][i]<40, "long"),
 "downtrend bounce short":(lambda f,i:i>=24 and f["c"][i]<f["ema"][i] and f["rsi"][i] is not None and f["rsi"][i]>60, "short"),
}
def trade(b,i,side,atr,m,hold):
    e=b[i+1][1]; sl=m*atr/e; tp=m*atr/e
    for j in range(i+1,min(i+1+hold,len(b))):
        hi,lo=b[j][2],b[j][3]
        up=lo<=e*(1-sl) if side=="short" else hi>=e*(1+tp)
        dn=hi>=e*(1+sl) if side=="short" else lo<=e*(1-sl)
        if dn: return -sl-FEE, j
        if up: return tp-FEE, j
    j=min(i+hold,len(b)-1); x=b[j][4]
    return ((x/e-1) if side=="long" else (1-x/e))-FEE, j
res={}
for k in COINS:
    b=load(k); c,v,rsi,ema,atr=feats(b); f={"b":b,"c":c,"v":v,"rsi":rsi,"ema":ema}
    T=b[len(b)//2][0]
    for name,(cond,side) in RULES.items():
        for m in (1.0,2.0):
            i=210; out=[]
            while i<len(b)-14:
                if cond(f,i):
                    r,j=trade(b,i,side,atr[i],m,12); out.append((b[i][0],r)); i=j+1
                else: i+=1
            res.setdefault((name,m),[]).extend([(t,r,T) for t,r in out])
print("rule | ATRmult | n | avg%/trade | win | t-stat | 1st half avg | 2nd half avg")
rows=[]
for (name,m),L in res.items():
    r=[x[1] for x in L]; n=len(r)
    if n<60: continue
    mu=st.mean(r); sd=st.pstdev(r); t=mu/(sd/math.sqrt(n))
    h1=[x[1] for x in L if x[0]<x[2]]; h2=[x[1] for x in L if x[0]>=x[2]]
    rows.append((t,name,m,n,mu*100,sum(x>0 for x in r)/n,st.mean(h1)*100 if h1 else 0,st.mean(h2)*100 if h2 else 0))
for t,name,m,n,mu,w,a,b2 in sorted(rows,reverse=True):
    print(f"{name:26} {m:3.1f} {n:5d} {mu:+.3f}% {w:4.0%} t={t:+.1f}  {a:+.3f}% {b2:+.3f}%")
print("tested combos:",len(rows))
