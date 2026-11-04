import csv, math, statistics as st
r=list(csv.DictReader(open("kt.csv"))); n=len(r)
for model,tag in (("ch","Chronos-2"),("tf","TimesFM-2.5")):
    for hz in ("8","24"):
        P=[float(x[model+hz]) for x in r]; A=[float(x["act"+hz]) for x in r]
        acc=sum((p>0)==(a>0) for p,a in zip(P,A))/n; ma,mp=st.mean(A),st.mean(P)
        c=sum((a-ma)*(p-mp) for a,p in zip(A,P))/math.sqrt(sum((a-ma)**2 for a in A)*sum((p-mp)**2 for p in P))
        res=[(1 if p>0 else -1)*a-0.0011 for p,a in zip(P,A)]
        print(f"{tag:12} {hz:>2}h n={n} accuracy={acc:4.0%} (+-{100*1.96*math.sqrt(.25/n):.0f}%) corr={c:+.2f} (noise +-{1.96/math.sqrt(n):.2f}) pred up {sum(p>0 for p in P)/n:.0%} | sign-trade avg {100*st.mean(res):+.3f}% win {sum(x>0 for x in res)/n:.0%}")
