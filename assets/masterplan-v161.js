/* Plan B, paid port slice only. No core road tags, no new overlays or timers.
 * Existing industrial pads own the input/prompt/guidance. Core save() owns persistence.
 * Geometry is unioned offline and clipped into <=60 m cells by compile-port.mjs.
 */
(() => {
  'use strict';
  const D=window.MasterplanPortDataV161,K=window.BuildingsV161.kit;
  const state=masterplanStateV161;
  let root=null,north=null,signature='',lastGate='',lastTick=0;
  const barriers=[];
  const northLand=[[-8,-60],[14,-60],[14,-155],[-8,-155]];
  const ctx=K.makeCtx(1);
  const mats={};
  function mat(key,color){return mats[key]||(mats[key]=new THREE.MeshStandardMaterial({color:K.lin(color),roughness:.88}));}
  function nearest(x,z,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],len=dx*dx+dz*dz,t=len?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/len)):0;return [a[0]+dx*t,a[1]+dz*t];}
  function inside(x,z,poly){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
  function floor(x,z){
    for(const e of D.edges){if(!state[e.pad])continue;const r=e.w/2+e.sw;for(let i=1;i<e.pts.length;i++){const q=nearest(x,z,e.pts[i-1],e.pts[i]);if(Math.hypot(x-q[0],z-q[1])<=r)return true;}}
    return (state.B02&&(inside(x,z,D.pier)||D.lots.some(l=>inside(x,z,l.poly)))) || (state.B03&&inside(x,z,northLand));
  }
  function access(x,z,margin=.65){
    const inPort=x<=-55&&x>=-141&&z>=-10&&z<=65;
    const inNorth=state.B03&&x>=-8&&x<=14&&z>=-155&&z<=-55;
    if(!state.B01||(!inPort&&!inNorth)||!floor(x,z))return false;
    // Margin against the UNION of paid floors, not each strip: no invisible seam at a parcel entrance.
    for(let i=0;i<8;i++){const a=i*Math.PI/4;if(!floor(x+Math.cos(a)*margin,z+Math.sin(a)*margin))return false;}
    return true;
  }
  function clamp(x,z,margin=1){
    if(Math.abs(x)<=GROUND_HALF-margin&&Math.abs(z)<=GROUND_HALF-margin)return {x,z};
    if(access(x,z))return {x,z};
    // Keep movement on its visible paid floor; at an edge retain the last safe horizontal spot.
    if(access(player.position.x,player.position.z))return {x:player.position.x,z:player.position.z};
    return {x:THREE.MathUtils.clamp(x,-GROUND_HALF+margin,GROUND_HALF-margin),z:THREE.MathUtils.clamp(z,-GROUND_HALF+margin,GROUND_HALF-margin)};
  }
  function addBatch(bt,key,color,name){if(!bt.pos.length)return;const mesh=K.toMesh(bt,mat(key,color));mesh.name=name;mesh.receiveShadow=true;mesh.userData.v83CollisionIgnore=true;root.add(mesh);return mesh;}
  function polygon(bt,poly,y){const p=poly.map(q=>new THREE.Vector2(q[0],q[1]));for(const t of THREE.ShapeUtils.triangulateShape(p,[])){let a=poly[t[0]],b=poly[t[1]],c=poly[t[2]];if((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>0)[b,c]=[c,b];K.tri(bt,ctx,[a[0],y,a[1]],[b[0],y,b[1]],[c[0],y,c[1]]);}}
  function line(bt,a,b,width,y,height=.01){const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.001)return;K.box(bt,ctx,(a[0]+b[0])/2,y,(a[1]+b[1])/2,width,height,length,{ry:Math.atan2(dx,dz)});}
  function syncColliders(){const api=window.__TYCOON_V83_COLLISIONS__;if(!api||!root)return;api.unregisterOwner(root);for(const b of barriers)api.register({owner:root,category:'decor',label:'mp161:guardrail',shape:'obb',pos:new THREE.Vector3(b.x,0,b.z),hx:.065,hz:b.length/2,yaw:b.yaw,flags:{player:true,agent:true,placement:false,camera:false}});}
  // The decorative backdrop (24 hill spheres r 76-87 m, 30 skyline boxes, tagged userData.v161Backdrop by the core) stands exactly where the paid avenues cross r 70-100:
  // a hill covered the Port avenue (camera inside the hill) and a skyline box stood in the road. Backdrop whose footprint touches the paid floor is hidden while that floor is paid.
  function polyDistance(x,z,poly){if(inside(x,z,poly))return 0;let best=Infinity;for(let i=0;i<poly.length;i++){const q=nearest(x,z,poly[i],poly[(i+1)%poly.length]);best=Math.min(best,Math.hypot(x-q[0],z-q[1]));}return best;}
  function surfaceDistance(x,z){
    let best=Infinity;
    for(const e of D.edges){if(!state[e.pad])continue;const r=e.w/2+e.sw;for(let i=1;i<e.pts.length;i++){const q=nearest(x,z,e.pts[i-1],e.pts[i]);best=Math.min(best,Math.hypot(x-q[0],z-q[1])-r);}}
    if(state.B02){best=Math.min(best,polyDistance(x,z,D.pier));for(const l of D.lots)best=Math.min(best,polyDistance(x,z,l.poly));}
    if(state.B03)best=Math.min(best,polyDistance(x,z,northLand));
    return best;
  }
  let backdrop=null;
  function syncBackdrop(){
    if(!backdrop){backdrop=[];scene.traverse(o=>{if(o.userData&&o.userData.v161Backdrop)backdrop.push(o);});}
    let hidden=0;
    for(const o of backdrop){const b=o.userData.v161Backdrop,hide=!!state.B01&&surfaceDistance(b.x,b.z)<b.r+2;if(o.visible===hide)o.visible=!hide;if(hide)hidden++;}
    return hidden;
  }
  function clear(){if(root){window.__TYCOON_V83_COLLISIONS__?.unregisterOwner(root);scene.remove(root);root.traverse(o=>{if(o.geometry)o.geometry.dispose();});root=null;}barriers.length=0;signature='';}
  function refresh(){
    syncBackdrop();
    refreshNorth();
    const want=state.B02?'B02':state.B01?'B01':'';
    if(want&&Math.hypot(player.position.x+98,player.position.z-21)>=150){if(want!==signature)clear();if(root)root.visible=false;return;}
    if(want===signature&&(root||!want))return;
    clear();signature=want;if(!want)return;
    root=new THREE.Group();root.name='mp161Net';root.userData.masterplanV161=true;
    const surface=D.surfaces[want];
    for(const kind of ['walk','asphalt'])for(const cell of surface[kind]){
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(cell.positions,3));g.computeVertexNormals();g.computeBoundingSphere();
      const mesh=new THREE.Mesh(g,mat(kind,kind==='walk'?0xc6c1af:0x41474a));mesh.name='mp161_'+kind+'_'+cell.key;mesh.userData.v83CollisionIgnore=true;mesh.receiveShadow=true;root.add(mesh);
    }
    const marks=K.batch(),metal=K.batch(),stone=K.batch(),deck=K.batch(),water=K.batch();
    // Visible embankment walls down to the water: the paid avenue has a foundation, not a floating plane.
    for(const loop of D.boundaries[want])for(let i=0;i<loop.length;i++)line(stone,loop[i],loop[(i+1)%loop.length],.12,-.16,.34);
    if(!state.B02)polygon(water,[[-115,4],[-82,4],[-82,39],[-115,39]],-.32);
    for(const e of D.edges){if(e.pad==='B03'||!state[e.pad])continue;let traveled=0;
      for(let i=1;i<e.pts.length;i++){const a=e.pts[i-1],b=e.pts[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len;
        const dividers=e.lanes===4?[-e.w/4,0,e.w/4]:[0];
        for(let s=0;s<len;s+=.5){if((traveled+s)%5>2)continue;const end=Math.min(s+.46,len);for(const offset of dividers)line(marks,[a[0]+dx*s-dz*offset,a[1]+dz*s+dx*offset],[a[0]+dx*end-dz*offset,a[1]+dz*end+dx*offset],.09,.075);}
        traveled+=len;
      }
    }
    if(state.B02){
      polygon(deck,D.pier,.008);
      // The fifth parcel is on the quay beyond the pier polygon, so it needs its own visible floor.
      for(const l of D.lots)if(l.frontEdge!=='B-PIER')polygon(deck,l.poly,.008);
      // Water is below the deck and starts beyond the old ground. No new ocean inside the core.
      polygon(water,[[-158,-24],[-71,-24],[-71,80],[-158,80]],-.32);
      for(let i=0;i<3;i++){
        const a=D.pier[i],b=D.pier[i+1],len=Math.hypot(b[0]-a[0],b[1]-a[1]),yaw=Math.atan2(b[0]-a[0],b[1]-a[1]);
        line(metal,a,b,.13,.48,.06);line(metal,a,b,.13,.94,.06);
        line(stone,a,b,.15,-.16,.32);
        barriers.push({x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,length:len,yaw});
        for(let d=0;d<=len;d+=3){const t=d/len,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;K.box(metal,ctx,x,.49,z,.13,.98,.13);K.box(stone,ctx,x,-.17,z,.42,.36,.42);}
      }
      // Vacant parcels, not fake stocked warehouses. Painted perimeters share one InstancedMesh.
      const transforms=[];
      for(const lot of D.lots)for(let i=0;i<lot.poly.length;i++){const a=lot.poly[i],b=lot.poly[(i+1)%lot.poly.length],l=Math.hypot(b[0]-a[0],b[1]-a[1]);transforms.push({x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,l,yaw:Math.atan2(b[0]-a[0],b[1]-a[1])});}
      const lots=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),mat('plots',0xd7b35c),transforms.length),matrix=new THREE.Matrix4(),q=new THREE.Quaternion();
      transforms.forEach((t,i)=>{q.setFromAxisAngle(new THREE.Vector3(0,1,0),t.yaw);matrix.compose(new THREE.Vector3(t.x,.03,t.z),q,new THREE.Vector3(.08,.008,t.l));lots.setMatrixAt(i,matrix);});lots.name='mp161VacantParcels';lots.userData.v83CollisionIgnore=true;lots.frustumCulled=false;root.add(lots);
    }
    addBatch(deck,'deck',0xb8af9d,'mp161PierDeck');addBatch(water,'water',0x5896ac,'mp161Estuary');addBatch(marks,'paint',0xd8d3b7,'mp161LanePaint');addBatch(metal,'metal',0x606b6e,'mp161Guardrails');addBatch(stone,'stone',0x958f7e,'mp161Piles');
    scene.add(root);syncColliders();
  }
  function refreshNorth(){
    if(!state.B03){if(north){scene.remove(north);north.traverse(o=>o.geometry?.dispose());north=null;}return;}
    const nearby=Math.hypot(player.position.x-6,player.position.z+108)<150;
    if(north){north.visible=nearby;return;}
    if(!nearby)return;
    const group=new THREE.Group();group.name='mp161North';group.userData.masterplanV161=true;
    const batch=(bt,key,color,name)=>{if(!bt.pos.length)return;const m=K.toMesh(bt,mat(key,color));m.name=name;m.receiveShadow=true;m.userData.v83CollisionIgnore=true;group.add(m);};
    for(const kind of ['walk','asphalt'])for(const cell of D.surfaces.B03[kind]){
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(cell.positions,3));g.computeVertexNormals();g.computeBoundingSphere();
      const m=new THREE.Mesh(g,mat(kind,kind==='walk'?0xc6c1af:0x41474a));m.name='mp161North_'+kind+'_'+cell.key;m.receiveShadow=true;m.userData.v83CollisionIgnore=true;group.add(m);
    }
    const paint=K.batch(),base=K.batch(),ground=K.batch(),transforms=[];
    // Paid land and its visible earth banks support the avenue; every drawn top is walkable.
    for(const [start,end] of [[-60,-120],[-120,-155]]){const land=K.batch();polygon(land,[[-8,start],[14,start],[14,end],[-8,end]],-.035);batch(land,'northEarth',0x768662,'mp161NorthLand_'+start);}
    const banks=K.batch();for(let i=0;i<northLand.length;i++)line(banks,northLand[i],northLand[(i+1)%northLand.length],.18,-1.02,1.97);batch(banks,'northBank',0x786b54,'mp161NorthEarthBanks');
    for(const loop of D.boundaries.B03)for(let i=0;i<loop.length;i++)line(base,loop[i],loop[(i+1)%loop.length],.12,-.16,.34);
    for(const l of D.northLots){polygon(ground,l.poly,.008);for(let i=0;i<l.poly.length;i++){const a=l.poly[i],b=l.poly[(i+1)%l.poly.length];transforms.push({x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,length:Math.hypot(b[0]-a[0],b[1]-a[1]),yaw:Math.atan2(b[0]-a[0],b[1]-a[1])});line(base,a,b,.12,-.16,.34);}}
    const plots=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),mat('plots',0xd7b35c),transforms.length),matrix=new THREE.Matrix4(),q=new THREE.Quaternion();
    transforms.forEach((t,i)=>{q.setFromAxisAngle(new THREE.Vector3(0,1,0),t.yaw);matrix.compose(new THREE.Vector3(t.x,.03,t.z),q,new THREE.Vector3(.08,.008,t.length));plots.setMatrixAt(i,matrix);});plots.name='mp161NorthParcelPaint';plots.userData.v83CollisionIgnore=true;plots.frustumCulled=false;group.add(plots);
    for(const e of D.edges.filter(e=>e.pad==='B03'))for(let i=1;i<e.pts.length;i++){
      const a=e.pts[i-1],b=e.pts[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len;
      for(let s=0;s<len;s+=5)for(const offset of [-e.w/4,0,e.w/4])line(paint,[a[0]+dx*s-dz*offset,a[1]+dz*s+dx*offset],[a[0]+dx*Math.min(s+2,len)-dz*offset,a[1]+dz*Math.min(s+2,len)+dx*offset],.09,.075);
    }
    batch(base,'stone',0x958f7e,'mp161NorthFoundation');batch(ground,'deck',0xb8af9d,'mp161NorthParcels');batch(paint,'paint',0xd8d3b7,'mp161NorthLanePaint');
    north=group;scene.add(north);
  }
  function gate(p){return stageIndex>=p.gateStage&&totalRoadLevelsV37()>=8&&(!p.rep||cityState.reputation>=p.rep)&&p.requires.every(id=>state[id]);}
  function buy(p){
    if(state[p.id]||!gate(p))return false;
    if(otherTabSaveLockV63||suppressAutoSaveV36)return false;
    if(!tryPayResources({money:p.money,wood:0,concrete:0,metal:0})){sfx.error();toast(lang==='ru'?`Нужно ${p.money} монет`:`Need ${p.money} coins`);return false;}
    state[p.id]=true;
    try{refresh();}catch(e){state[p.id]=false;money+=p.money;clear();refresh();window.__TYCOON_CAPTURE_ERROR__?.(e,'mp161-build');return false;}
    refreshIndustrialPadMarkersV118();sfx.build();spawnBurst(industrialStepV118('mp161-'+p.id).pos.clone(),0xe1bb66);updateHUD();save();
    toast(lang==='ru'?(p.id==='B01'?'Портовая авеню открыта. Следующий кружок — у причала.':p.id==='B02'?'Причал открыт: пять участков подготовлены к следующим этапам.':'Северный проспект открыт. Подготовлены три участка.'):(p.id==='B01'?'Port avenue open. The next pad is at the quay.':p.id==='B02'?'Pier open: five parcels reserved for the next phases.':'North avenue open. Three parcels prepared.'));
    return true;
  }
  window.MasterplanV161={state,refresh,clear,clamp,access,syncColliders,syncBackdrop};
  function padPosition(p){
    if(p.id==='B03'){
      for(let x=0;x<=12;x+=2)for(let z=-64;z<=-55;z+=2){
        if(sourceTrees.some(t=>t?.mesh&&Math.hypot(x-t.mesh.position.x,z-t.mesh.position.z)<TREE_INTERACT_RADIUS+1))continue;
        if(gatherPhysicsCircles().some(c=>Math.hypot(x-c.pos.x,z-c.pos.z)<c.radius+1))continue;
        return new THREE.Vector3(x,0,z);
      }
      return new THREE.Vector3(6,0,-57.1);
    }
    if(p.id!=='B01')return new THREE.Vector3(p.pos[0],0,p.pos[1]);
    // The plan node sits on the ring; a harvesting radius there can own the button.
    // Put the purchase pad on a clear approach, still inside the unpaid core boundary.
    const points=[[-64,13.6],[-65,18],[-65,8],[-61,19],[-61,7],[-67,22],[-67,5]];
    for(const [x,z] of points){
      if(sourceTrees.some(t=>t?.mesh&&Math.hypot(x-t.mesh.position.x,z-t.mesh.position.z)<TREE_INTERACT_RADIUS+1))continue;
      if(gatherPhysicsCircles().some(c=>Math.hypot(x-c.pos.x,z-c.pos.z)<c.radius+1))continue;
      return new THREE.Vector3(x,0,z);
    }
    // Search only the visible, walkable core approach; no pad over unpaid water.
    for(let x=-67;x<=-60;x++)for(let z=3;z<=24;z++){
      if(sourceTrees.some(t=>t?.mesh&&Math.hypot(x-t.mesh.position.x,z-t.mesh.position.z)<TREE_INTERACT_RADIUS+1))continue;
      if(gatherPhysicsCircles().some(c=>Math.hypot(x-c.pos.x,z-c.pos.z)<c.radius+1))continue;
      return new THREE.Vector3(x,0,z);
    }
    return new THREE.Vector3(-67,0,24);
  }
  for(const p of D.pads)INDUSTRIAL_BUILD_STEPS_V118.push({id:'mp161-'+p.id,masterplanV161:true,icon:p.id==='B03'?'🛣️':'⚓',color:0xe1bb66,
    ru:p.id==='B01'?'Портовая авеню':p.id==='B02'?'Причал и участки порта':'Северный проспект',en:p.id==='B01'?'Port avenue':p.id==='B02'?'Pier and port parcels':'North avenue',
    plateSub:{ru:`${p.id} · ${p.money} МОНЕТ`,en:`${p.id} · ${p.money} COINS`},pos:padPosition(p),cost:{money:p.money,wood:0,concrete:0,metal:0},built:()=>state[p.id],prereq:()=>gate(p),run:()=>buy(p)});
  // Rebuilds of the shared registry re-add these real guardrail boxes at the owner hook.
  refresh();
  if(state.B01){
    // Earlier legacy boot clamps can run before this asset; recover only a saved paid-floor spot.
    try{const p=JSON.parse(knownSaveRawV64||'null')?.player;if(p&&Number.isFinite(p.x)&&Number.isFinite(p.z)&&access(p.x,p.z))player.position.set(p.x,0,p.z);}catch(_){}
    if(player.position.x<-GROUND_HALF+1&&!access(player.position.x,player.position.z))player.position.x=-GROUND_HALF+2;
    const safe=nearestSafePlayerPosition(player.position);player.position.x=safe.x;player.position.z=safe.z;
  }
  refreshIndustrialPadMarkersV118();
  (window.__TYCOON_VISUAL_TICKS__=window.__TYCOON_VISUAL_TICKS__||[]).push(now=>{
    if(now-lastTick<500)return;lastTick=now;
    const gateKey=D.pads.map(p=>`${state[p.id]}:${gate(p)}`).join('|');
    if(gateKey!==lastGate||(state.B01&&!root&&Math.hypot(player.position.x+98,player.position.z-21)<150)||(state.B03&&!north&&Math.hypot(player.position.x-6,player.position.z+108)<150)){lastGate=gateKey;refresh();refreshIndustrialPadMarkersV118();}
    if(north)north.visible=Math.hypot(player.position.x-6,player.position.z+108)<150;
    if(root)root.visible=Math.hypot(player.position.x+98,player.position.z-21)<150;
  });
})();
