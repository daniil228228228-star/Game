/* Plan C owns directed routes, short paved accesses and junction admission. B never enters this module. */
(() => {
  'use strict';
  if(window.LAYOUT_V161!=='C')return;
  const D=window.PlanCDataV161,nav=D?.graph?.navigation;
  if(!nav||nav.failures.length){console.error('Plan C navigation data missing or invalid');return;}
  const arcs=new Map(nav.arcs.map(a=>[a.id,a])),adj=new Map(),reverse=new Map(),gates=new Map(),controllers=new Map();
  const v3=p=>new THREE.Vector3(p[0],p[2]||0,p[1]);
  const dist=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1],(b[2]||0)-(a[2]||0));
  let clock=0,gateSerial=0,busSerial=0,drivewayMesh=null,lastStage=typeof stageIndex==='number'?stageIndex:0;
  const diagnostics={routes:0,failed:0,blockedTargets:[],admissions:0};
  for(const s of D.graph.signals)controllers.set(s[0],{id:s[0],slot:0,elapsed:0,actor:null});
  for(const s of D.graph.rings.concat(D.graph.minis))controllers.set(s[0],{id:s[0],kind:'yield',slot:0,elapsed:0,actor:null});
  const phaseGroups=new Map();
  for(const [id,c]of controllers){const shared=D.graph.signalCoordination.find(s=>s[0]===id)?.[1]||id;if(!phaseGroups.has(shared))phaseGroups.set(shared,[]);phaseGroups.get(shared).push(c);}
  const inCrossing=(p,c,r=.3)=>Math.abs((c.axis==='x'?p.x:p.z)-(c.axis==='x'?c.at[0]:c.at[1]))<=.8+r&&Math.abs((c.axis==='x'?p.z:p.x)-(c.axis==='x'?c.at[1]:c.at[0]))<=c.half+r;
  function pedestrianGroups(){return [typeof player==='undefined'?null:player,...(typeof npcWorkers==='undefined'?[]:npcWorkers.map(a=>a.group)),...(typeof livingCityRuntime==='undefined'?[]:(livingCityRuntime.residents||[]).map(a=>a.group))].filter(g=>g&&g.visible!==false&&Math.abs(g.position.y)<1);}
  const pedOccupied=new Set();
  function occupiedCrossing(id){return pedOccupied.has(id);}
  function walkAllowed(from,to){
    if(Math.abs(from.y||0)>1)return true;
    const n=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.z-from.z)/.25));
    for(const c of D.graph.signalCrossings){if(inCrossing(from,c))continue;
      const control=controllers.get(c.id);if(control.slot===4&&control.elapsed<8&&!control.actor)continue;
      for(let k=1;k<=n;k++)if(inCrossing({x:from.x+(to.x-from.x)*k/n,z:from.z+(to.z-from.z)*k/n},c))return false;
    }return true;
  }
  for(const a of arcs.values()){
    if(!adj.has(a.u))adj.set(a.u,[]);adj.get(a.u).push(a);
    if(!reverse.has(a.v))reverse.set(a.v,[]);reverse.get(a.v).push({v:a.u});
    a.cum=[0];for(let i=1;i<a.p.length;i++)a.cum.push(a.cum.at(-1)+dist(a.p[i-1],a.p[i]));a.w=a.cum.at(-1);
    a.bb=[Math.min(...a.p.map(p=>p[0])),Math.min(...a.p.map(p=>p[1])),Math.max(...a.p.map(p=>p[0])),Math.max(...a.p.map(p=>p[1]))];
  }
  const flood=(g,s)=>{const found=new Set([s]),todo=[s];while(todo.length){const u=todo.pop();for(const a of g.get(u)||[])if(!found.has(a.v)){found.add(a.v);todo.push(a.v);}}return found;};
  const root=nav.arcs.filter(a=>a.kind==='street').reduce((a,b)=>!a||Math.hypot(...b.p[0].slice(0,2))<Math.hypot(...a.p[0].slice(0,2))?b:a,null).u;
  const reach=flood(adj,root),back=flood(reverse,root),city=new Set([...reach].filter(v=>back.has(v)));
  const streets=nav.arcs.filter(a=>a.kind!=='turn'&&city.has(a.u)&&city.has(a.v));
  const medianRects=[];
  for(const c of Object.values(D.cells)){const q=c.r?.q||[];for(let i=0;i<q.length;i+=6)if([D.palette.median,D.palette.medLawn,D.palette.medM].includes(q[i+5]))medianRects.push(q.slice(i,i+4));}
  let obstacleSignature='',obstacleBins=new Map(),obstacleVersion=0,lastRegistry=null,lastRegistryRevision;
  const arcClearCache=new Map();
  function refreshObstacles(){
    lastRegistry=window.__TYCOON_V83_COLLISIONS__;lastRegistryRevision=lastRegistry?.rev?.();
    const entries=(window.__TYCOON_V83_COLLISIONS__?.query?.('agent')||[]).filter(e=>{
      if(e.category==='vehicle'||!e.pos||!e.flags?.agent||typeof e.active==='function'&&!e.active())return false;
      for(let o=e.owner;o;o=o.parent)if(o.visible===false)return false;return true;
    });
    const signature=entries.map(e=>[e.id,e.shape,e.pos.x,e.pos.y,e.pos.z,e.hx,e.hz,e.radius,e.yaw].join(',')).join('|');
    if(signature===obstacleSignature)return;
    obstacleSignature=signature;obstacleVersion++;obstacleBins=new Map();arcClearCache.clear();
    for(const e of entries){
      const extent=(e.shape==='obb'?Math.hypot(e.hx,e.hz):e.radius||0)+1.3;
      for(let x=Math.floor((e.pos.x-extent)/12);x<=Math.floor((e.pos.x+extent)/12);x++)for(let z=Math.floor((e.pos.z-extent)/12);z<=Math.floor((e.pos.z+extent)/12);z++){
        const k=x+','+z;if(!obstacleBins.has(k))obstacleBins.set(k,[]);obstacleBins.get(k).push(e);
      }
    }
  }
  function projectOn(a,p){
    let best=null;
    for(let i=1;i<a.p.length;i++){
      const x=a.p[i-1],y=a.p[i],dx=y[0]-x[0],dz=y[1]-x[1],l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((p.x-x[0])*dx+(p.z-x[1])*dz)/l)):0;
      const q=x.map((v,k)=>v+(y[k]-v)*t),d=Math.hypot(p.x-q[0],p.z-q[1],((p.y||0)-q[2])*2);
      if(!best||d<best.d)best={arc:a,i,t,q,d,along:a.cum[i-1]+dist(x,y)*t};
    }
    return best;
  }
  function candidates(p){
    if(p.navArc&&arcs.has(p.navArc)){const q=projectOn(arcs.get(p.navArc),p);if(q?.d<1.6)return [q];}
    // A vehicle already in an access uses that access's original lane, preserving its legal entry/exit.
    for(const g of gates.values()){const q=projectOn(g,p);if(Math.hypot(p.x-q.q[0],p.z-q.q[1])<.12&&Math.abs((p.y||0)-q.q[2])<.3&&accessClear(p,g.projection.q))return [{...g.projection,gate:g,current:p.clone()}];}
    return streets.filter(a=>p.x>=a.bb[0]-34&&p.x<=a.bb[2]+34&&p.z>=a.bb[1]-34&&p.z<=a.bb[3]+34).map(a=>projectOn(a,p)).filter(q=>q&&q.d<=34).sort((a,b)=>a.d-b.d).slice(0,8);
  }
  function obstacleAt(p,r=.75){
    const entries=obstacleBins.get(Math.floor(p[0]/12)+','+Math.floor(p[1]/12))||[];
    for(const e of entries){
      if(e.category==='vehicle'||!e.pos||!e.flags?.agent||typeof e.active==='function'&&!e.active())continue;
      let visible=true;for(let o=e.owner;o;o=o.parent)if(o.visible===false){visible=false;break;}if(!visible)continue;
      // Ground access roads never intersect an elevated vehicle deck.
      if(Math.abs((e.pos.y||0)-(p[2]||0))>3)continue;
      const dx=p[0]-e.pos.x,dz=p[1]-e.pos.z;
      if(e.shape==='obb'){const s=Math.sin(e.yaw||0),c=Math.cos(e.yaw||0),x=dx*c-dz*s,z=dx*s+dz*c;
        if(Math.hypot(Math.max(0,Math.abs(x)-e.hx),Math.max(0,Math.abs(z)-e.hz))<r)return true;
      }else if(Math.hypot(dx,dz)<(e.radius||0)+r)return true;
    }
    return false;
  }
  function arcClear(a,from=0,to=a.w){
    if(!obstacleBins.size)return true;
    const full=from===0&&to===a.w;if(full&&arcClearCache.has(a.id))return arcClearCache.get(a.id);
    const p=slice(a,from,to);let clear=!obstacleAt(p[0],1.25);
    for(let i=1;i<p.length&&clear;i++){
      const A=p[i-1],B=p[i],n=Math.max(1,Math.ceil(dist(A,B)/.4));
      for(let k=0;k<=n;k++){const q=A.map((v,j)=>v+(B[j]-v)*k/n);if(obstacleAt(q,1.25)){clear=false;break;}}
    }
    if(full)arcClearCache.set(a.id,clear);return clear;
  }
  function stepClear(from,to){
    const registry=window.__TYCOON_V83_COLLISIONS__;
    if(registry!==lastRegistry||registry?.rev?.()!==lastRegistryRevision)refreshObstacles();
    const n=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.z-from.z)/.25));
    for(let k=0;k<=n;k++)if(obstacleAt([from.x+(to.x-from.x)*k/n,from.z+(to.z-from.z)*k/n,(from.y||0)+((to.y||0)-(from.y||0))*k/n],1.25))return false;
    return true;
  }
  function accessClear(p,q){
    if(Math.abs(q[2])>.2||!D.access(p.x,p.z,1.25))return false;
    const L=Math.hypot(q[0]-p.x,q[1]-p.z),n=Math.max(1,Math.ceil(L/.5));
    for(let i=0;i<=n;i++){
      const t=i/n,x=p.x+(q[0]-p.x)*t,z=p.z+(q[1]-p.z)*t;
      if(!D.access(x,z,1.25)||obstacleAt([x,z,0],1.25))return false;
      if(medianRects.some(r=>x>r[0]-.8&&x<r[2]+.8&&z>r[1]-.8&&z<r[3]+.8))return false;
      if(D.graph.rings.concat(D.graph.minis).some(r=>Math.hypot(x-r[1],z-r[2])<r[4]+.85))return false;
    }
    return true;
  }
  function accessPossible(p,q,allow){return q.gate?accessClear(p,q.q):!allow||q.d<.15||q.d<=34&&accessClear(p,q.q);}
  function slice(a,from,to){
    if(a.p.length===1)return [a.p[0].slice()];
    const at=d=>{let i=1;while(i<a.cum.length-1&&a.cum[i]<d)i++;const t=(d-a.cum[i-1])/Math.max(1e-9,a.cum[i]-a.cum[i-1]);return a.p[i-1].map((v,k)=>v+(a.p[i][k]-v)*t);};
    return [at(from),...a.p.filter((p,i)=>a.cum[i]>from+1e-5&&a.cum[i]<to-1e-5),at(to)];
  }
  function rebuildDriveways(){
    if(typeof scene==='undefined')return;
    const pos=[],normal=[];
    for(const g of gates.values())for(let i=1;i<g.p.length;i++){
      const a=g.p[i-1],b=g.p[i],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz)||1,nx=-dz/l*1.2,nz=dx/l*1.2;
      const v=[[a[0]+nx,a[2]+.052,a[1]+nz],[b[0]+nx,b[2]+.052,b[1]+nz],[a[0]-nx,a[2]+.052,a[1]-nz],[b[0]-nx,b[2]+.052,b[1]-nz]];
      for(const j of [0,1,2,1,3,2]){pos.push(...v[j]);normal.push(0,1,0);}
    }
    if(!drivewayMesh){drivewayMesh=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial({color:new THREE.Color(D.colors[D.palette.asph]).convertSRGBToLinear(),roughness:.92,side:THREE.DoubleSide}));drivewayMesh.name='planCAccessV161';drivewayMesh.userData.planCAccess=true;scene.add(drivewayMesh);}
    const old=drivewayMesh.geometry,geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));geo.computeBoundingSphere();drivewayMesh.geometry=geo;old.dispose();
  }
  function access(p,q){
    if(q.gate){const g=q.gate,near=projectOn(g,p);return {id:g.id,p:[ [p.x,p.z,near.q[2]],...slice(g,near.along,g.w).slice(1)]};}
    if(q.d<.15)return null;
    const existing=[...gates.values()].find(g=>Math.hypot(g.p[0][0]-p.x,g.p[0][1]-p.z)<.001&&g.projection.arc===q.arc&&accessClear(p,g.projection.q));if(existing)return existing;
    const n=Math.max(2,Math.ceil(q.d/.75)),pts=[];
    for(let i=0;i<=n;i++){const t=i/n,x=p.x+(q.q[0]-p.x)*t,z=p.z+(q.q[1]-p.z)*t,remaining=Math.hypot(x-q.q[0],z-q.q[1]);pts.push([x,z,.08*Math.min(1,remaining/1.6)]);}
    const g={id:'access'+(++gateSerial),p:pts,projection:q,u:null,v:null,cum:[0]};for(let i=1;i<pts.length;i++)g.cum.push(g.cum.at(-1)+dist(pts[i-1],pts[i]));g.w=g.cum.at(-1);gates.set(g.id,g);rebuildDriveways();return g;
  }
  function route(from,to,options={}){
    if(!from||!to)return [];
    refreshObstacles();
    const allow=options.access!==false,allowFrom=options.sourceAccess??allow,allowTo=options.targetAccess??allow;
    const S=candidates(from).filter(q=>accessPossible(from,q,allowFrom)),T=candidates(to).filter(q=>accessPossible(to,q,allowTo));
    const distance=new Map(),prev=new Map(),seed=new Map(),todo=[];
    const push=(cost,u)=>{let i=todo.length;todo.push([cost,u]);while(i){const p=(i-1)>>1;if(todo[p][0]<=cost)break;todo[i]=todo[p];i=p;}todo[i]=[cost,u];};
    const pop=()=>{const top=todo[0],last=todo.pop();if(todo.length){let i=0;while(i*2+1<todo.length){let child=i*2+1;if(child+1<todo.length&&todo[child+1][0]<todo[child][0])child++;if(todo[child][0]>=last[0])break;todo[i]=todo[child];i=child;}todo[i]=last;}return top;};
    for(const s of S){if(!arcClear(s.arc,s.along,s.arc.w))continue;const cost=s.arc.w-s.along+s.d*4;if(cost<(distance.get(s.arc.v)??Infinity)){distance.set(s.arc.v,cost);seed.set(s.arc.v,s);push(cost,s.arc.v);}}
    while(todo.length){const [cost,u]=pop();if(cost!==distance.get(u))continue;
      for(const a of adj.get(u)||[]){if(!arcClear(a))continue;const d=cost+a.w;if(d<(distance.get(a.v)??Infinity)){distance.set(a.v,d);prev.set(a.v,a);seed.delete(a.v);push(d,a.v);}}
    }
    let best=null;
    for(const t of T){
      const cost=(distance.get(t.arc.u)??Infinity)+t.along+t.d*4;
      if(Number.isFinite(cost)&&arcClear(t.arc,0,t.along)&&(!best||cost<best.cost)){const chain=[];let u=t.arc.u;while(prev.has(u)){const a=prev.get(u);chain.unshift(a);u=a.u;}const s=seed.get(u);if(s)best={cost,s,t,chain};}
      for(const s of S)if(s.arc===t.arc&&t.along>=s.along&&arcClear(s.arc,s.along,t.along)){const c=t.along-s.along+4*(s.d+t.d);if(!best||c<best.cost)best={cost:c,s,t,chain:[],direct:true};}
    }
    if(!best){diagnostics.failed++;diagnostics.blockedTargets.push([to.x,to.z]);if(diagnostics.blockedTargets.length>12)diagnostics.blockedTargets.shift();return [];}
    const result=[],stops=[];let along=0;
    const append=(p,road,arc)=>{const last=result.at(-1),v=v3(p);v.roadId=road;v.navArc=arc;
      if(last&&last.distanceTo(v)<.0001){last.roadId=road;last.navArc=arc;return;}if(last)along+=last.distanceTo(v);result.push(v);};
    const emit=(a,p)=>{const start=along;
      if(a.signal){
        // Locate the physical stop plane even if a short graph edge split lies after the painted line.
        const s=a.signal,h=s.approach,plane=s.stop[0]*h[0]+s.stop[1]*h[1];let d=start;
        for(let i=result.length-1;i>0;i--){const b=result[i],aa=result[i-1],vb=b.x*h[0]+b.z*h[1]-plane,va=aa.x*h[0]+aa.z*h[1]-plane;
          if(vb>=0&&va<=0){d=along;for(let j=result.length-1;j>i;j--)d-=result[j].distanceTo(result[j-1]);d-=aa.distanceTo(b)*(vb/(vb-va||1));break;}}
        if(result.length>1||!p.length||p[0][0]*h[0]+p[0][1]*h[1]<=plane+.25)stops.push({...s,d,exit:start+a.w+1.4});
      }
      for(const q of p)append(q,a.road,a.id);
    };
    const ga=allowFrom?access(from,best.s):null;if(ga)for(const p of ga.p)append(p,ga.id,null);
    emit(best.s.arc,slice(best.s.arc,best.s.along,best.direct?best.t.along:best.s.arc.w));
    if(!best.direct){for(const a of best.chain)emit(a,a.p);emit(best.t.arc,slice(best.t.arc,0,best.t.along));}
    const gb=allowTo?access(to,best.t):null;if(gb)for(const p of gb.p.slice().reverse())append(p,gb.id,null);
    result.planC=true;result.stops=stops;diagnostics.routes++;return result;
  }
  function overlay(x,z,base=0){let h=base;for(const g of gates.values()){const q=projectOn(g,{x,y:base,z});if(q.d<1.2&&Math.abs(q.q[2]-base)<.3)h=Math.max(h,q.q[2]);}return h;}
  function roadY(id,x,z){const g=[...gates.values()].find(g=>g.id===id);if(g){const q=projectOn(g,{x,y:0,z});return q.d<1.3?q.q[2]:null;}const h=D.roadY(id,x,z);return h==null?null:overlay(x,z,h);}
  const direction=h=>h[0]>0?'E':h[0]<0?'W':h[1]>0?'S':'N';
  function state(id,h){
    const c=controllers.get(id);if(!c)return 'red';
    if(c.kind==='yield')return c.actor?'red':'green';
    const slot=c.slot,within=c.elapsed,approach=['E','S','W','N'][slot],same=c.actor&&c.approach===direction(h);
    if(slot===4||c.actor&&!same||occupiedCrossing(id))return 'red';
    return direction(h)===approach?(within<8?'green':within<10?'amber':'red'):'red';
  }
  function advance(actor,route,d,step){
    const identity=actor.group||actor,p=identity.position;
    if(identity.userData)identity.userData.planCSignalWait=false;
    for(const c of controllers.values())if(c.actor===identity){
      let cleared=(c.route===route&&d>c.exit)||(c.leave&&(p.x-c.leave[0])*c.out[0]+(p.z-c.leave[1])*c.out[1]>0);
      if(c.route!==route&&Math.hypot(p.x-c.at[0],p.z-c.at[1])>c.radius)cleared=true;
      if(!cleared&&c.route!==route){
        let along=0,best=Infinity,progress=0;
        for(let i=1;i<c.route.length;i++){
          const a=c.route[i-1],b=c.route[i],dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz,t=l2?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/l2)):0,L=a.distanceTo(b),gap=Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t,p.y-a.y-(b.y-a.y)*t);
          if(gap<best){best=gap;progress=along+t*L;}along+=L;
        }
        cleared=progress>c.exit;
      }
      if(identity.visible===false||cleared)c.actor=null;
    }
    for(const s of route.stops||[]){
      if(d>s.exit)continue;
      const c=controllers.get(s.id);if(c?.actor===identity)continue;
      if(d+step<s.d-.02)continue;
      if(d>s.d+.25)continue; // already inside at a route splice; never brake in the junction box
      if(state(s.id,s.approach)!=='green'||c?.actor){
        const allowed=Math.min(step,Math.max(0,s.d-d));if(identity.userData)identity.userData.planCSignalWait=allowed<step||Math.abs(s.d-d)<.03;
        return allowed;
      }
      Object.assign(c,{actor:identity,exit:s.exit,approach:direction(s.approach),route,at:s.at,leave:s.leave,out:s.out,radius:Math.max(18,Math.hypot(s.stop[0]-s.at[0],s.stop[1]-s.at[1])+5)});diagnostics.admissions++;
    }
    return step;
  }
  const loops={suburb:[[-280,40],[-232,80],[-280,120],[-232,0]],industrial:[[80,-190],[160,-190],[160,-160],[80,-160]],business:[[40,-40],[80,-40],[80,40],[40,40]],waterfront:[[-80,188],[0,188],[40,188],[0,160]]};
  function ambientRoute(actor){
    refreshObstacles();
    const points=loops[actor.districtId]||loops.business;
    if(!actor._planCSpawned){
      const anchor=points[(actor.group.id||0)%points.length],choices=streets.filter(a=>Math.hypot(a.p[0][0]-anchor[0],a.p[0][1]-anchor[1])<65&&a.w>9&&arcClear(a)).sort((a,b)=>a.id.localeCompare(b.id));
      for(let k=0;k<choices.length;k++){
        const a=choices[((actor.group.id||0)+k)%choices.length],p=slice(a,Math.min(a.w-2,2+(actor.group.id%5)*2),a.w)[0];
        const others=[...(window.__TYCOON_V82_TRAFFIC__?.actors?.()||[]),...(typeof serviceVehicles==='undefined'?[]:serviceVehicles.map(group=>({group})))];
        if(others.some(o=>o!==actor&&o.group?.visible&&Math.hypot(o.group.position.x-p[0],o.group.position.z-p[1])<3&&Math.abs(o.group.position.y-p[2])<2))continue;
        if(typeof player!=='undefined'&&Math.hypot(player.position.x-p[0],player.position.z-p[1])<2&&Math.abs(player.position.y-p[2])<2)continue;
        // A spot is taken only if the car can really leave it (2026-10-19 review: arcs boxed in by buildings left cars frozen on the road for ever).
        const probe=v3([p[0],p[1],p[2]+.04]);probe.navArc=a.id;
        if(!points.some(q=>route(probe,v3([...q,0]),{access:false}).length))continue;
        actor.group.position.set(p[0],p[2]+.04,p[1]);actor.group.position.navArc=a.id;actor._planCSpawned=true;actor._planCFail=0;break;
      }
      if(!actor._planCSpawned)return [];
    }
    // Try every loop point once: a point behind a building (obstacles) must not freeze the car.
    for(let k=0;k<points.length;k++){
      const index=actor._planCStop||0;actor._planCStop=(index+1)%points.length;
      const r=route(actor.group.position,v3([...points[index],0]),{access:false});
      if(r.length){actor._planCFail=0;return r;}
    }
    // Boxed in on every side: after a few tries pick a new spot, but only when nobody is close enough to see it jump.
    actor._planCFail=(actor._planCFail||0)+1;
    if(actor._planCFail>=3&&!(typeof player!=='undefined'&&Math.hypot(player.position.x-actor.group.position.x,player.position.z-actor.group.position.z)<45)){actor._planCSpawned=false;actor._planCFail=0;}
    return [];
  }
  function districtRoute(fromId,toId,fromPos,toPos){
    const a=fromPos||v3([...(loops[fromId]||loops.business)[0],0]),b=toPos||v3([...(loops[toId]||loops.business)[0],0]);return route(a,b,{access:false,sourceAccess:!!fromPos,targetAccess:!!toPos});
  }
  const busLines=D.graph.transit.map(line=>{
    const projection=p=>{let best=Infinity,along=0,s=0;for(let i=1;i<line.pts.length;i++){
      const a=line.pts[i-1],b=line.pts[i],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz),t=l?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(l*l))):0,d=Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);
      if(d<best){best=d;along=s+l*t;}s+=l;
    }return along;};
    const loop=dist([...line.pts[0],0],[...line.pts.at(-1),0])<2;
    const pts=[line.pts[0],...line.stops,...(loop?[]:[line.pts.at(-1)])].sort((a,b)=>projection(a)-projection(b)).filter((p,i,a)=>!i||Math.hypot(p[0]-a[i-1][0],p[1]-a[i-1][1])>2);
    return {...line,loop,stations:loop?pts:pts.concat(pts.slice(1,-1).reverse())};
  });
  function busRoute(actor){
    if(actor._planCBusLine==null){actor._planCBusLine=busSerial++%busLines.length;actor._planCBusStop=0;}
    if(!actor._planCSpawned){ambientRoute(actor);if(!actor._planCSpawned)return [];}
    const line=busLines[actor._planCBusLine];
    actor.group.userData.planCBusLine=line.id;
    // A station that is unreachable right now (a building stands on the road) is skipped, the bus tries the next one.
    for(let k=0;k<line.stations.length;k++){
      const n=actor._planCBusStop;actor._planCBusStop=(n+1)%line.stations.length;
      const r=route(actor.group.position,v3([...line.stations[n],0]),{access:false});
      if(r.length)return r;
    }
    return [];
  }
  function tick(dt){
    if(!Number.isFinite(dt)||dt<=0)return;clock+=Math.min(dt,.25);
    refreshObstacles();
    pedOccupied.clear();const pedestrians=pedestrianGroups();for(const cross of D.graph.signalCrossings)if(pedestrians.some(g=>inCrossing(g.position,cross)))pedOccupied.add(cross.id);
    const current=typeof stageIndex==='number'?stageIndex:0;if(current<lastStage){gates.clear();for(const c of controllers.values())Object.assign(c,{actor:null,slot:0,elapsed:0});rebuildDriveways();}lastStage=current;
    for(const c of controllers.values()){
      if(c.actor?.visible===false)c.actor=null;
    }
    for(const group of phaseGroups.values()){
      const first=group[0];if(first.kind==='yield')continue;
      const duration=first.slot===4?10:12,blocked=group.some(c=>c.actor||occupiedCrossing(c.id));
      let elapsed=first.elapsed+Math.min(dt,.25),slot=first.slot;
      if(elapsed>=duration){if(blocked)elapsed=duration;else{elapsed-=duration;slot=(slot+1)%5;}}
      for(const c of group)Object.assign(c,{elapsed,slot});
    }
    window.PlanCV161?.updateSignalLights?.(state);
  }
  window.PlanCTrafficV161={version:1,route,districtRoute,ambientRoute,busRoute,busLines,advance,tick,state,walkAllowed,stepClear,roadY,overlay,diagnostics,arcs,gates,controllers,get obstacleVersion(){return obstacleVersion;},get time(){return clock;}};
})();
