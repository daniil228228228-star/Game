/* Authored landscape composition. No economy, road, interaction or save writes. */
(()=>{
 'use strict';
 const root=new THREE.Group();root.name='neighborhoodV156';scene.add(root);
 const gardens=new Map(),spots=[],palette=[0xe7dcab,0xebdfce,0xc49b86];
 const runtime={relocated:0,retired:0,meadows:0,gardens:0,checks:0};
 let last=0;
 const reserved=[new THREE.Vector3(-5.8,0,2.65),new THREE.Vector3(1.35,0,2.85),GENERATOR_POS,SAWMILL_POS,CONCRETE_PLANT_POS,METAL_YARD_POS,FLEET_DEPOT_PAD_POS_V118,SAWMILL_PAD_POS_V118,CONCRETE_PAD_POS_V118,METAL_PAD_POS_V118,MARKET_PLAZA_CENTER_V116,
   ...STAGES.map((_,i)=>stagePosition(i)),...STAGES.map((_,i)=>buildingPosition(i)),...MARKET_STALLS_V116.map(s=>s.pos),...Object.values(LOGISTICS_ZONES).map(z=>z.pos),
   ...CITY_DISTRICTS.map(d=>({...d.pos,reserveRadius:18})),...SPECIAL_PROJECTS.map(p=>({...p.pos,reserveRadius:7}))];
 const futureRoads=[];
 for(let i=0;i<STAGES.length;i++){const path=window.__TYCOON_STAGE_ROADS__?.route?.(i)||stageRoadPolylineV367(i);for(let j=1;j<path.length;j++)futureRoads.push({a:path[j-1],b:path[j],width:2.66});}
 function segmentDistance(x,z,s){const vx=s.b.x-s.a.x,vz=s.b.z-s.a.z,l=vx*vx+vz*vz,t=l?Math.max(0,Math.min(1,((x-s.a.x)*vx+(z-s.a.z)*vz)/l)):0;return Math.hypot(x-s.a.x-vx*t,z-s.a.z-vz*t);}
 function clear(x,z,r=.7,roads=window.__TYCOON_V84_ROADS__?.segments?.()||[]){
   if(!Number.isFinite(x)||!Number.isFinite(z)||Math.abs(x)>GROUND_HALF-5||Math.abs(z)>GROUND_HALF-5||Math.hypot(x,z)<7+r)return false;
   if(distToNearestRoadSegment(x,z)<2.4+r)return false;
   if([...roads,...futureRoads].some(s=>segmentDistance(x,z,s)<(Number(s.width||s.w)||2.66)/2+1+r))return false;
   for(const p of reserved)if(p&&Math.hypot(x-p.x,z-p.z)<(p.reserveRadius||4)+r)return false;
   for(const e of window.__TYCOON_V83_COLLISIONS__?.query?.('placement')||[]){
     if(!e?.pos||e.owner?.userData?.v64RandomScenery)continue;
     const extent=e.shape==='obb'?Math.hypot(e.hx||0,e.hz||0):(e.radius||0);
     if(Math.hypot(x-e.pos.x,z-e.pos.z)<extent+r+.6)return false;
   }
   for(const p of spots)if(Math.hypot(x-p.x,z-p.z)<r+p.r+.6)return false;
   return true;
 }
 function remember(x,z,r){spots.push({x,z,r});}
 // Stable clusters leave central delivery routes empty, without changing harvestable sources.
 const anchors=[[-49,28],[-27,43],[4,48],[39,37],[49,8],[39,-40],[4,-48],[-28,-42]];
 const scenery=scene.children.filter(o=>o.userData?.v64RandomScenery);
 for(let i=0;i<scenery.length;i++){
   const o=scenery[i],a=anchors[i%anchors.length],r=o.userData.v64SceneryKind==='tree'?1.25:.7;let found=false;
   for(let k=0;k<96;k++){
     const n=Math.floor(i/anchors.length)+k,angle=n*2.39996323+(i%anchors.length)*.37,ring=2+Math.sqrt(n+1)*2.65,x=a[0]+Math.cos(angle)*ring,z=a[1]+Math.sin(angle)*ring;
     if(!clear(x,z,r))continue;o.position.set(x,0,z);o.visible=true;delete o.userData.v84HiddenRoadConflict;delete o.userData.v93RoadClearance;remember(x,z,r);runtime.relocated++;found=true;break;
   }
   if(!found){o.visible=false;o.userData.v84HiddenRoadConflict=true;runtime.retired++;}
 }
 const mulch=createConcreteMaterial(0x897453,{roughness:1}),stone=createConcreteMaterial(0xc0baac,{roughness:.97}),wood=createWoodMaterial(0x936c43,{roughness:.92}),metal=new THREE.MeshStandardMaterial({color:0x35423d,roughness:.83,metalness:.12});
 const bedGeo=new THREE.CircleGeometry(1,24),rimGeo=new THREE.TorusGeometry(1,.035,5,24),slatGeo=new THREE.BoxGeometry(1,.06,.11),legGeo=new THREE.BoxGeometry(.06,.43,.06);
 for(const x of [bedGeo,rimGeo,slatGeo,legGeo,mulch,stone,wood,metal])x.userData.sharedSurfaceV153=true;
 function part(parent,geo,mat,x,y,z){const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.receiveShadow=true;parent.add(m);return m;}
 function bed(parent,x,z,r){const soil=part(parent,bedGeo,mulch,x,.023,z);soil.rotation.x=-Math.PI/2;soil.scale.setScalar(r);const edge=part(parent,rimGeo,stone,x,.045,z);edge.rotation.x=-Math.PI/2;edge.scale.setScalar(r);const flowers=createFlowerPatchV154(Math.min(r,.85),8,palette);flowers.position.set(x,0,z);parent.add(flowers);registerCameraFoliage(flowers);return flowers;}
 function bench(parent,x,z,yaw){const b=new THREE.Group();b.position.set(x,0,z);b.rotation.y=yaw;parent.add(b);for(let i=0;i<3;i++)part(b,slatGeo,wood,0,.46,(i-1)*.12);for(let i=0;i<3;i++)part(b,slatGeo,wood,0,.65+i*.1,-.17);for(const sx of [-.38,.38])for(const sz of [-.12,.12])part(b,legGeo,metal,sx,.215,sz);return b;}
 // Meadows form repeated planted ribbons, rather than isolated clutter on every approach.
 const roads=window.__TYCOON_V84_ROADS__?.segments?.()||[];
 for(let sector=0;sector<8;sector++)for(let j=0;j<4;j++){
   const a=sector*Math.PI/4+.18,r=18+j*3.1,x=Math.cos(a)*r,z=Math.sin(a)*r;
   if(!clear(x,z,.95,roads))continue;const g=new THREE.Group();g.position.set(x,0,z);g.name='meadowV156';g.userData.foliageKindV154='soft';root.add(g);bed(g,0,0,.7+j*.045);remember(x,z,.95);runtime.meadows++;
 }
 function gardenFor(b){
   const center=buildingPosition(b.index),out=center.clone().normalize(),tangent=new THREE.Vector3(-out.z,0,out.x);
   for(const side of [-1,1])for(const shift of [5.8,7.2,8.5]){
     const p=center.clone().addScaledVector(tangent,side*shift).addScaledVector(out,.7);
     if(!clear(p.x,p.z,1.9))continue;
     const g=new THREE.Group();g.name='districtGardenV156-'+b.index;g.position.copy(p);g.rotation.y=Math.atan2(-out.x,-out.z);g.userData.foliageKindV154='soft';root.add(g);
     bed(g,-.88,.25,.6);bed(g,.88,.25,.6);bench(g,0,-.65,0);remember(p.x,p.z,1.9);runtime.gardens++;return g;
   }
   return null;
 }
 function sync(now,force=false){
   if(!force&&(document.hidden||now-last<1200))return;last=now;
   const live=new Set();
   for(const b of buildings){if(!Number.isInteger(b.index)||b.underConstruction)continue;live.add(b.index);if(!gardens.has(b.index))gardens.set(b.index,gardenFor(b));}
   const low=document.body.classList.contains('v51-perf-low');
   for(const [i,g]of gardens)if(g)g.visible=live.has(i)&&!low;
   for(const g of root.children)if(g.name==='meadowV156')g.visible=!low;
   runtime.checks++;
 }
 sync(performance.now(),true);window.__TYCOON_V83_COLLISIONS__?.rebuild?.();
 window.__TYCOON_VISUAL_TICKS__.push(sync);
 window.__TYCOON_V156__={version:'v156-neighborhood',runtime,root,sync,clear,
   audit(){return {ok:root.parent===scene&&spots.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.z)),...runtime,decorativeObjects:root.children.length,clusters:anchors.length};}};
})();
