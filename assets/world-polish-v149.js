/* v149: construction truth, detailed fleet and crew, bounded visual updates. */
(()=>{
  'use strict';
  const VERSION='v149-world-polish';
  const records=new Map(),crew=new Map(),sites=new Map();
  const runtime={fleetDecorated:0,crewDecorated:0,siteBoards:0,frames:0,errors:[],quality:'high'};
  const temp=new THREE.Vector3();
  let lastFrame=0,lastScan=0;
  function mesh(parent,geometry,material,x,y,z){const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);parent.add(m);return m;}
  function standard(color,roughness=.72,metalness=0){return new THREE.MeshStandardMaterial({color,roughness,metalness});}
  function decorateFleet(g){
    if(!g?.isObject3D||records.has(g)||g.userData.v149Fleet)return;
    g.userData.v149Fleet=true;
    const root=new THREE.Group();root.name='fleetFinishV149';g.add(root);
    const metal=standard(0x687581,.46,.38),black=standard(0x192129,.84),silver=standard(0xb8c6cd,.4,.32);
    const rear=standard(0xb83828,.38),front=standard(0xf4dfb1,.32);
    rear.emissive.setHex(0x9f1e14);front.emissive.setHex(0xffd790);
    for(const x of [-.37,.37]){
      mesh(root,new THREE.BoxGeometry(.16,.07,.027),rear,x,.34,-.963);
      mesh(root,new THREE.BoxGeometry(.13,.018,.025),front,x,.265,1.087);
      const step=mesh(root,new THREE.BoxGeometry(.13,.035,.34),metal,Math.sign(x)*.51,.32,.45);step.receiveShadow=true;
      mesh(root,new THREE.BoxGeometry(.04,.018,.30),black,Math.sign(x)*.52,.343,.45);
    }
    const plate=mesh(root,new THREE.BoxGeometry(.29,.09,.025),silver,0,.285,-.975);
    mesh(plate,new THREE.BoxGeometry(.19,.016,.008),black,0,0,.018);
    for(const x of [-.3,0,.3])mesh(root,new THREE.BoxGeometry(.14,.027,.023),silver,x,.53,-.957);
    const visor=mesh(root,new THREE.BoxGeometry(.73,.025,.08),black,0,.845,.803);visor.castShadow=false;
    for(const x of [-.18,.18]){const wiper=mesh(root,new THREE.BoxGeometry(.015,.16,.018),black,x,.70,.852);wiper.rotation.z=-.22;}
    const optional=new THREE.Group();optional.name='fleetFineDetailV149';root.add(optional);
    for(const x of [-.49,.49])mesh(optional,new THREE.BoxGeometry(.023,.035,.12),silver,x,.59,.57);
    const cargo=g.userData.cargoVisuals;
    if(cargo){for(const key of ['planks','metal']){const target=cargo[key];if(!target)continue;for(const z of [-.14,.21]){const strap=mesh(target,new THREE.BoxGeometry(.75,.018,.026),black,0,key==='planks'?.43:.33,z);strap.name='cargoStrapV149';}}}
    records.set(g,{root,optional,front,rear,previous:g.position.clone(),speed:0,lastAt:0});runtime.fleetDecorated++;
  }
  function decorateCrew(w){
    const g=w?.group;if(!g||crew.has(g)||g.userData.v149Crew)return;
    g.userData.v149Crew=true;
    const detail=new THREE.Group();detail.name='crewFinishV149';g.add(detail);
    const dark=standard(0x263139,.82),white=standard(0xe8e4d9,.72),skin=standard(0xdbab86,.82);
    for(const x of [-.052,.052])mesh(detail,new THREE.BoxGeometry(.025,.025,.014),dark,x,1.293,.15);
    mesh(detail,new THREE.BoxGeometry(.045,.011,.012),dark,0,1.22,.147);
    for(const x of [-.16,.16])mesh(detail,new THREE.BoxGeometry(.045,.075,.042),skin,x,1.27,0);
    mesh(detail,new THREE.BoxGeometry(.075,.10,.018),white,.09,1.01,.145);
    mesh(detail,new THREE.BoxGeometry(.34,.035,.275),dark,0,.63,0);
    for(const arm of [w.armL,w.armR]){if(arm)mesh(arm,new THREE.BoxGeometry(.135,.12,.135),dark,0,-.54,.018);}
    crew.set(g,{detail,worker:w});runtime.crewDecorated++;
  }
  function boardLines(site){
    const b=site.buildRef,pct=Math.min(99,Math.max(0,Math.floor((b?.timer??site.timer)/Math.max(.001,site.duration)*100)));
    const waiting=!!b?.waitingForDelivery;
    const phase=constructionPhaseName(constructionPhaseIndex(pct/100));
    return [lang==='ru'?'СТРОИТЕЛЬНАЯ ПЛОЩАДКА':'CONSTRUCTION SITE',waiting?(lang==='ru'?'ОЖИДАЕТ ДОСТАВКУ':'AWAITING DELIVERY'):`${phase} · ${pct}%`];
  }
  function decorateSite(site){
    const g=site?.group;if(!g||sites.has(g)||g.userData.v149Site)return;
    g.userData.v149Site=true;
    const detail=new THREE.Group();detail.name='siteFinishV149';g.add(detail);
    // Use the existing unloading marker's coordinates, never scatter props on a road.
    const anchor=site.unloadZone?.position||new THREE.Vector3(0,0,0);
    const frame=standard(0x39434d,.76,.18),yellow=standard(0xd7a343,.67),dark=standard(0x252c34,.84);
    const board=mesh(detail,new THREE.BoxGeometry(.93,.48,.07),frame,anchor.x,1.48,anchor.z);
    for(const x of [-.36,.36])mesh(detail,new THREE.BoxGeometry(.045,1.32,.045),frame,anchor.x+x,.79,anchor.z);
    const label=makeLabelSprite(boardLines(site));label.position.set(anchor.x,1.50,anchor.z+.049);label.scale.set(.87,.36,1);detail.add(label);
    // Hazard edging belongs to the board, safely above the plot surface.
    for(let i=0;i<5;i++){const stripe=mesh(board,new THREE.BoxGeometry(.12,.04,.012),i%2?dark:yellow,(i-2)*.15,-.20,.042);stripe.rotation.z=-.25;}
    const rail=mesh(detail,new THREE.BoxGeometry(.90,.022,.022),yellow,anchor.x,1.18,anchor.z+.06);rail.castShadow=false;
    sites.set(g,{detail,label,site,signature:'',updated:0});runtime.siteBoards++;
  }
  function scan(){
    for(const v of serviceVehicles)decorateFleet(v);
    for(const w of npcWorkers)decorateCrew(w);
    for(const site of constructionSites)decorateSite(site);
    // Removed objects are already disposed by the game's own lifecycle. Never dispose shared textures twice.
    for(const [g] of records)if(!g.parent)records.delete(g);
    for(const [g] of crew)if(!g.parent)crew.delete(g);
    for(const [g] of sites)if(!g.parent)sites.delete(g);
  }
  function sync(now){
    runtime.quality=document.body.classList.contains('v51-perf-low')?'low':document.body.classList.contains('v51-perf-mid')?'mid':'high';
    if(now-lastScan>1200){lastScan=now;scan();}
    const day=typeof daylightV40==='function'?daylightV40():1;
    for(const [g,r] of records){
      g.getWorldPosition(temp);const distance=temp.distanceToSquared(camera.position);
      r.optional.visible=runtime.quality!=='low'&&distance<900;
      const dt=r.lastAt?Math.max(.001,(now-r.lastAt)/1000):.1;
      r.speed=g.position.distanceTo(r.previous)/dt;r.previous.copy(g.position);r.lastAt=now;
      r.front.emissiveIntensity=.05+(1-day)*.7;
      r.rear.emissiveIntensity=r.speed<.07?.65:.16+(1-day)*.2;
    }
    for(const [g,r] of crew){g.getWorldPosition(temp);r.detail.visible=runtime.quality!=='low'&&temp.distanceToSquared(camera.position)<625;}
    for(const [g,r] of sites){
      g.getWorldPosition(temp);r.detail.visible=temp.distanceToSquared(camera.position)<1600;
      if(now-r.updated>500){r.updated=now;const lines=boardLines(r.site),sig=lines.join('|');if(sig!==r.signature){r.signature=sig;updateLabelSprite(r.label,lines);}}
    }
    runtime.frames++;
  }
  // Keep late-born vehicles/workers on the same art pass as restored saves.
  const truckBefore=createServiceTruck;
  createServiceTruck=function(){const g=truckBefore.apply(this,arguments);decorateFleet(g);return g;};
  const workerBefore=createWorkerNPC;
  createWorkerNPC=function(){const w=workerBefore.apply(this,arguments);decorateCrew(w);return w;};
  const siteBefore=spawnConstructionSite;
  spawnConstructionSite=function(){const s=siteBefore.apply(this,arguments);if(s)decorateSite(s);return s;};
  function audit(){
    const checks={singlePremiumLoop:callbacks===window.__TYCOON_VISUAL_TICKS__&&new Set(callbacks).size===callbacks.length,finiteFleet:[...records.values()].every(r=>Number.isFinite(r.speed)),uniqueFleet:records.size===new Set(records.keys()).size,siteTruth:[...sites.values()].every(r=>boardLines(r.site).length===2)};
    const prior={};for(const key of ['__TYCOON_V136_QA__','__TYCOON_V137_CHARACTER__','__TYCOON_V142__','__TYCOON_V143__','__TYCOON_V144__','__TYCOON_V145__','__TYCOON_V146__','__TYCOON_V147__','__TYCOON_V148__']){try{const api=window[key];prior[key]=typeof api?.audit==='function'?api.audit():{available:!!api};}catch(e){prior[key]={ok:false,error:String(e.message)};}}
    const previousFailures=Object.entries(prior).filter(([,result])=>result?.ok===false).map(([key])=>key);
    return {version:VERSION,ok:Object.values(checks).every(Boolean)&&runtime.errors.length===0&&previousFailures.length===0,checks,tracked:{fleet:records.size,crew:crew.size,sites:sites.size},runtime:{...runtime},previousFailures,previousAudits:prior};
  }
  const callbacks=window.__TYCOON_VISUAL_TICKS__||[];
  const failed=new Map();
  function frame(now){
    if(!gamePausedV163()&&now-lastFrame>(VISUAL_MOBILE?33:20)){
      lastFrame=now;
      for(const callback of callbacks){
        const previous=failed.get(callback);if(previous&&now<previous.retryAt)continue;
        try{callback(now);failed.delete(callback);}
        catch(e){
          const attempts=(previous?.attempts||0)+1;
          failed.set(callback,{attempts,retryAt:now+Math.min(30000,1000*Math.pow(2,Math.min(attempts-1,5))),message:String(e.message)});
          if(!previous){if(runtime.errors.length>=60)runtime.errors.shift();runtime.errors.push(String(e.message));window.__TYCOON_CAPTURE_ERROR__?.(e,'visual-callback');console.warn('[v149 visual]',e);}
        }
      }
      try{sync(now);}catch(e){if(!runtime.errors.includes(String(e.message))){if(runtime.errors.length>=60)runtime.errors.shift();runtime.errors.push(String(e.message));window.__TYCOON_CAPTURE_ERROR__?.(e,'visual-sync');}}
    }
    requestAnimationFrame(frame);
  }
  scan();window.__TYCOON_V149__={version:VERSION,runtime,audit,scan,boardLines,retryState:()=>[...failed.values()].map(x=>({...x}))};requestAnimationFrame(frame);
})();
