/* Shared facade details, physical cargo finish, and active loading courts. */
(()=>{
 'use strict';
 const records=new Map(),bays=new Map(),cargoSeen=new WeakSet();let last=0;
 const runtime={buildings:0,bays:0,cargo:0,frames:0};
 const cube=new THREE.BoxGeometry(1,1,1),ringGeo=new THREE.TorusGeometry(.96,.032,6,32);
 const stone=createConcreteMaterial(0xc9c2b2,{roughness:.91}),frame=createMetalMaterial(0x39464c,{roughness:.65,metalness:.24}),wood=createWoodMaterial(0x997348,{roughness:.84}),gold=new THREE.MeshStandardMaterial({color:0xd9ad56,roughness:.65}),strap=new THREE.MeshStandardMaterial({color:0x27383c,roughness:.9});
 for(const a of [cube,ringGeo,stone,frame,wood,gold,strap])a.userData.sharedSurfaceV153=true;
 function box(parent,mat,x,y,z,w,h,d,bounds=null){
   if(bounds){w=Math.min(w,bounds.max.x-bounds.min.x);h=Math.min(h,bounds.max.y-bounds.min.y);d=Math.min(d,bounds.max.z-bounds.min.z);x=THREE.MathUtils.clamp(x,bounds.min.x+w/2,bounds.max.x-w/2);y=THREE.MathUtils.clamp(y,bounds.min.y+h/2,bounds.max.y-h/2);z=THREE.MathUtils.clamp(z,bounds.min.z+d/2,bounds.max.z-d/2);}
   const m=new THREE.Mesh(cube,mat);m.position.set(x,y,z);m.scale.set(w,h,d);m.receiveShadow=true;parent.add(m);return m;
 }
 function building(g,stage,level=1){
   if(!g||g.userData.v157Finish)return g;g.userData.v157Finish=true;
   g.updateWorldMatrix(true,true);const bounds=new THREE.Box3().setFromObject(g).applyMatrix4(g.matrixWorld.clone().invert());
   if(bounds.isEmpty())return g;
   const b=stage.baseSize||2.6,h=stage.height*(1+(level-1)*.18),type=stage.archetype;
   const detail=new THREE.Group();detail.name='facadeFinishV157';g.add(detail);
   const add=(mat,x,y,z,w,hh,d)=>box(detail,mat,x,y,z,w,hh,d,bounds);
   // Trim remains inside the existing building envelope and does not change collision size.
   for(const side of [-1,1]){
     add(stone,side*b*.54,.22,0,.075,.14,b*1.05);
     add(frame,side*b*.51,h*.38,-b*.4,.065,h*.62,.065);
   }
   if(type==='house'){
     const x=-b*.52,z=b*.30;
     add(wood,x,h*.35,z,.045,h*.62,.055);
     add(frame,x,h*.68,z,.10,.065,.075);
     add(stone,0,.18,b*.60,b*.42,.08,.23);
     add(stone,0,.10,b*.65,b*.48,.08,.24);
   }else if(type==='warehouse'||type==='factory'){
     const z=b*.65;
     for(const side of [-1,1]){
       add(frame,side*b*.38,h*.21,z,.09,h*.38,.065);
       for(let k=0;k<4;k++)add(k%2?frame:gold,side*b*.38,.19+k*.11,z+.035,.10,.085,.025);
     }
     add(frame,0,h+.12,-b*.19,b*.33,.22,b*.25);
     for(let k=0;k<5;k++)add(stone,(k-2)*b*.05,h+.239,-b*.19,.018,.015,b*.22);
   }else{
     const floors=Math.min(6,Math.max(2,Math.floor(h/1.7)));
     for(let k=1;k<=floors;k++)add(stone,0,h*k/(floors+1),b*.50,b*.93,.045,.055);
     for(const side of [-1,1])add(frame,side*b*.44,h*.49,b*.505,.045,h*.88,.035);
     add(gold,0,h*.16,b*.54,b*.31,.045,.035);
   }
   records.set(g,{detail});runtime.buildings++;return g;
 }
 const before=createBuildingMesh;
 createBuildingMesh=function(stage,level){return building(before.apply(this,arguments),stage,level);};
 for(const b of buildings)building(b.mesh,STAGES[b.index],b.level);
 function setupBay(key,z){
   if(!z?.group||bays.has(z.group))return;
   const detail=new THREE.Group();detail.name='loadingFinishV157';z.group.add(detail);
   const color=key==='planks'?0xd0ab68:key==='concrete'?0xc8c3ac:0x91acb6;
   const accent=new THREE.MeshStandardMaterial({color,roughness:.70,emissive:color,emissiveIntensity:.04});
   for(const x of [-.85,.85])for(const zz of [-.55,.55]){
     box(detail,frame,x,.18,zz,.065,.29,.065);box(detail,accent,x,.295,zz,.085,.055,.085);
   }
   for(const x of [-.88,.88])box(detail,accent,x,.08,0,.028,.018,1.16);
   for(const zz of [-.58,.58])box(detail,accent,0,.08,zz,1.78,.018,.028);
   bays.set(z.group,{key,detail,accent});runtime.bays++;
 }
 function finishCargo(){
   const g=window.__TYCOON_V123__?.getCarryVisual?.(),carry=window.__TYCOON_V123__?.state?.carry;
   if(!g||cargoSeen.has(g)||!carry?.amount)return;cargoSeen.add(g);
   if(carry.type==='planks'||carry.type==='metal'){
     const h=Math.min(6,carry.amount)*(carry.type==='planks'?.07:.065),bottom=carry.type==='planks'?.9075:.9325;
     for(const x of [-.21,.21]){
       box(g,strap,x,bottom+h/2,.31,.023,h,.145);
       box(g,strap,x,bottom+h,.31,.024,.018,.16);
       box(g,gold,x,bottom+h*.5,.391,.035,.04,.016);
     }
   }else{
     for(let i=0;i<Math.min(6,carry.amount);i++)box(g,wood,(i%2-.5)*.29,.99+Math.floor(i/2)*.18,.389,.12,.045,.012);
   }
   runtime.cargo++;
 }
 function sync(now){
   if(document.hidden||now-last<100)return;last=now;
   const low=document.body.classList.contains('v51-perf-low');
   for(const [g,r]of records){if(!g.parent){records.delete(g);continue;}r.detail.visible=!low;}
   for(const [key,z]of Object.entries(LOGISTICS_ZONES))setupBay(key,z);
   const nav=window.__TYCOON_MANUAL_NAV__?.();
   for(const [g,r]of bays){const active=nav?.mode==='pickup'&&nav.cargo===r.key;const intensity=active ? .35 : .04;if(r.accent.emissiveIntensity!==intensity){r.accent.emissiveIntensity=intensity;r.accent.color.setHex(active?0xe5be6d:r.key==='planks'?0xd0ab68:r.key==='concrete'?0xc8c3ac:0x91acb6);}r.detail.visible=!low;}
   finishCargo();runtime.frames++;
 }
 sync(performance.now()+101);window.__TYCOON_VISUAL_TICKS__.push(sync);
 window.__TYCOON_V157__={version:'v157-finish-and-clarity',runtime,building,sync,
   audit(){return {ok:records.size<=runtime.buildings&&bays.size<=3,trackedBuildings:records.size,...runtime};}};
})();
