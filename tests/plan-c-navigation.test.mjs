// Shipped directed router + shipped city motion owner, checked against the compiled pavement.
// Controlled VM scenarios; this is not a browser/game-loop acceptance test.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {makeContext} from './plan-c-traffic-levels.test.mjs';
import {pavementOracle} from '../tools/masterplan/lane-paths-plan-c.mjs';
import {buildTurnGraph} from '../tools/masterplan/turns-plan-c.mjs';
import {buildPlan} from '../tools/masterplan/plan-c.mjs';
const require=createRequire(import.meta.url),THREE=require('../vendor/three_r128/three.min.js');
const source=fs.readFileSync(new URL('../assets/plan-c-traffic-v161.js',import.meta.url),'utf8');
let checks=0,trips=0,ticks=0;
const check=(ok,msg)=>{assert.ok(ok,msg);checks++;};
function context(){const T=makeContext();T.scene=new THREE.Scene();T.npcWorkers=[];vm.runInContext(source,T);return T;}
const T=context(),D=T.PlanCDataV161,A=T.PlanCTrafficV161,O=pavementOracle(D),G=buildTurnGraph(buildPlan());
check(D.graph.navigation.arcs.length===[...G.full.values()].reduce((n,a)=>n+a.length,0),'all permitted graph transitions have geometry');
check(D.graph.navigation.failures.length===0,'no suppressed navigation failures');
const vertices=new Map();
for(const arc of A.arcs.values()){
  for(const [id,p] of [[arc.u,arc.p[0]],[arc.v,arc.p.at(-1)]]){
    if(vertices.has(id))check(Math.hypot(...p.map((v,i)=>v-vertices.get(id)[i]))<.003,`continuous vertex ${id}`);else vertices.set(id,p);
  }
  for(let i=0;i<arc.p.length;i++){
    const p=arc.p[i],u=arc.p[Math.max(0,i-1)],v=arc.p[Math.min(arc.p.length-1,i+1)],l=Math.hypot(v[0]-u[0],v[1]-u[1])||1,h=[(v[0]-u[0])/l,(v[1]-u[1])/l];
    if(i)check(Math.hypot(...p.map((q,k)=>q-arc.p[i-1][k]))>.00001,`${arc.id}: no zero length steps`);
    check(O.clear(p,.70),`${arc.id}: lane width at ${i}`);
    // Largest shipped service body: 2.24 x 1.02, not just its centre point.
    for(const f of [-1.12,0,1.12])for(const w of [-.51,.51])check(O.at(p[0]+h[0]*f-h[1]*w,p[1]+h[1]*f+h[0]*w,p[2]+(v[2]-u[2])/l*f),`${arc.id}: body on pavement at ${i}`);
    if(i&&i<arc.p.length-1){const aa=Math.atan2(p[1]-u[1],p[0]-u[0]),bb=Math.atan2(v[1]-p[1],v[0]-p[0]);check(Math.abs(Math.atan2(Math.sin(bb-aa),Math.cos(bb-aa)))<.60,`${arc.id}: no angular kink`);}
  }
}
const point=(arc,d)=>{const i=Math.max(1,arc.cum.findIndex(s=>s>=d)),a=arc.p[i-1],b=arc.p[i],t=(d-arc.cum[i-1])/(arc.cum[i]-arc.cum[i-1]);const p=new THREE.Vector3(a[0]+(b[0]-a[0])*t,a[2]+(b[2]-a[2])*t,a[1]+(b[1]-a[1])*t);p.navArc=arc.id;return p;};
const actor=(p,kind='bus')=>{const g=new THREE.Object3D();g.position.copy(p);g.position.navArc=p.navArc;g.position.y+=.04;return {group:g,kind,pause:0};};

