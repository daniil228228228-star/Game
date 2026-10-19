// Compile permitted directed movements into geometry, using the DRAWN pavement as the clearance oracle.
import { buildTurnGraph } from './turns-plan-c.mjs';
const len=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1],(b[2]||0)-(a[2]||0));
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const right=([x,z])=>[-z,x];
const rounded=p=>p.map(v=>Math.round(v*1000)/1000);
const add=(p,h,d)=>[p[0]+h[0]*d,p[1]+h[1]*d,p[2]||0];
const resample=(pts,step=.6)=>{const out=[pts[0]];for(let i=1;i<pts.length;i++){const n=Math.max(1,Math.ceil(len(pts[i-1],pts[i])/step));for(let k=1;k<=n;k++)out.push(mix(pts[i-1],pts[i],k/n));}return out;};
const cubic=(a,h,b,k,scale=.45,tail=scale)=>{const d=Math.min(14,len(a,b)*scale),p=add(a,h,d),q=add(b,k,-Math.min(14,len(a,b)*tail)),out=[];for(let i=0;i<=40;i++){const t=i/40,u=1-t;out.push(a.map((v,j)=>u*u*u*v+3*u*u*t*p[j]+3*u*t*t*q[j]+t*t*t*b[j]));}return out;};

export function pavementOracle(D){
  const bins=new Map(),S=4,asphalt=new Set([D.palette.asph,D.palette.ramp]);
  const insert=f=>{if(f.ci===D.palette.white||f.ci===D.palette.yellow)return;for(let x=Math.floor(f.bb[0]/S);x<=Math.floor(f.bb[2]/S);x++)for(let z=Math.floor(f.bb[1]/S);z<=Math.floor(f.bb[3]/S);z++){const k=x+','+z;if(!bins.has(k))bins.set(k,[]);bins.get(k).push(f);}};
  const tri=(p,ci)=>{const [a,b,c]=p,den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-9)return;
    insert({bb:[Math.min(a[0],b[0],c[0]),Math.min(a[1],b[1],c[1]),Math.max(a[0],b[0],c[0]),Math.max(a[1],b[1],c[1])],ci,at(x,z){const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(z-c[1]))/den,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(z-c[1]))/den;return u>=-1e-7&&v>=-1e-7&&u+v<=1.0000001?u*a[2]+v*b[2]+(1-u-v)*c[2]:null;}});};
  for(const c of Object.values(D.cells))for(const layer of ['r','d']){
    const q=c[layer]?.q||[];for(let i=0;i<q.length;i+=6){const [x0,z0,x1,z1,y,ci]=q.slice(i,i+6);insert({bb:[x0,z0,x1,z1],ci,at:(x,z)=>x>=x0-1e-7&&x<=x1+1e-7&&z>=z0-1e-7&&z<=z1+1e-7?y:null});}
    const t=c[layer]?.t||[];for(let i=0;i<t.length;i+=8)tri([[t[i],t[i+1],t[i+6]],[t[i+2],t[i+3],t[i+6]],[t[i+4],t[i+5],t[i+6]]],t[i+7]);
    const v=c[layer]?.v||[];for(let i=0;i<v.length;i+=10)tri([[v[i],v[i+2],v[i+1]],[v[i+3],v[i+5],v[i+4]],[v[i+6],v[i+8],v[i+7]]],v[i+9]);
  }
  const surface=(x,z,h=0)=>{let top=-Infinity,ci=-1;for(const f of bins.get(Math.floor(x/S)+','+Math.floor(z/S))||[]){if(x<f.bb[0]-1e-7||x>f.bb[2]+1e-7||z<f.bb[1]-1e-7||z>f.bb[3]+1e-7)continue;const y=f.at(x,z);if(y!=null&&y>=h-.12&&y<=h+.23&&y>top){top=y;ci=f.ci;}}return {y:top,ci};};
  const at=(x,z,h=0)=>asphalt.has(surface(x,z,h).ci);
  const clear=(p,r=.72)=>{if(!at(p[0],p[1],p[2]||0))return false;for(let i=0;i<8;i++){const a=i*Math.PI/4;if(!at(p[0]+Math.cos(a)*r,p[1]+Math.sin(a)*r,p[2]||0))return false;}return true;};
  return {at,clear,surface};
}

