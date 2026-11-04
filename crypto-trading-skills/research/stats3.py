import csv, statistics as st, math
r=list(csv.DictReader(open("kr3.csv"))); n=len(r)
P=[float(x["pred"]) for x in r]; A=[float(x["act"]) for x in r]; hi=[float(x["hi"]) for x in r]; lo=[float(x["lo"]) for x in r]
print("n =",n)
print("pred up share: %.0f%%   actual up share: %.0f%%"%(100*sum(p>0 for p in P)/n,100*sum(a>0 for a in A)/n))
acc=sum((p>0)==(a>0) for p,a in zip(P,A))/n
print("direction accuracy: %.0f%% (random ~50%%, 95%% noise band +-%.0f%%)"%(100*acc,100*1.96*math.sqrt(.25/n)))
ma,mp=st.mean(A),st.mean(P)
c=sum((a-ma)*(p-mp) for a,p in zip(A,P))/math.sqrt(sum((a-ma)**2 for a in A)*sum((p-mp)**2 for p in P))
print("corr(pred, actual) = %.2f   mean pred %+.2f%%  mean actual %+.2f%%"%(c,100*mp,100*ma))
big=[(p,a) for p,a in zip(P,A) if p>0.03]
if big: print("when pred > +3%%: n=%d, mean actual %+.2f%%, up share %.0f%%"%(len(big),100*st.mean(a for _,a in big),100*sum(a>0 for _,a in big)/len(big)))
def sim(rows,sl,tp):
    out=[]
    for p,a,h,l in rows:
        x=-sl if l<=-sl else (tp if h>=tp else a); out.append(x-0.0011)
    return out
allr=list(zip(P,A,hi,lo))
for sl,tp in ((0.02,0.04),(0.03,0.05)):
    s=sim([x for x in allr if x[0]>0],sl,tp); b=sim(allr,sl,tp)
    if s: print("SL%.0f/TP%.0f long when pred>0: n=%d win=%.0f%% avg=%+.2f%% | always-long baseline: win=%.0f%% avg=%+.2f%%"%(sl*100,tp*100,len(s),100*sum(x>0 for x in s)/len(s),100*st.mean(s),100*sum(x>0 for x in b)/len(b),100*st.mean(b)))