// Each controlled approach completes under the actual distance follower, including long I2 boxes.
const approaches=new Map();for(const arc of A.arcs.values())if(arc.signal&&!approaches.has(arc.signal.id+'|'+arc.signal.approach))approaches.set(arc.signal.id+'|'+arc.signal.approach,arc);
for(const hz of [15,30,60])for(const turn of approaches.values()){
  const t=context(),api=t.PlanCTrafficV161,arcs=[...api.arcs.values()],incoming=arcs.find(a=>a.v===turn.u&&a.kind==='street'),outgoing=arcs.find(a=>a.u===turn.v&&a.kind==='street');
  if(!incoming||!outgoing)continue;
  const c=actor(point(incoming,Math.max(.1,incoming.w-8))),goal=point(outgoing,Math.min(outgoing.w-.1,8));
  c.route=api.route(c.group.position,goal,{access:false});check(c.route.length>1,'controlled route exists');
  c.group.rotation.y=Math.atan2(c.route[1].x-c.route[0].x,c.route[1].z-c.route[0].z);
  t.livingCityRuntime.cars=[c];let done=false,waited=false;
  for(let i=0;i<hz*250&&!done;i++){
    api.tick(1/hz);const before=c.group.position.clone();t.fixture.clear();
    t.transportMotionKernel.moveWaypointCityVehicle(c,1/hz,()=>{done=true;});ticks++;
    if(before.distanceTo(c.group.position)<1e-7)waited=true;
    check(c.group.position.distanceTo(before)<.4,'bounded step, no teleport at junction');
    check(O.at(c.group.position.x,c.group.position.z,c.group.position.y-.04),'moving centre on pavement');
    if(i%5===0){const p=c.group.position,y=c.group.rotation.y;for(const f of [-1.09,1.09])for(const w of [-.54,.54])check(O.at(p.x+Math.sin(y)*f+Math.cos(y)*w,p.z+Math.cos(y)*f-Math.sin(y)*w,p.y-.04),`${turn.signal.id}: actual bus body stays on pavement`);}
  }
  check(done,`junction ${turn.signal.id} ${turn.signal.approach} completes at ${hz}Hz`);trips++;
}

// Exact red-line cap, mutual exclusion and phase extension while a car is in the box.
const signal=[...A.arcs.values()].find(a=>a.signal&&!a.signal.kind),id=signal.signal.id,control=A.controllers.get(id),s={...signal.signal,d:5,exit:25};
const c=actor(new THREE.Vector3()),other=actor(new THREE.Vector3()),r=[];r.stops=[s];
control.slot=4;control.elapsed=1;
check(A.advance(c,r,4,3)===1,'red stops at the centre stop plane');
check(A.advance(c,r,5,.2)===0,'red holds without creeping');
control.slot=['E','S','W','N'].indexOf(s.approach[0]>0?'E':s.approach[0]<0?'W':s.approach[1]>0?'S':'N');control.elapsed=0;
check(A.advance(c,r,5,.2)===.2,'green admits');
check(A.advance(other,r,5,.2)===0,'second conflicting admission waits');
control.elapsed=11.99;A.tick(.1);check(control.elapsed===12,'occupied box extends all-red');
A.advance(c,r,26,.1);check(!control.actor,'outgoing tail releases junction');
control.slot=['E','S','W','N'].indexOf(s.approach[0]>0?'E':s.approach[0]<0?'W':s.approach[1]>0?'S':'N');control.elapsed=0;
A.advance(c,r,5,.2);const splice=[];splice.stops=[];
c.group.position.set(s.leave[0]+s.out[0],0,s.leave[1]+s.out[1]);A.advance(c,splice,0,.1);
check(!control.actor,'reroute releases by physical outgoing tail, without trusting new route distance');

