import json
h3={}
for n in (1,2,3):
    for x in json.load(open(f"kl/SOL.{n}.json")): h3[x[0]]=x
for x in json.load(open("kl/SOLnow.json"))[:-1]: h3[x[0]]=x
c=[(float(x[2]),float(x[3]),float(x[4])) for x in sorted(h3.values())]  # hi,lo,close
fee=0.00055*2; H=8
def run(tp,sl,side):
    w=l=t=0; net=0
    for i in range(50,len(c)-H-1):
        e=c[i][2]; r=None
        for j in range(i+1,i+1+H):
            hi,lo=c[j][0],c[j][1]
            up=hi>=e*(1+tp); dn=lo<=e*(1-sl)
            if side=="short": up=lo<=e*(1-tp); dn=hi>=e*(1+sl)
            if dn: r=-sl; l+=1; break      # both in same bar = loss (conservative)
            if up: r=tp; w+=1; break
        if r is None:
            x=c[i+H][2]; r=(x/e-1) if side=="long" else (1-x/e); t+=1
        net+=r-fee
    n=w+l+t
    return w/n, l/n, t/n, net/n*100
print("side  TP%   SL%   win   loss  timeout   net/trade after fees")
for side in ("long","short"):
    for tp,sl in [(0.003,0.02),(0.005,0.02),(0.005,0.03),(0.007,0.03),(0.01,0.03),(0.01,0.02),(0.02,0.02)]:
        w,l,t,e=run(tp,sl,side); print(f"{side:5} {tp*100:4.1f}  {sl*100:4.1f}  {w:4.0%}  {l:4.0%}  {t:4.0%}   {e:+.3f}%")
