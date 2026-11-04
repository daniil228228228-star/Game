import json, statistics as st, datetime as dt, math, random
def load(f): return [(x[0],float(x[1]),float(x[2]),float(x[3]),float(x[4]),float(x[5])) for x in json.load(open(f))]
h=load("kl/SOLnow.json")[:-1]  # drop unfinished bar
h3={}
for n in (1,2,3):
    for x in json.load(open(f"kl/SOL.{n}.json")): h3[x[0]]=x
for x in json.load(open("kl/SOLnow.json"))[:-1]: h3[x[0]]=x
full=[(x[0],float(x[2]),float(x[3]),float(x[4])) for x in sorted(h3.values())]  # ts,hi,lo,close
cl=[x[3] for x in full]
last=cl[-1]; t=dt.datetime.fromtimestamp(full[-1][0]/1000,dt.timezone.utc)
print("last closed 1h bar:",t.strftime("%Y-%m-%d %H:%M UTC"),"close",last)
def ret(n): return last/cl[-1-n]-1
print("returns 1h/4h/8h/24h/7d: %+.2f%% %+.2f%% %+.2f%% %+.2f%% %+.2f%%"%tuple(100*ret(n) for n in (1,4,8,24,168)))
# RSI14
d=[cl[i]-cl[i-1] for i in range(1,len(cl))][-14:]
g=sum(x for x in d if x>0)/14; l=-sum(x for x in d if x<0)/14; print("RSI14 1h: %.0f"%(100-100/(1+g/l) if l else 100))
ema=lambda n:(lambda e:[e:=e*(1-2/(n+1))+p*2/(n+1) for p in cl][-1])(cl[0])
print("EMA20 %.2f EMA50 %.2f EMA200 %.2f"%(ema(20),ema(50),ema(200)))
# ATR / vol
tr=[max(full[i][1]-full[i][2],abs(full[i][1]-cl[i-1]),abs(full[i][2]-cl[i-1])) for i in range(1,len(full))]
atr=st.mean(tr[-14:]); print("ATR14 1h: %.2f (%.2f%%)"%(atr,100*atr/last))
r1=[math.log(cl[i]/cl[i-1]) for i in range(1,len(cl))]
print("hourly vol last24h %.2f%%  last7d %.2f%%  all %.2f%%"%tuple(100*st.pstdev(r1[-n:]) for n in (24,168,len(r1))))
# levels last 24h/72h
print("24h hi/lo %.2f / %.2f   72h hi/lo %.2f / %.2f"%(max(x[1] for x in full[-24:]),min(x[2] for x in full[-24:]),max(x[1] for x in full[-72:]),min(x[2] for x in full[-72:])))
# empirical 8h forward distribution (all history) and scaled by recent vol
f8=[cl[i+8]/cl[i]-1 for i in range(len(cl)-8)]
q=lambda a,p:sorted(a)[int(p*(len(a)-1))]
print("hist 8h return quantiles 5/25/50/75/95: "+" ".join("%+.1f%%"%(100*q(f8,p)) for p in (.05,.25,.5,.75,.95)))
print("hist P(8h up)=%.0f%%  P(|move|>2%%)=%.0f%%  P(>+3%%)=%.0f%% P(<-3%%)=%.0f%%"%(100*sum(x>0 for x in f8)/len(f8),100*sum(abs(x)>.02 for x in f8)/len(f8),100*sum(x>.03 for x in f8)/len(f8),100*sum(x<-.03 for x in f8)/len(f8)))
# does momentum predict next 8h? (corr of past 8h and next 8h; past 24h and next 8h)
def corr(a,b):
    ma,mb=st.mean(a),st.mean(b); return sum((x-ma)*(y-mb) for x,y in zip(a,b))/math.sqrt(sum((x-ma)**2 for x in a)*sum((y-mb)**2 for y in b))
p8=[cl[i]/cl[i-8]-1 for i in range(24,len(cl)-8)]; n8=[cl[i+8]/cl[i]-1 for i in range(24,len(cl)-8)]
p24=[cl[i]/cl[i-24]-1 for i in range(24,len(cl)-8)]
print("corr(past8h,next8h)=%.3f  corr(past24h,next8h)=%.3f  (n=%d, noise ~ +-%.2f)"%(corr(p8,n8),corr(p24,n8),len(n8),2/math.sqrt(len(n8)/8)))
# range hit probabilities within 8h touching levels (using highs/lows)
def touch(up,dn):
    u=dn_=0;N=0
    for i in range(len(cl)-8):
        hi=max(x[1] for x in full[i+1:i+9]); lo=min(x[2] for x in full[i+1:i+9]); N+=1
        u+=hi>=cl[i]*(1+up); dn_+=lo<=cl[i]*(1-dn)
    return u/N,dn_/N
for m in (0.01,0.02,0.03): print("P(touch +%.0f%% within 8h)=%.0f%%  P(touch -%.0f%%)=%.0f%%"%(m*100,100*touch(m,m)[0],m*100,100*touch(m,m)[1]))
print("price levels: +1%% %.2f  +2%% %.2f  +3%% %.2f | -1%% %.2f  -2%% %.2f  -3%% %.2f"%tuple(last*(1+m) for m in (.01,.02,.03,-.01,-.02,-.03)))