// All four conflicting approaches at I2 arrive together: no overlap and no starvation.
{
  const t=context(),api=t.PlanCTrafficV161,arcs=[...api.arcs.values()],turns=new Map();
  for(const a of arcs)if(a.signal?.id==='n122'&&!turns.has(''+a.signal.approach))turns.set(''+a.signal.approach,a);
  const cars=[...turns.values()].map(turn=>{
    const incoming=arcs.find(a=>a.v===turn.u&&a.kind==='street'),outgoing=arcs.find(a=>a.u===turn.v&&a.kind==='street'),c=actor(point(incoming,Math.max(.1,incoming.w-8)));
    c.route=api.route(c.group.position,point(outgoing,Math.min(outgoing.w-.1,8)),{access:false});
    c.group.rotation.y=Math.atan2(c.route[1].x-c.route[0].x,c.route[1].z-c.route[0].z);return c;
  });
  check(cars.length===4,'I2 queue test has four directions');t.livingCityRuntime.cars=cars;
  for(let frame=0;frame<30*600&&cars.some(c=>c.group.visible);frame++){
    api.tick(1/30);t.fixture.clear();for(const c of cars)t.transportMotionKernel.moveWaypointCityVehicle(c,1/30,()=>{c.group.visible=false;});
    for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++)if(cars[i].group.visible&&cars[j].group.visible)check(!t.fixture.rectOverlapV82(cars[i],cars[j]),'I2 queues never overlap');
  }
  check(cars.every(c=>!c.group.visible),'all simultaneous I2 queues clear');trips+=4;
}

// Signal colours are owned by the very same phase state used for admission.
for(const [sid,ctl]of A.controllers){if(ctl.kind)continue;ctl.actor=null;for(let slot=0;slot<5;slot++){
  ctl.slot=slot;ctl.elapsed=0;const colors=[[1,0],[0,1],[-1,0],[0,-1]].map(h=>A.state(sid,h));check(colors.filter(c=>c==='green').length===(slot===4?0:1),'one protected approach or pedestrian all-red');
}}
const coord=D.graph.signalCoordination[0];if(coord){A.controllers.get(coord[0]).elapsed=0;A.controllers.get(coord[1]).elapsed=0;A.tick(.1);check(A.controllers.get(coord[0]).elapsed===A.controllers.get(coord[1]).elapsed,'I2 and parking phases coordinated');}

// Logistics uses the shipped FSM and progress watcher: one delivery, loading/unloading, then home.
const html=fs.readFileSync(new URL('../tycoon-v161.html',import.meta.url),'utf8');
const core=name=>{const a=html.indexOf('function '+name+'(');return html.slice(a,html.indexOf('\n}',a)+2);};
for(const hz of [15,30,60]){
  const t=context(),api=t.PlanCTrafficV161;
  for(const name of ['updateVehicleProgressWatch','completeVehicleDelivery'])vm.runInContext(core(name),t);
  Object.assign(t,{stats:{materialDeliveries:0},buildRoadRoute:(a,b)=>api.route(a,b,{access:false}),logisticsLoadingTime:()=>1,logisticsUnloadingTime:()=>1,jobTargetName:()=>'',deliveryPrimary:()=>'',constructionBuildNear:()=>null,cargoName:()=>'',stageName:()=>'',STAGES:[{}],sfx:{delivery(){}},spawnBurst(){},toast(){},spawnFloatingTextV117(){},checkContracts(){},updateHUD(){},save(){}});
  const arcs=[...api.arcs.values()],a=arcs.find(a=>a.kind==='street'&&a.road==='e72'),b=arcs.find(a=>a.kind==='street'&&a.road==='e101');
  check(a&&b,'logistics test selects city and P+R approach');
  const home=point(a,a.w/2),source=point(b,b.w*.7),target=point(a,a.w*.8),v=new THREE.Object3D(),ticket={cargo:'planks',assignedVehicle:'fixture',delivered:false},build={entry:{pos:target,index:0,underConstruction:true},deliveryPlan:[ticket]};
  v.position.copy(home);v.position.navArc=home.navArc;v.userData={role:'delivery',state:'to_source',path:api.route(home,source,{access:false}),pathIndex:0,home,cargoSource:source,jobTarget:target,cargo:'planks',speed:2.8,currentSpeed:0,logisticsId:'fixture',deliveryTicket:ticket,assignedBuild:build};
  t.serviceVehicles=[v];const seen=new Set();let maxWait=0;
  for(let i=0;i<hz*1400&&v.userData.state!=='idle';i++){
    api.tick(1/hz);t.fixture.clear();t.moveWorkVehicle(v,1/hz);ticks++;seen.add(v.userData.state);
    check(O.at(v.position.x,v.position.z,v.position.y),'service centre remains on pavement');
    if(v.userData._planCSignalWait){maxWait++;check(v.userData._ticketStallTime<1,'red wait preserves ticket watchdog');}
  }
  check(v.userData.state==='idle',`service cycle finishes at ${hz}Hz`);
  check(['loading','outbound','working','returning','idle'].every(s=>seen.has(s)),'all logistics states exercised');
  check(t.stats.materialDeliveries===1&&ticket.delivered,'delivery credited exactly once');
  check(v.position.distanceTo(home)<.02,'truck returns to its own bay');check(maxWait>0,'service cycle waited for a signal');trips++;
}

