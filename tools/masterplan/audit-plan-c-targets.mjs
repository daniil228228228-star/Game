// Audit the CURRENT core positions and worksite bays, not proposed C3 positions.
// No browser, scene instantiation or complete static-world collision claim.
// node tools/masterplan/audit-plan-c-targets.mjs [--json] [--strict]
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {pavementOracle} from './lane-paths-plan-c.mjs';
const root=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
const require=createRequire(import.meta.url),THREE=require('../../vendor/three_r128/three.min.js');
export function auditTargets(){
  const html=read('tycoon-v161.html'),T={THREE,console,LAYOUT_V161:'C'};T.window=T;vm.createContext(T);
  const execute=s=>vm.runInContext(s,T);
  const fn=name=>{const a=html.indexOf('function '+name+'(');if(a<0)throw new Error('Missing core owner '+name);return html.slice(a,html.indexOf('\n}',a)+2);};
  const constant=name=>{const declaration=html.match(new RegExp('^const '+name+' = [^;]+;','m'));if(!declaration)throw new Error('Missing core constant '+name);return declaration[0];};
  const stageStart=html.indexOf('const STAGES = [');execute(html.slice(stageStart,html.indexOf('\n];',stageStart)+3));
  for(const name of ['SPIRAL_BASE_RADIUS','SPIRAL_RADIUS_STEP','SPIRAL_ANGLE_STEP','BUILDING_OFFSET','BUILDING_RADIUS','INDUSTRIAL_ZONE_OFFSET_X','SAWMILL_POS','CONCRETE_PLANT_POS','METAL_YARD_POS'])execute(constant(name));
  execute(read('assets/yards-v161.js'));execute(constant('PLANK_TRUCK_BAY_POS_V161'));
  for(const name of ['stagePosition','buildingPosition','buildingCollisionRadius','worksiteVehicleApproach','cargoInfo'])execute(fn(name));
  execute(read('assets/plan-c-data-v161.js'));execute(read('assets/plan-c-traffic-v161.js'));
  const stages=execute('STAGES'),D=T.PlanCDataV161,A=T.PlanCTrafficV161,O=pavementOracle(D),cargos=['planks','concrete','metal'];
  const sources=Object.fromEntries(cargos.map(c=>[c,T.cargoInfo(c).source]));
  const corridorColors=new Set(['asph','ramp','median','medLawn','medM'].map(k=>D.palette[k]));
  const placements=stages.map((stage,index)=>{const pos=T.buildingPosition(index),surface=O.surface(pos.x,pos.z,0);return {index,name:stage.name,at:[pos.x,pos.z].map(v=>+v.toFixed(2)),centreInRoadCorridor:corridorColors.has(surface.ci)};});
  const levels=[];
  for(const level of [1,5]){
    const entries=stages.map((stage,index)=>({category:'building',shape:'circle',flags:{agent:true},pos:T.buildingPosition(index),radius:T.buildingCollisionRadius({index,level})}));
    T.__TYCOON_V83_COLLISIONS__={query:()=>entries};
    const trips=[];
    for(let index=0;index<stages.length;index++)for(const cargo of cargos){
      const entry={index,level,pos:entries[index].pos},goal=T.worksiteVehicleApproach(entry,'delivery',{userData:{cargo}}),route=A.route(sources[cargo],goal);
      const conflicts=new Set();
      for(let i=1;i<route.length;i++){
        const a=route[i-1],b=route[i],n=Math.max(1,Math.ceil(a.distanceTo(b)/.5));
        for(let k=0;k<=n;k++){
          const p=a.clone().lerp(b,k/n);if(p.y>3)continue;
          for(let j=0;j<entries.length;j++)if(Math.hypot(p.x-entries[j].pos.x,p.z-entries[j].pos.z)<entries[j].radius+1.23)conflicts.add(j);
        }
      }
      trips.push({stage:index,cargo,goal:[goal.x,goal.z].map(v=>+v.toFixed(2)),routeExists:route.length>1,stageColliderConflicts:[...conflicts]});
    }
    levels.push({level,trips,blocked:trips.filter(t=>!t.routeExists).length,throughStageColliders:trips.filter(t=>t.stageColliderConflicts.length).length});
  }
  return {scope:'Current core STAGES/positions/cargoInfo/Yards bays, worksiteVehicleApproach and circular stage physics at levels 1/5. No full scene/static industrial colliders; route existence is not acceptance.',sources:Object.fromEntries(Object.entries(sources).map(([k,p])=>[k,[p.x,p.z]])),placements,levels};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const report=auditTargets();
  if(process.argv.includes('--json'))console.log(JSON.stringify(report,null,2));
  else{
    console.log(report.scope);
    console.log('Stage centres in road corridors:',report.placements.filter(p=>p.centreInRoadCorridor).map(p=>`${p.index} ${p.name} (${p.at})`).join('; ')||'none');
    for(const row of report.levels)console.log(`Level ${row.level}: ${row.trips.length} real source/goal pairs; ${row.blocked} without a route; ${row.throughStageColliders} routes intersect stage colliders`);
  }
  if(process.argv.includes('--strict')&&(report.placements.some(p=>p.centreInRoadCorridor)||report.levels.some(l=>l.blocked||l.throughStageColliders)))process.exitCode=1;
}
