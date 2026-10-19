// Executes the shipped V82 owner (not a rewritten mover) on controlled fixtures. No browser/DOM game-loop claim.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), THREE = require('../vendor/three_r128/three.min.js');
const html = fs.readFileSync(new URL('../tycoon-v161.html', import.meta.url), 'utf8');
const dataSource = fs.readFileSync(new URL('../assets/plan-c-data-v161.js', import.meta.url), 'utf8');
const coreFunction = (name,source=html) => { const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);return source.slice(start,source.indexOf('\n}',start)+2); };
const exports = `window.fixture={pathDataV82,samplePathV82,arterialShuttleV82,routeDataV82,nearestPathDistanceV82,cityVehicleAvoidanceV82,residentYieldFactorV82,rectOverlapV82,moveClosedLoopV82,stateOf,clear(){actorSnapshotAt=-Infinity;serviceSnapshotAt=-Infinity;}};`;
let now = 0, assertions = 0;
const check = (ok, msg) => { assert.ok(ok, msg); assertions++; };
const close = (a, b, msg, eps = 1e-6) => check(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
export function makeContext(layout='C',source=html) {
  const T = { THREE, console, Math, Map, WeakMap, performance: { now: () => now }, LAYOUT_V161: layout,
    document: { readyState: 'loading', addEventListener() {} }, transportMotionKernel: {},
    districtArterialPath: null, districtArterialEndpoints: null,
    districtRoadLevelV37: () => 1, districtInfrastructureConnectorPathV37: () => [new THREE.Vector3(0,0,0), new THREE.Vector3(20,0,0)],
    CITY_DISTRICTS: [{id:'fixture'}], districtTrafficSpeedFactor: () => 1, cityTrafficSpeedFactor: () => 1,
    player: new THREE.Object3D(), serviceVehicles: [], livingCityRuntime: {cars:[],districtCars:[],arterialCars:[],residents:[]},
    reconcileVehicleAssignmentV151(){},updateVehicleProgressWatch(){},recordFleetWear(){},releaseVehicleReservation(){},setTruckCargoVisual(){},setVehicleStatus(){},
    vehicleMetaSpeedMultiplier:()=>1,fleetVehicleSpeedMultiplier:()=>1,eventVehicleMultiplier:()=>1,logisticsSpeedMultiplier:()=>1,logisticsRecheckTime:()=>100,playerVelocity:new THREE.Vector3(),lang:'ru',
  };
  T.window = T; T.player.position.set(1000,0,1000); vm.createContext(T);
  vm.runInContext(dataSource, T);
  for(const name of ['vehicleSameLevelV161','vehicleSurfaceYV161'])vm.runInContext(coreFunction(name),T);
  for(const name of ['serviceVehicleYieldFactor','moveWorkVehicle'])vm.runInContext(coreFunction(name,source),T);
  const script=source.match(/<script id="v82-global-transport-audit">([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script.replace(/\}\)\(\);\s*$/, exports + '\n})();'), T);
  return T;
}
const T = makeContext(), D = T.PlanCDataV161, F = T.fixture;

// Every cardinal heading: forward lane is on the right in C; reverse lane also right of its own heading.
for (const layout of ['B','C']) for (const [hx,hz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
  const t = makeContext(layout);
  t.districtInfrastructureConnectorPathV37 = () => [new THREE.Vector3(),new THREE.Vector3(hx*20,0,hz*20)];
  const data = t.fixture.arterialShuttleV82('fixture'), p=data.p[0], sign=layout==='C'?1:-1;
  check(sign*(hx*p.z-hz*p.x)>0, `${layout}: forward lane ${hx},${hz}`);
  // The remote U-turn must go past the endpoint, and the home U-turn behind the origin.
  check(data.p.some(p=>p.x*hx+p.z*hz>20.2), `${layout}: outward remote U-turn`);
  check(data.p.some(p=>p.x*hx+p.z*hz<-.2), `${layout}: outward home U-turn`);
}

const singleton = F.samplePathV82(F.pathDataV82([new THREE.Vector3(1,2,3)]), 0);
check([singleton.x,singleton.y,singleton.z,singleton.yaw].every(Number.isFinite),'singleton path stays finite');
const pnr = D.graph.levels.find(r=>r.id==='e101');
check(pnr && pnr.p.at(-1)[1]===58, 'parking profile includes the repaired approach');

const upper = D.graph.levels.find(r=>r.ref==='M1'&&r.p[0][0]<0), lower = D.graph.levels.find(r=>r.p[0][0]===0&&r.ref===null&&r.p[0][1]<-240&&r.p.at(-1)[1]>-240);
close(D.roadY(upper.id,-1,-240),5.3,'M1 above Main Avenue');
close(D.roadY(lower.id,0,-240),0,'Main Avenue under M1');
check(D.roadY('missing',0,0)===null,'unknown road is not treated as ground');
check(D.roadY(upper.id,-5,-200)===null,'road lookup rejects unrelated lateral position');
close(T.vehicleSurfaceYV161({x:-1,z:-240,roadId:upper.id},{y:.04}),5.34,'explicit edge chooses upper road even from low spawn');
close(T.vehicleSurfaceYV161({x:0,z:-240,roadId:lower.id},{y:5.34}),.04,'explicit edge chooses lower road without max surface');
close(T.vehicleSurfaceYV161({x:0,z:-240},{y:.04}),.04,'legacy lower path does not jump to bridge');
close(T.vehicleSurfaceYV161({x:0,z:-240},{y:5.34}),5.34,'legacy upper path is not dropped to ground');
check(T.vehicleSurfaceYV161({x:1000,z:1000},{y:.04})===null,'no-support position is rejected');

const actor = (x,y,z,kind='civilian') => {const g=new THREE.Object3D();g.position.set(x,y,z);return {group:g,kind,pause:0};};
const a=actor(0,.04,0), b=actor(0,5.34,1.8);
T.livingCityRuntime.cars=[a,b]; F.clear();
close(F.cityVehicleAvoidanceV82(a),1,'upper vehicle does not block lower vehicle');
check(!F.rectOverlapV82(a,b),'stacked vehicles do not overlap');
b.group.position.y=.04;F.clear();
close(F.cityVehicleAvoidanceV82(a),0,'same-level following still stops');
T.livingCityRuntime.cars=[a];F.clear();
T.player.position.set(0,5.34,.2);close(F.cityVehicleAvoidanceV82(a),1,'player on bridge does not stop lower car');
T.player.position.y=.04;close(F.cityVehicleAvoidanceV82(a),0,'same-level player safety preserved');T.player.position.set(1000,0,1000);
T.livingCityRuntime.residents=[actor(0,5.34,.1)];close(F.residentYieldFactorV82(a),1,'upper resident ignored');
T.livingCityRuntime.residents[0].group.position.y=.04;close(F.residentYieldFactorV82(a),0,'same-level resident protected');T.livingCityRuntime.residents=[];
const truck=new THREE.Object3D();truck.position.set(0,5.34,.2);truck.userData.role='delivery';T.serviceVehicles=[truck];F.clear();
close(F.cityVehicleAvoidanceV82(a),1,'upper service truck ignored');truck.position.y=.04;F.clear();
close(F.cityVehicleAvoidanceV82(a),0,'same-level service truck retains priority');T.serviceVehicles=[];T.livingCityRuntime.cars=[];F.clear();

// A route update at the same XZ but a different level/road must invalidate the mover's cache.
const c=actor(-5,5.34,-240);c.route=[new THREE.Vector3(-5,5.3,-240),new THREE.Vector3(-1,5.3,-240)];c.route.planC=true;
for(const p of c.route)p.roadId=upper.id;
const old=F.routeDataV82(c);c.route=c.route.map(p=>p.clone().setY(0));c.route.planC=true;
check(F.routeDataV82(c)!==old,'route cache includes height and edge identity');
const invalid=actor(1000,.04,1000);invalid.route=[new THREE.Vector3(1000,0,1000),new THREE.Vector3(1010,0,1000)];invalid.route.planC=true;
for(const p of invalid.route)p.roadId='missing';
const invalidBefore=invalid.group.position.toArray();let invalidComplete=0;
T.transportMotionKernel.moveWaypointCityVehicle(invalid,1/30,()=>invalidComplete++);
check(invalid.group.position.toArray().every((v,i)=>v===invalidBefore[i]),'invalid road does not move or teleport');
check(F.routeDataV82(invalid).d===0&&F.stateOf(invalid).speed===0&&invalidComplete===0,'no support does not credit route progress or completion');
const graded=F.pathDataV82([new THREE.Vector3(0,0,0),new THREE.Vector3(0,2,2)]);graded.planC=true;
close(F.samplePathV82(graded,graded.total/2).y,1,'distance follower interpolates grade height');

// Run the REAL distance follower along every compiled ramp at three simulation rates.
let trips=0,ticks=0;
for(const fps of [15,30,60]) for(const ramp of D.graph.levels.filter(r=>/^I\d\.\d+$/.test(r.id))) {
  const car=actor(ramp.p[0][0],ramp.p[0][2]+.04,ramp.p[0][1]);
  car.route=ramp.p.map(([x,z,y])=>{const p=new THREE.Vector3(x,y,z);p.roadId=ramp.id;return p;});car.route.planC=true;
  const p=ramp.p[0],q=ramp.p[1];car.group.rotation.y=Math.atan2(q[0]-p[0],q[1]-p[1]);
  let done=0,failed=0;const limit=Math.ceil(F.pathDataV82(car.route).total/0.6*fps)+fps*5;
  for(let i=0;i<limit&&!done&&!failed;i++) {
    now+=1000/fps;T.transportMotionKernel.moveWaypointCityVehicle(car,1/fps,(_c,empty)=>empty?failed++:done++);ticks++;
    const h=D.roadY(ramp.id,car.group.position.x,car.group.position.z);
    check(h!==null&&Math.abs(car.group.position.y-h-.04)<.002, `${ramp.id}/${fps}Hz follows its level`);
  }
  check(done===1&&!failed,`${ramp.id}/${fps}Hz completes without invalid-route callback`);trips++;
}

// Legacy B ignores vertical separation exactly as before and keeps the flat city-car baseline.
const B=makeContext('B');check(B.vehicleSameLevelV161({y:0},{y:5.3}),'B retains old 2D avoidance');
close(B.vehicleSurfaceYV161({x:0,y:9,z:0,roadId:'missing'},{y:9}),.04,'B retains .04 baseline');

// Actual service-fleet owner and its arbitration, not just the city-car follower.
const service = new THREE.Object3D();service.position.set(0,0,-240);service.userData={role:'delivery',state:'returning',pathIndex:0,speed:2.8,currentSpeed:0};
const ahead = new THREE.Object3D();ahead.position.set(0,5.3,-239);ahead.userData={role:'delivery',state:'returning',path:[new THREE.Vector3(0,5.3,-230)],pathIndex:0};
T.serviceVehicles=[service,ahead];
close(T.serviceVehicleYieldFactor(service,new THREE.Vector3(0,0,-230)),1,'service/service levels separated');
ahead.position.y=0;close(T.serviceVehicleYieldFactor(service,new THREE.Vector3(0,0,-230)),0,'service same-level following preserved');
T.serviceVehicles=[service];T.player.position.set(0,5.3,-240);
service.userData.path=[new THREE.Vector3(0,0,-240),new THREE.Vector3(0,0,-230)];service.userData.path.planC=true;
for(const p of service.userData.path)p.roadId=lower.id;
T.moveWorkVehicle(service,1/30);check(service.position.z>-240,'service moves under a player on upper road');close(service.position.y,0,'service uses its lower profile');
T.player.position.set(1000,0,1000);
service.position.set(-5,5.3,-240);service.userData.path=[new THREE.Vector3(-5,5.3,-240),new THREE.Vector3(-1,5.3,-240)];service.userData.path.planC=true;service.userData.pathIndex=0;
for(const p of service.userData.path)p.roadId=upper.id;
T.moveWorkVehicle(service,1/30);check(service.position.x>-5,'service follows upper road');close(service.position.y,D.roadY(upper.id,service.position.x,service.position.z),'service keeps upper profile and original zero baseline');
for(const name of ['circlePushAgainstEntry','solveCircle']){
  const start=html.indexOf('  function '+name+'(');assert.ok(start>=0);vm.runInContext(html.slice(start,html.indexOf('\n  }',start)+4),T);
}
const entry={category:'vehicle',shape:'obb',pos:new THREE.Vector3(0,5.3,0),hx:.5,hz:1.12,yaw:0};
const below=T.solveCircle(0,0,.4,[entry],4,null,0);check(!below.hit&&below.x===0&&below.z===0,'upper car does not push lower pedestrian');
check(T.solveCircle(0,0,.4,[entry],4,null,5.3).hit,'same-level vehicle collision preserved');
check(D.roadY('__proto__',0,0)===null,'prototype keys cannot masquerade as road identities');
// The old fleet deadlock rescue is another movement owner: it must not arbitrate across bridges.
T.moving=new Set(['to_source','outbound','returning']);T.pairStall=new Map();T.safe=(fn,fallback=null)=>{try{return fn();}catch{return fallback;}};T.deliveryPrimary=()=>'';
for(const name of ['vehicleIdV74','deadlockPriorityV74','advanceWinnerV74','deadlockGuardV74']){
  const start=html.indexOf('  function '+name+'(');assert.ok(start>=0);
  const lineEnd=html.indexOf('\n',start),oneLine=html.slice(start,lineEnd).trimEnd().endsWith('}');
  vm.runInContext(html.slice(start,oneLine?lineEnd:html.indexOf('\n  }',start)+4),T);
}
const s1=new THREE.Object3D(),s2=new THREE.Object3D();s1.position.set(0,0,0);s2.position.set(0,5.3,.2);
s1.userData={role:'delivery',state:'returning',logisticsId:'one'};s2.userData={role:'delivery',state:'returning',logisticsId:'two'};T.serviceVehicles=[s1,s2];
for(let i=0;i<20;i++)T.deadlockGuardV74();
check(T.pairStall.size===0&&!s1.userData._v85YieldUntil&&!s2.userData._v85YieldUntil,'deadlock guard ignores separate levels');
check(!T.advanceWinnerV74(s1,s2),'direct rescue cannot move a truck on another level');
s2.position.y=0;for(let i=0;i<14;i++)T.deadlockGuardV74();
check(s1.userData._v85RightOfWayUntil>now&&s2.userData._v85YieldUntil>now,'same-level deadlock arbitration preserved');
console.log(`PASS ${assertions} traffic-level assertions; ${trips} real-mover ramp trips at 15/30/60Hz (${ticks} ticks); B guards preserved`);