// Pedestrians cannot start on red, can leave after their phase ends, and hold cars while crossing.
const cross=D.graph.signalCrossings[0],ctl=A.controllers.get(cross.id),mid=new THREE.Vector3(cross.at[0],0,cross.at[1]);
const from=mid.clone();if(cross.axis==='x')from.z-=cross.half+1;else from.x-=cross.half+1;
ctl.slot=0;ctl.elapsed=0;check(!A.walkAllowed(from,mid),'pedestrian waits on vehicle green');
ctl.slot=4;ctl.elapsed=0;check(A.walkAllowed(from,mid),'pedestrian starts in all-red phase');
ctl.slot=0;check(A.walkAllowed(mid,from),'pedestrian can finish crossing after phase');
T.player.position.copy(mid);A.tick(.1);check(A.state(cross.id,[1,0])==='red','occupied crossing holds vehicles');T.player.position.set(1000,0,1000);A.tick(.1);

// Physical accesses are paired with the route; impossible/water/median targets fail closed.
const street=[...A.arcs.values()].find(a=>a.kind==='street'&&a.road&&a.p.length>20&&a.p[0][0]>0&&a.p[0][1]>20&&a.p[0][1]<140),start=point(street,street.w/2);
const badBefore=A.gates.size;check(A.route(start,new THREE.Vector3(-210,0,40)).length===0,'no river shortcut');check(A.gates.size===badBefore,'failed route creates no driveway');
let accessTrip=null;
for(const [dx,dz]of [[2,0],[-2,0],[0,2],[0,-2],[4,0],[0,4]]){const target=start.clone().add(new THREE.Vector3(dx,0,dz));const r=A.route(start,target);if(r.some(p=>p.roadId?.startsWith('access'))){accessTrip={r,target};break;}}
check(accessTrip,'reachable short paved access exists');
const backRoute=A.route(accessTrip.target,start);check(backRoute.length>1&&backRoute.planC,'access has legal return');
check(T.scene.getObjectByName('planCAccessV161')?.geometry.attributes.position.count>0,'route access is drawn');

// Three bus lines visit their ordered stops and can continue from every stop, without a position splice.
for(let line=0;line<3;line++){
  const c=actor(new THREE.Vector3());c.districtId='business';c._planCBusLine=line;c._planCBusStop=0;
  for(let i=0;i<A.busLines[line].stations.length+1;i++){
    const r=A.busRoute(c);check(r.length>1,`${A.busLines[line].id}: next stop reachable`);
    check(r[0].distanceTo(c.group.position)<.15,'bus starts at its current lane position');
    c.group.position.copy(r.at(-1));c.group.position.navArc=r.at(-1).navArc;
  }
}
// Layout B must not create a C router at all.
const B={window:{LAYOUT_V161:'B'}};vm.runInNewContext(source,B);check(!B.window.PlanCTrafficV161,'B is excluded at module entry');
console.log(`PASS ${checks} navigation assertions; ${trips} completed controlled approaches at 15/30/60Hz (${ticks} mover ticks); pavement/body, bus return, gates and pedestrian phases`);