export function compileLanePaths(P,D){
  const G=buildTurnGraph(P),N=new Map(P.nodes.map(n=>[n.id,n])),E=new Map(P.edges.map(e=>[e.id,e])),J=new Map(P.junctions.map(j=>[j.id,j]));
  const levels=new Map(D.graph.levels.map(r=>[r.id,r])),oracle=pavementOracle(D),V=new Map(),failures=[];
  const lineOf=v=>G.lines.get(v.split('@')[0]);
  const heading=L=>L.axis===0?[L.sgn,0]:[0,L.sgn];
  const height=(id,x,z)=>{const r=levels.get(id);let best=Infinity,h=0;for(let i=1;i<r.p.length;i++){const a=r.p[i-1],b=r.p[i],dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/l)):0,d=Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t);if(d<best){best=d;h=a[2]+(b[2]-a[2])*t;}}return h;};
  const lane=L=>{const c=P.classes[L.e.cls];return c.median/2+(c.lanes-.5)*c.lane;};
  const trim=(L,id)=>{const j=J.get(id),b=P.bends.find(b=>b.node===id);let d=0;
    if(b)d=b.R;else if(j?.type==='roundabout')d=j.R+4;else if(j?.type==='mini')d=9;
    else if(j&&!(j.type==='riro'&&L.e.cls==='arterial'))d=j.big?(L.axis===0?14.5:(j.boxZ||0)+5.2):Math.max(0,...j.arms.filter(a=>(a.dir[0]!==0)!==(L.axis===0)).map(a=>P.classes[a.cls]?.w/2||0))+5.2;
    else if(!j&&L.e.cls!=='motorway'&&P.edges.some(e=>(e.a===id||e.b===id)&&e.split))d=12;
    else if(N.get(id).legs===1)d=1.8;
    return b?d:Math.min(d,L.L*.45);
  };
  for(const v of G.full.keys()){
    const L=lineOf(v),s=v.split('@')[1];let t=s==='0'?trim(L,L.start):s==='end'?L.L-trim(L,L.end):Number(s);
    const h=heading(L),r=right(h),q=L.sgn>0?L.lo+t:L.hi-t,offset=lane(L),p=L.axis===0?[q,L.c,0]:[L.c,q,0];
    // I2's split streets are bands around islands, not their axis. The far joins use the inner through lane.
    const o=L.e.split?8.4:(L.e.dir==='x'&&L.c===0&&q>180?1.6:offset);
    p[0]+=r[0]*o;p[1]+=r[1]*o;p[2]=height(L.e.id,...p);V.set(v,p);
  }
  for(const r of G.rampEdges){const id=r.name.split(' ')[0],pts=levels.get(id).p;V.set(r.u,pts[0].slice());V.set(r.v,pts.at(-1).slice());}
  const valid=pts=>resample(pts,.6).every(p=>oracle.clear(p));
  const bodyClear=pts=>{const p=resample(pts,.4);return p.every((q,i)=>{
    const a=p[Math.max(0,i-1)],b=p[Math.min(p.length-1,i+1)],l=Math.hypot(b[0]-a[0],b[1]-a[1])||1,h=[(b[0]-a[0])/l,(b[1]-a[1])/l];
    return [-1.12,0,1.12].every(f=>[-.51,.51].every(w=>oracle.at(q[0]+h[0]*f-h[1]*w,q[1]+h[1]*f+h[0]*w,q[2])));
  });};

  // Small local A*: only used to follow existing curved pavement, never to create an off-road shortcut.
  function repair(a,b,guide,allowed=()=>true){
    const step=.5,margin=5,x0=Math.floor((Math.min(a[0],b[0],...guide.map(p=>p[0]))-margin)/step)*step,z0=Math.floor((Math.min(a[1],b[1],...guide.map(p=>p[1]))-margin)/step)*step;
    const x1=Math.max(a[0],b[0],...guide.map(p=>p[0]))+margin,z1=Math.max(a[1],b[1],...guide.map(p=>p[1]))+margin,nx=Math.ceil((x1-x0)/step)+1,nz=Math.ceil((z1-z0)/step)+1;
    const key=(x,z)=>x+nX*z;const nX=nx,point=k=>[x0+(k%nx)*step,z0+Math.floor(k/nx)*step,0],cost=new Map(),prev=new Map(),open=new Set(),closed=new Set(),cache=new Map();
    const usable=k=>{if(!cache.has(k)){const p=point(k);cache.set(k,allowed(p)&&oracle.clear(p));}return cache.get(k);};
    const near=p=>{let best=null,d=Infinity;for(let dx=-3;dx<=3;dx++)for(let dz=-3;dz<=3;dz++){const x=Math.round((p[0]-x0)/step)+dx,z=Math.round((p[1]-z0)/step)+dz;if(x<0||x>=nx||z<0||z>=nz)continue;const k=key(x,z),q=point(k),dd=len(p,q);if(dd<d&&usable(k)&&valid([p,q])){best=k;d=dd;}}return best;};
    const s=near(a),t=near(b);if(s==null||t==null)return null;cost.set(s,0);open.add(s);
    while(open.size){let u=null,best=Infinity;for(const k of open){const c=cost.get(k)+len(point(k),point(t));if(c<best){best=c;u=k;}}open.delete(u);if(u===t)break;closed.add(u);
      const x=u%nx,z=Math.floor(u/nx);for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){const xx=x+dx,zz=z+dz;if(xx<0||xx>=nx||zz<0||zz>=nz)continue;const v=key(xx,zz);if(closed.has(v)||!usable(v))continue;const mid=mix(point(u),point(v),.5);if(!allowed(mid)||!oracle.clear(mid))continue;const nd=cost.get(u)+step*Math.hypot(dx,dz);if(nd<(cost.get(v)??Infinity)){cost.set(v,nd);prev.set(v,u);open.add(v);}}
    }
    if(s!==t&&!prev.has(t))return null;const path=[b];for(let u=t;;u=prev.get(u)){path.push(point(u));if(u===s)break;}path.push(a);path.reverse();
    const pulled=[path[0]];for(let i=0;i<path.length-1;){let j=path.length-1;while(j>i+1&&(!valid([path[i],path[j]])||!resample([path[i],path[j]]).every(allowed)))j--;pulled.push(path[j]);i=j;}
    return pulled;
  }
  const arcs=[];
  function smoothPavement(points){
    const p=points.filter((q,i)=>!i||len(q,points[i-1])>1e-5),out=[p[0]];
    for(let i=1;i<p.length-1;i++){
      const a=p[i-1],b=p[i],c=p[i+1],l=len(a,b),m=len(b,c);let accepted=null;
      const cosine=((b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1]))/(l*m);
      if(cosine>.98){out.push(b);continue;}
      for(let cut=Math.min(2.7,l*.45,m*.45);cut>.025;cut*=.6){
        const x=mix(b,a,cut/l),y=mix(b,c,cut/m),q=[x];
        for(let k=1;k<=12;k++){const t=k/12,u=1-t;q.push(b.map((v,j)=>u*u*x[j]+2*u*t*v+t*t*y[j]));}
        if(valid(q)){accepted=q;break;}
      }
      out.push(...(accepted||[b]));
    }
    out.push(p.at(-1));return out;
  }
  const addArc=(edge,kind,pts,road=null,signal=null)=>{if(pts)pts=smoothPavement(pts);if(!pts||!valid(pts)){failures.push({u:edge.u,v:edge.v,name:edge.name,kind,at:pts?.find(p=>!oracle.clear(p))});return;}
    const p=resample(pts,1).map(rounded).filter((q,i,a)=>!i||len(q,a[i-1])>1e-5),w=p.reduce((s,q,i)=>s+(i?len(p[i-1],q):0),0);arcs.push({id:'a'+arcs.length,u:edge.u,v:edge.v,kind,road,signal,p,w:Math.round(w*1000)/1000});};
  for(const [u,list]of G.full)for(const edge of list){
    const a=V.get(u),b=V.get(edge.v),A=lineOf(u),B=lineOf(edge.v),h=heading(A),k=heading(B);
    if(/^I\d\./.test(edge.name)){const id=edge.name.split(' ')[0];addArc(edge,'ramp',levels.get(id).p,id);continue;}
    if(u.split('@')[0]===edge.v.split('@')[0]){
      const pts=resample([a,b],1).map(p=>[p[0],p[1],height(A.e.id,...p)]);
      let path=pts;if(!valid(path)&&A.e.cls!=='motorway')path=repair(a,b,path,p=>A.e.split?(p[1]*A.sgn>=.8):true);
      addArc(edge,'street',path,A.e.split?null:A.e.id);continue;
    }
    const id=A.end,j=J.get(id),node=N.get(id),c=[node.x,node.z,0],bend=P.bends.find(q=>q.node===id);
    let path;
    if(j&&['roundabout','mini'].includes(j.type)){
      const R=j.type==='mini'?4.1:j.R-(j.lanes===2?2.7:1.5),aa=Math.atan2(a[1]-c[1],a[0]-c[0])-.25,bb=Math.atan2(b[1]-c[1],b[0]-c[0])+.25;
      let delta=bb-aa;while(delta>=0)delta-=Math.PI*2;
      const n=Math.ceil(-delta*R/.6),ring=[];for(let i=0;i<=n;i++){const angle=aa+delta*i/n;ring.push([c[0]+Math.cos(angle)*R,c[1]+Math.sin(angle)*R,0]);}
      const tangent=t=>[Math.sin(t),-Math.cos(t)];
      const enter=cubic(a,h,ring[0],tangent(aa)),leave=cubic(ring.at(-1),tangent(bb),b,k);
      // Repair the short entry/exit separately; circulating movement must retain its CCW arc.
      const en=valid(enter)?enter:repair(a,ring[0],enter),ex=valid(leave)?leave:repair(ring.at(-1),b,leave);
      path=en&&ex?[...en,...ring.slice(1),...ex.slice(1)]:null;
    }else if(bend){
      const O=add(add(c,h,-bend.R),k,bend.R),la=lane(A),lb=lane(B);path=[];
      for(let i=0;i<=40;i++){const t=i/40*Math.PI/2,H=[h[0]*Math.cos(t)+k[0]*Math.sin(t),h[1]*Math.cos(t)+k[1]*Math.sin(t)],r=right(H),o=la+(lb-la)*(i/40);path.push([O[0]+bend.R*(-k[0]*Math.cos(t)+h[0]*Math.sin(t))+r[0]*o,O[1]+bend.R*(-k[1]*Math.cos(t)+h[1]*Math.sin(t))+r[1]*o,0]);}
      path=[a,...path,b];
    }else{
      path=cubic(a,h,b,k);
      if(!valid(path)||!bodyClear(path)){
        let candidate=null;
        for(const s of [.2,.3,.4,.5,.6,.7]){for(const t of [.3,.4,.5,.6,.7]){const p=cubic(a,h,b,k,s,t);if(valid(p)&&bodyClear(p)){candidate=p;break;}}if(candidate)break;}
        path=candidate||repair(a,b,path);
      }
    }
    const ch=j?Math.max(0,...j.arms.filter(a=>(a.dir[0]!==0)!==(A.axis===0)).map(a=>P.classes[a.cls]?.w/2||0)):0;
    const distance=j?.big?(A.axis===0?14.5:(j.boxZ||0)+5.2):ch+5.2;
    const signal=j?.type==='signal'?{id:j.id,axis:A.e.dir,approach:h,at:j.at,stop:[c[0]-h[0]*distance,c[1]-h[1]*distance],coordination:j.coordination||null}:j&&['roundabout','mini'].includes(j.type)?{id:j.id,kind:'yield',axis:A.e.dir,approach:h,at:j.at,stop:a.slice(0,2)}:null;
    if(signal){signal.leave=[b[0]+k[0]*1.4,b[1]+k[1]*1.4];signal.out=k;}
    addArc(edge,'turn',path,null,signal);
  }
  return {version:1,vertices:[...V].map(([id,p])=>[id,...rounded(p)]),arcs,failures};
}
