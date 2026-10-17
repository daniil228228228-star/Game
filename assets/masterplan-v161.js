/* Plan B, paid slices (port B01/B02, north B03, phase 2 B04/B05, ...). No core road tags, no new overlays or timers.
 * Existing industrial pads own the input/prompt/guidance. Core save() owns persistence.
 * Geometry is unioned offline and clipped into <=60 m cells by tools/masterplan/compile-port.mjs, which also writes the WALKABLE polygons of every pad
 * (D.walkable) - access()/clamp()/backdrop/restore read only those, so a later phase is data-only.
 */
(() => {
  'use strict';
  const D=window.MasterplanPortDataV161,K=window.BuildingsV161.kit;
  const state=masterplanStateV161;
  let root=null,north=null,signature='',lastGate='',lastTick=0,sea=null;
  const barriers=[];
  const lotsOf=id=>D.lots.filter(l=>l.pad===id);
  const northLand=D.land.B03;
  const PHASE_PADS=D.pads.filter(p=>p.group!=='mp161Net'&&p.group!=='mp161North');   // B04+ : generic cell groups
  const padGroups={};                                                                   // pad id -> {group, props:[{x,z,hx,hz,yaw}]}
  const ctx=K.makeCtx(1);
  const mats={};
  function mat(key,color){return mats[key]||(mats[key]=new THREE.MeshStandardMaterial({color:K.lin(color),roughness:.88}));}
  const vcMat=()=>mats.vc||(mats.vc=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,metalness:.02}));
  function nearest(x,z,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],len=dx*dx+dz*dz,t=len?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/len)):0;return [a[0]+dx*t,a[1]+dz*t];}
  function inside(x,z,poly){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
  // A region is a list of loops (outer rings and holes): even-odd. A pad's walkable floor is the union of its regions.
  function inRegion(x,z,loops){let yes=false;for(const l of loops)if(inside(x,z,l))yes=!yes;return yes;}
  const floor=masterplanFloorV161,access=masterplanAccessV161;   // core (tycoon-v161.html): one definition for load() and the layer
  // Continuous movement (a per-frame step) slides along the edge of the paid floor; a jump (teleport, test probe) keeps the last safe spot.
  const SLIDE_STEP=2;
  function clamp(x,z,margin=1){
    if(Math.abs(x)<=GROUND_HALF-margin&&Math.abs(z)<=GROUND_HALF-margin)return {x,z};
    if(access(x,z))return {x,z};
    const px=player.position.x,pz=player.position.z;
    // Keep movement on its visible paid floor; at an edge slide along it, else retain the last safe horizontal spot.
    if(access(px,pz)){
      const sx=x-px,sz=z-pz;
      if(Math.hypot(sx,sz)<=SLIDE_STEP){
        const first=Math.abs(sx)>=Math.abs(sz)?[[x,pz],[px,z]]:[[px,z],[x,pz]];
        for(const [cx,cz] of first)if(access(cx,cz))return {x:cx,z:cz};
        for(const f of [.5,.25]){const cx=px+sx*f,cz=pz+sz*f;if(access(cx,cz))return {x:cx,z:cz};}
      }
      return {x:px,z:pz};
    }
    return {x:THREE.MathUtils.clamp(x,-GROUND_HALF+margin,GROUND_HALF-margin),z:THREE.MathUtils.clamp(z,-GROUND_HALF+margin,GROUND_HALF-margin)};
  }
  function addBatch(bt,key,color,name){if(!bt.pos.length)return;const mesh=K.toMesh(bt,mat(key,color));mesh.name=name;mesh.receiveShadow=true;mesh.userData.v83CollisionIgnore=true;root.add(mesh);return mesh;}
  function polygon(bt,poly,y,color,holes=[]){const p=poly.map(q=>new THREE.Vector2(q[0],q[1])),all=poly.concat(...holes);for(const t of THREE.ShapeUtils.triangulateShape(p,holes.map(h=>h.map(q=>new THREE.Vector2(q[0],q[1]))))){let a=all[t[0]],b=all[t[1]],c=all[t[2]];if((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>0)[b,c]=[c,b];K.tri(bt,ctx,[a[0],y,a[1]],[b[0],y,b[1]],[c[0],y,c[1]],color===undefined?{}:{color});}}
  function line(bt,a,b,width,y,height=.01,color){const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.001)return;K.box(bt,ctx,(a[0]+b[0])/2,y,(a[1]+b[1])/2,width,height,length,color===undefined?{ry:Math.atan2(dx,dz)}:{ry:Math.atan2(dx,dz),color});}
  function syncColliders(){const api=window.__TYCOON_V83_COLLISIONS__;if(!api)return;syncPadColliders(api);if(!root)return;api.unregisterOwner(root);for(const b of barriers)api.register({owner:root,category:'decor',label:'mp161:guardrail',shape:'obb',pos:new THREE.Vector3(b.x,0,b.z),hx:.065,hz:b.length/2,yaw:b.yaw,flags:{player:true,agent:true,placement:false,camera:false}});}
  // The decorative backdrop (24 hill spheres r 76-87 m, 30 skyline boxes, tagged userData.v161Backdrop by the core) stands exactly where the paid avenues cross r 70-100:
  // a hill covered the Port avenue (camera inside the hill) and a skyline box stood in the road. Backdrop whose footprint touches the paid floor is hidden while that floor is paid.
  function polyDistance(x,z,poly){let best=Infinity;for(let i=0;i<poly.length;i++){const q=nearest(x,z,poly[i],poly[(i+1)%poly.length]);best=Math.min(best,Math.hypot(x-q[0],z-q[1]));}return best;}
  function surfaceDistance(x,z){
    let best=Infinity;
    for(const id in D.walkable){
      if(!state[id])continue;const bb=D.bbox[id];
      if(Math.max(bb[0]-x,x-bb[2],bb[1]-z,z-bb[3])>best)continue;   // the bbox is already farther than the best loop
      for(const r of D.walkable[id]){if(inRegion(x,z,r))return 0;for(const l of r)best=Math.min(best,polyDistance(x,z,l));}
    }
    return best;
  }
  // Decorative scenery (bushes / rocks / trees scattered in the old core) that stands on a phase-3 street (only B06 reaches into the core) is retired through the core's own
  // road-conflict flag while that street is paid and restored when it is not. Earlier pads keep their behaviour.
  let scenery=null;
  function syncScenery(){
    if(!scenery){scenery=[];for(const o of scene.children)if(o.userData&&o.userData.v64RandomScenery)scenery.push(o);}
    for(const o of scenery){
      let hit=false;
      if(o.userData.v161MpRetired||!o.userData.v84HiddenRoadConflict&&!o.userData.v64HiddenRoadConflict&&o.visible!==false)
        for(const e of D.edges){if(e.pad<'B06'||!state[e.pad])continue;const hw=e.w/2+e.sw+.5;
          for(let i=1;i<e.pts.length&&!hit;i++){const q=nearest(o.position.x,o.position.z,e.pts[i-1],e.pts[i]);if(Math.hypot(o.position.x-q[0],o.position.z-q[1])<hw)hit=true;}
          if(hit)break;}
      if(hit&&!o.userData.v161MpRetired){o.userData.v161MpRetired=true;o.userData.v84HiddenRoadConflict=true;o.visible=false;}
      else if(!hit&&o.userData.v161MpRetired){o.userData.v161MpRetired=false;delete o.userData.v84HiddenRoadConflict;o.visible=true;}
    }
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
    syncBackdrop();syncScenery();
    refreshNorth();
    refreshPhasePads();
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
      for(const l of lotsOf('B02'))if(l.frontEdge!=='B-PIER')polygon(deck,l.poly,.008);
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
      for(const lot of lotsOf('B02'))for(let i=0;i<lot.poly.length;i++){const a=lot.poly[i],b=lot.poly[(i+1)%lot.poly.length],l=Math.hypot(b[0]-a[0],b[1]-a[1]);transforms.push({x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,l,yaw:Math.atan2(b[0]-a[0],b[1]-a[1])});}
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
    for(const l of lotsOf('B03')){polygon(ground,l.poly,.008);for(let i=0;i<l.poly.length;i++){const a=l.poly[i],b=l.poly[(i+1)%l.poly.length];transforms.push({x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,length:Math.hypot(b[0]-a[0],b[1]-a[1]),yaw:Math.atan2(b[0]-a[0],b[1]-a[1])});line(base,a,b,.12,-.16,.34);}}
    const plots=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),mat('plots',0xd7b35c),transforms.length),matrix=new THREE.Matrix4(),q=new THREE.Quaternion();
    transforms.forEach((t,i)=>{q.setFromAxisAngle(new THREE.Vector3(0,1,0),t.yaw);matrix.compose(new THREE.Vector3(t.x,.03,t.z),q,new THREE.Vector3(.08,.008,t.length));plots.setMatrixAt(i,matrix);});plots.name='mp161NorthParcelPaint';plots.userData.v83CollisionIgnore=true;plots.frustumCulled=false;group.add(plots);
    for(const e of D.edges.filter(e=>e.pad==='B03'))for(let i=1;i<e.pts.length;i++){
      const a=e.pts[i-1],b=e.pts[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len;
      for(let s=0;s<len;s+=5)for(const offset of [-e.w/4,0,e.w/4])line(paint,[a[0]+dx*s-dz*offset,a[1]+dz*s+dx*offset],[a[0]+dx*Math.min(s+2,len)-dz*offset,a[1]+dz*Math.min(s+2,len)+dx*offset],.09,.075);
    }
    batch(base,'stone',0x958f7e,'mp161NorthFoundation');batch(ground,'deck',0xb8af9d,'mp161NorthParcels');batch(paint,'paint',0xd8d3b7,'mp161NorthLanePaint');
    north=group;scene.add(north);
  }
  // ---- phase 2+ pads (B04, B05, ...): one generic cell group per pad, everything from the data --------------------------------------------------------------
  const nearBox=(id,reach=150)=>{const b=D.bbox[id],x=player.position.x,z=player.position.z;return Math.hypot(Math.max(b[0]-x,0,x-b[2]),Math.max(b[1]-z,0,z-b[3]))<reach;};
  // Lot styles by kind; a new kind (later phases) falls back to the plain parcel.
  const LOT_STYLE={
    'res-low':{ground:[0x86a863,0x7aa05b],path:0xd2c9b4,sign:0x3f8f6a,tree:true},
    'industry-light':{ground:[0xa6a49c,0xa09e96],path:0xc9c4b4,sign:0xe08f2a,stripes:0xe5c24a,tree:false},
    // phase 3: residential blocks (denser lawn, blue sign) and the business centre (paved plaza parcels with a planter and street lamps; no building implies a function)
    'res-mid':{ground:[0x93a67a,0x8a9d73],path:0xd6cfbb,sign:0x4c78b0,tree:true},
    cbd:{ground:[0xb4b2a8,0xaeaca2],path:0xe2deca,sign:0x7a6bb5,tree:false,planter:true},
    // phase 4: mixed parcels along South street (plain, amber sign) and the three warehouse parcels of the interchange frontage (grey yard, orange stripes)
    mixed:{ground:[0x9fa98c,0x98a285],path:0xd2c9b4,sign:0xc0873a,tree:false},
    warehouse:{ground:[0xa6a49c,0xa09e96],path:0xc9c4b4,sign:0x8a6f4a,stripes:0xe5c24a,tree:false},
    _:{ground:[0x9aa88a,0x93a184],path:0xcfc7b4,sign:0x8a8f99,tree:false},
  };
  function lotFrame(l){
    const n=l.normal,t=[-n[1],n[0]],d=l.door;
    // u along the street (centred on the door), v into the lot (away from the street)
    return {at:(u,v)=>[d[0]+t[0]*u-n[0]*v,d[1]+t[1]*u-n[1]*v],yaw:Math.atan2(-n[0],-n[1]),w:l.w,d:l.d,n};
  }
  // A quad whose front face looks along (nx,ny,nz) (the winding is decided here, the caller only lists the four corners).
  function quadFacing(bt,a,b,c,d,n,color){
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
    const dot=(uy*vz-uz*vy)*n[0]+(uz*vx-ux*vz)*n[1]+(ux*vy-uy*vx)*n[2];
    if(dot<0)[b,d]=[d,b];
    K.tri(bt,ctx,a,b,c,{color});K.tri(bt,ctx,a,c,d,{color});
  }
  // M2 in its open cut (pad B12): floor along the plan's profile (depth 3 m, 7 % grade), concrete shoulders, retaining walls at the clear span of the overpass, lane dashes on the
  // sloping floor, and the overpass (level 0) as a slab across the cut. Walls and floor are visible down to the trench bottom; the sea plane has a hole here (refreshSea).
  function drawTrench(g,props,e){
    const prof=e.trench.profile,zc=e.pts[0][1],hw=e.w/2,over=D.edges.find(o=>o.overpass&&o.overpass.over===e.id),cut=over?over.overpass.clearSpan/2:hw+2,top=0;
    const lo=Math.min(...prof.map(q=>q[0])),hi=Math.max(...prof.map(q=>q[0]));
    const yAt=x=>{for(let i=1;i<prof.length;i++){const a=prof[i-1],b=prof[i];if(x>=Math.min(a[0],b[0])-1e-6&&x<=Math.max(a[0],b[0])+1e-6)return a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]);}return 0;};
    const xs=[];for(let x=lo;x<hi;x+=2)xs.push(x);xs.push(hi);for(const q of prof)if(!xs.includes(q[0]))xs.push(q[0]);xs.sort((a,b)=>a-b);
    const UP=[0,1,0];
    for(let i=1;i<xs.length;i++){
      const x0=xs[i-1],x1=xs[i],y0=yAt(x0),y1=yAt(x1);
      quadFacing(g,[x0,y0+.02,zc-hw],[x1,y1+.02,zc-hw],[x1,y1+.02,zc+hw],[x0,y0+.02,zc+hw],UP,0x41474a);
      for(const s of [-1,1]){
        quadFacing(g,[x0,y0+.015,zc+s*hw],[x1,y1+.015,zc+s*hw],[x1,y1+.015,zc+s*cut],[x0,y0+.015,zc+s*cut],UP,0x8c8f88);
        quadFacing(g,[x0,y0,zc+s*cut],[x1,y1,zc+s*cut],[x1,top,zc+s*cut],[x0,top,zc+s*cut],[0,0,-s],0x9b978b);
      }
      if(i%2===0)for(const o of (e.lanes===4?[-e.w/4,0,e.w/4]:[0]))quadFacing(g,[x0,y0+.04,zc+o-.045],[x1,y1+.04,zc+o-.045],[x1,y1+.04,zc+o+.045],[x0,y0+.04,zc+o+.045],UP,0xd8d3b7);
    }
    if(over){
      const xc=over.pts[0][0],dw=over.overpass.deckW;
      K.box(g,ctx,xc,-.33,zc,dw,.66,2*cut+1.2,{color:0x8d8a80});                                    // deck slab: top at y 0, the paved street lies on it
      for(const s of [-1,1])K.box(props,ctx,xc+s*(dw/2+.1),.45,zc,.22,.9,2*cut+1,{color:0xb4b0a4});   // parapets
    }
  }
  // Phase 5 (data: D.rails axis polylines, D.railNodes, D.yard): ballast bed, two rails per segment, buffer stops at the bumper nodes, container stacks and the loading dock.
  // Static, no trains. Sleepers are returned as transforms for ONE InstancedMesh. The strip is not walkable (D.blockers) and fenced (D.fences).
  const RAIL_COLORS=[0xb5472f,0x2f6aa3,0xc0a33a,0x3d7a58,0x8a8f95];
  function drawRails(ground,props,id){
    const out=[];
    for(const r of D.rails.filter(r=>r.pad===id)){
      let carry=0;
      for(let i=1;i<r.pts.length;i++){
        const a=r.pts[i-1],b=r.pts[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.01)continue;
        const dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len,yaw=Math.atan2(dx,dz),ex=[a[0]-dx*.06,a[1]-dz*.06],ey=[b[0]+dx*.06,b[1]+dz*.06];
        line(ground,ex,ey,3.4,.08,.2,0x8d887e);                                       // ballast bed
        for(const o of [-.7175,.7175])line(props,[ex[0]-dz*o,ex[1]+dx*o],[ey[0]-dz*o,ey[1]+dx*o],.08,.38,.12,0x7b7f84);   // rails (1.435 m gauge)
        for(let s=carry;s<len;s+=.65)out.push({x:a[0]+dx*s,z:a[1]+dz*s,yaw});
        carry=((carry-len)%.65+.65)%.65;
      }
      const end=D.railNodes.find(n=>n.id===r.to);
      if(end&&end.type==='bumper'){const a=r.pts[r.pts.length-2],b=r.pts[r.pts.length-1],l=Math.hypot(b[0]-a[0],b[1]-a[1]),yaw=Math.atan2((b[0]-a[0])/l,(b[1]-a[1])/l);
        K.box(props,ctx,b[0],.6,b[1],2.6,.7,.4,{ry:yaw,color:0xb23a2e});K.box(props,ctx,b[0],.25,b[1],.5,.3,.5,{ry:yaw,color:0x4b5560});}
    }
    const y=D.yard&&D.yard[id];
    for(const [n,c] of ((y&&y.containers)||[]).entries())for(let lv=0;lv<c.levels;lv++){
      K.box(props,ctx,c.x,1.3+lv*2.62,c.z,c.l,2.59,c.w,{ry:0,color:RAIL_COLORS[(n+lv)%RAIL_COLORS.length]});
      K.box(props,ctx,c.x,1.3+lv*2.62,c.z,c.l+.04,.12,c.w+.04,{ry:0,color:0x30353a});
    }
    for(const d of ((y&&y.docks)||[])){
      const x0=d[0][0],z0=d[0][1],x1=d[2][0],z1=d[2][1];
      K.box(props,ctx,(x0+x1)/2,.45,(z0+z1)/2,x1-x0,.9,z1-z0,{color:0xb4b0a4});
      K.box(props,ctx,(x0+x1)/2,.91,z1-.14,x1-x0,.02,.24,{color:0xe5c24a});         // yellow edge on the track side
    }
    return out;
  }
  function buildPad(p){
    const id=p.id,S=D.surfaces[id],group=new THREE.Group(),surf=p.phase>=3?K.batch(true):null,ground=surf||K.batch(true),props=K.batch(true),cells=new Map(),propColliders=[],lots=lotsOf(id);
    group.name=p.group;group.userData.masterplanV161=true;
    const cell=(x,z)=>{if(surf)return surf;const key=Math.floor(x/60)+','+Math.floor(z/60);let c=cells.get(key);if(!c){c=K.batch(true);cells.set(key,c);}return c;};
    // phase 3+: ground, streets and lane paint are ONE vertex-coloured surface mesh per pad (draw-call budget; the data is still cut into 60 m cells)
    // streets: walk and asphalt triangles come from the data (holes already handled offline); lane paint goes into the cell of its midpoint
    for(const [kind,color] of [['walk',0xc6c1af],['asphalt',0x41474a]])for(const c of S[kind]){
      let bt=surf||cells.get(c.key);if(!bt){bt=K.batch(true);cells.set(c.key,bt);}
      for(let i=0;i<c.positions.length;i+=9){const P=c.positions;K.tri(bt,ctx,[P[i],P[i+1],P[i+2]],[P[i+3],P[i+4],P[i+5]],[P[i+6],P[i+7],P[i+8]],{color});}
    }
    const edges=D.edges.filter(e=>e.pad===id),others=D.edges.filter(e=>state[e.pad]&&e.pad!==id||e.pad===id);
    // no dash inside a crossing street's carriageway (the junction box of an avenue and an artery is one asphalt area)
    const crossing=(x,z,e)=>{for(const o of others){if(o===e||!state[o.pad])continue;for(let i=1;i<o.pts.length;i++){const a=o.pts[i-1],b=o.pts[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),t=((x-a[0])*dx+(z-a[1])*dz)/len;if(t<0||t>len)continue;
      const ex=e.pts[1][0]-e.pts[0][0],ez=e.pts[1][1]-e.pts[0][1],el=Math.hypot(ex,ez);if(Math.abs(dx*ez-dz*ex)/(len*el)<.5)continue;
      if(Math.abs((x-a[0])*dz-(z-a[1])*dx)/len<o.w/2-.1)return true;}}return false;};
    for(const e of edges){let traveled=0;
      if(e.cls==='ramp'||e.trench)continue;   // one-way ramps carry no centre dashes; the trench floor draws its own
      for(let i=1;i<e.pts.length;i++){const a=e.pts[i-1],b=e.pts[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len;
        const dividers=e.lanes===4?[-e.w/4,0,e.w/4]:[0];
        for(let s=0;s<len;s+=.5){if((traveled+s)%5>2)continue;const end=Math.min(s+.46,len),mx=a[0]+dx*(s+end)/2,mz=a[1]+dz*(s+end)/2;if(crossing(mx,mz,e))continue;
          for(const offset of dividers)line(cell(mx,mz),[a[0]+dx*s-dz*offset,a[1]+dz*s+dx*offset],[a[0]+dx*end-dz*offset,a[1]+dz*end+dx*offset],.09,.075,.01,0xd8d3b7);}
        traveled+=len;
      }
    }
    // paid earth slab with its embankment (a foundation down to the water, not a floating plane); the wall top sits 1 cm under the slab so the two never fight
    const land=D.land[id];
    if(land){polygon(ground,land,-.035,id==='B05'?0x8d9180:p.phase>=3?0x869078:0x768662,(D.landHoles&&D.landHoles[id])||[]);for(let i=0;i<land.length;i++)line(ground,land[i],land[(i+1)%land.length],.18,-1.025,1.96,0x786b54);}
    // phase 4: the M2 in its open cut, the overpass slab and the jersey barriers around every vehicle-only strip (data: edge.trench, edge.overpass, D.fences)
    const trench=edges.find(e=>e.trench);if(trench)drawTrench(ground,props,trench);
    const railPad=!!(D.rails&&D.rails.some(r=>r.pad===id)),sleepers=railPad?drawRails(ground,props,id):[];
    for(const f of (D.fences&&D.fences[id])||[]){
      const dx=f[2]-f[0],dz=f[3]-f[1],L=Math.hypot(dx,dz);if(L<.05)continue;
      const mx=(f[0]+f[2])/2,mz=(f[1]+f[3])/2,yaw=Math.atan2(dx,dz);
      if(railPad)K.box(props,ctx,mx,.55,mz,.07,1.1,L,{ry:yaw,color:0x59626b});   // phase 5: a thin yard fence along the blocked track strip
      else K.box(props,ctx,mx,.4,mz,.32,.8,L,{ry:yaw,color:0xa9a59a});
      if(L>=6)propColliders.push({x:mx,z:mz,hx:railPad?.05:.16,hz:L/2,yaw});   // long straight runs also in the collision registry; arcs rely on the walkable polygon alone
    }
    // parcels: vacant, as in slice 1 (the plan gives them no buildings or income yet), but landscaped by kind with the door path and a sign on the frontage side
    const transforms=[],byEdge={};
    lots.forEach((l,i)=>{
      const st=LOT_STYLE[l.kind]||LOT_STYLE._,f=lotFrame(l),c=f.at(0,f.d/2),idx=(byEdge[l.frontEdge]=(byEdge[l.frontEdge]||0)+1)-1,side=idx%2?1:-1;
      K.box(ground,ctx,c[0],-.01,c[1],f.w-.5,.06,f.d-.5,{ry:f.yaw,color:st.ground[i%2],skip:[3]});
      const pc=f.at(0,1.3);K.box(ground,ctx,pc[0],.02,pc[1],1.2,.02,2.6,{ry:f.yaw,color:st.path});
      if(st.stripes){for(const u of [-f.w/4,f.w/4]){const sc=f.at(u,f.d/2+.6);K.box(ground,ctx,sc[0],.03,sc[1],.12,.02,f.d-3,{ry:f.yaw,color:st.stripes});}}
      const post=f.at(.95*side*-1,.55);K.box(props,ctx,post[0],.55,post[1],.07,1.1,.07,{ry:f.yaw,color:0x59626b});
      K.box(props,ctx,post[0],1.05,post[1],.55,.34,.04,{ry:f.yaw,color:st.sign});
      if(st.tree&&idx%2===0){const q=f.at(side*(f.w/2-.8),.8);K.cyl(props,ctx,q[0],0,q[1],.13,.09,1.5,5,{color:0x6b4a2f});K.blob(props,ctx,q[0],2.1,q[1],1.1,.95,1.1,1,{color:[0x4f8a45,0x5b9650,0x437a3d][i%3]});K.blob(props,ctx,q[0],2.9,q[1],.65,.55,.65,1,{color:0x5f9e53});propColliders.push({x:q[0],z:q[1],hx:.16,hz:.16,yaw:0});}
      if(st.planter){const q=f.at(side*(f.w/2-.9),.9);K.box(props,ctx,q[0],.22,q[1],.9,.44,.9,{ry:f.yaw,color:0x8f8b80});K.box(props,ctx,q[0],.5,q[1],.74,.12,.74,{ry:f.yaw,color:0x4f8a45});propColliders.push({x:q[0],z:q[1],hx:.45,hz:.45,yaw:f.yaw});}
      if(idx%(st.tree?4:2)===1){const q=f.at((st.planter?-1:1)*side*(f.w/2-.45),.45);K.cyl(props,ctx,q[0],0,q[1],.06,.045,4.2,5,{color:0x4b5560});
        const arm=f.at((st.planter?-1:1)*side*(f.w/2-.45),1.0);K.box(props,ctx,(q[0]+arm[0])/2,4.18,(q[1]+arm[1])/2,.06,.06,.7,{ry:f.yaw,color:0x4b5560});K.box(props,ctx,arm[0],4.1,arm[1],.3,.1,.22,{ry:f.yaw,color:0xf0e6c0});propColliders.push({x:q[0],z:q[1],hx:.07,hz:.07,yaw:0});}
      for(let k=0;k<l.poly.length;k++){const a=l.poly[k],b=l.poly[(k+1)%l.poly.length];transforms.push({x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,length:Math.hypot(b[0]-a[0],b[1]-a[1]),yaw:Math.atan2(b[0]-a[0],b[1]-a[1])});}
    });
    const add=(bt,name,cast)=>{const m=K.toMesh(bt,vcMat(),{cast});if(!m)return null;m.name=p.group+'_'+name;m.userData.v83CollisionIgnore=true;group.add(m);return m;};
    if(sleepers.length){
      const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),mat('sleeper',0x5a4636),sleepers.length),matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),axis=new THREE.Vector3(0,1,0);
      sleepers.forEach((t,i)=>{q.setFromAxisAngle(axis,t.yaw);matrix.compose(new THREE.Vector3(t.x,.25,t.z),q,new THREE.Vector3(2.6,.14,.26));mesh.setMatrixAt(i,matrix);});
      mesh.name=p.group+'_sleepers';mesh.userData.v83CollisionIgnore=true;mesh.receiveShadow=true;mesh.frustumCulled=false;group.add(mesh);
    }
    add(ground,surf?'surface':'ground');for(const [key,bt] of cells)add(bt,'streets_'+key);add(props,'props',true);
    if(transforms.length){
      const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),mat('plots',0xd7b35c),transforms.length),matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),axis=new THREE.Vector3(0,1,0);
      transforms.forEach((t,i)=>{q.setFromAxisAngle(axis,t.yaw);matrix.compose(new THREE.Vector3(t.x,.04,t.z),q,new THREE.Vector3(.08,.008,t.length));mesh.setMatrixAt(i,matrix);});
      mesh.name=p.group+'_parcelLines';mesh.userData.v83CollisionIgnore=true;mesh.frustumCulled=false;group.add(mesh);
    }
    scene.add(group);padGroups[id]={group,props:propColliders};
    const api=window.__TYCOON_V83_COLLISIONS__;if(api)syncPadColliders(api);
  }
  function dropPad(id){
    const e=padGroups[id];if(!e)return;
    window.__TYCOON_V83_COLLISIONS__?.unregisterOwner(e.group);scene.remove(e.group);e.group.traverse(o=>{if(o.geometry)o.geometry.dispose();});delete padGroups[id];
  }
  function syncPadColliders(api){
    for(const id in padGroups){const e=padGroups[id];api.unregisterOwner(e.group);
      for(const c of e.props)api.register({owner:e.group,category:'decor',label:'mp161:prop',shape:'obb',pos:new THREE.Vector3(c.x,0,c.z),hx:c.hx,hz:c.hz,yaw:c.yaw,flags:{player:true,agent:true,placement:false,camera:false}});}
  }
  // Open water around the phase-2 floors: the old world ends in a void beyond the water ring (r 92); one quad, same colour as the port estuary.
  function refreshSea(){
    const want=PHASE_PADS.some(p=>state[p.id]);
    if(!want){if(sea){scene.remove(sea);sea.geometry.dispose();sea=null;}return;}
    const holes=state.B12&&D.landHoles&&D.landHoles.B12||[];   // the M2 trench goes below the water line: the sea plane is open above it
    if(sea&&sea.userData.holes===holes.length)return;
    if(sea){scene.remove(sea);sea.geometry.dispose();sea=null;}
    const bt=K.batch();polygon(bt,[[-420,-420],[420,-420],[420,420],[-420,420]],-.36,undefined,holes);
    sea=K.toMesh(bt,mat('water',0x5896ac));sea.userData.holes=holes.length;sea.name='mp161Sea';sea.userData.v83CollisionIgnore=true;scene.add(sea);
  }
  function refreshPhasePads(){
    for(const p of PHASE_PADS){
      if(!state[p.id]){dropPad(p.id);continue;}
      const near=nearBox(p.id),e=padGroups[p.id];
      if(e){e.group.visible=near;continue;}
      if(near)buildPad(p);
    }
    refreshSea();
  }
  // Drop every built group (flags stay): the next frames rebuild what is within reach. Used by the tests for the first-visit case; harmless otherwise.
  function dropGroups(){
    clear();if(north){scene.remove(north);north.traverse(o=>o.geometry?.dispose());north=null;}
    for(const id of Object.keys(padGroups))dropPad(id);
    if(sea){scene.remove(sea);sea.geometry.dispose();sea=null;}
  }
  // Every frame (cheap flags only): a paid group that is missing or hidden although the player is within reach is built/shown NOW, before the next render,
  // so a teleport or a reload never leaves the player standing on an invisible floor.
  function ensureNear(){
    let build=false;
    const nearPort=Math.hypot(player.position.x+98,player.position.z-21)<150,nearNorth=Math.hypot(player.position.x-6,player.position.z+108)<150;
    if(state.B01){if(root){if(root.visible!==nearPort)root.visible=nearPort;}else if(nearPort)build=true;}
    if(state.B03){if(north){if(north.visible!==nearNorth)north.visible=nearNorth;}else if(nearNorth)build=true;}
    for(const p of PHASE_PADS){if(!state[p.id])continue;const near=nearBox(p.id),e=padGroups[p.id];if(e){if(e.group.visible!==near)e.group.visible=near;}else if(near)build=true;}
    if(build)refresh();
  }
  function gate(p){return stageIndex>=p.gateStage&&totalRoadLevelsV37()>=8&&(!p.rep||cityState.reputation>=p.rep)&&p.requires.every(id=>state[id]);}
  function buy(p){
    if(state[p.id]||!gate(p))return false;
    if(otherTabSaveLockV63||suppressAutoSaveV36)return false;
    if(!tryPayResources({money:p.money,wood:0,concrete:0,metal:0})){sfx.error();toast(lang==='ru'?`Нужно ${p.money} монет`:`Need ${p.money} coins`);return false;}
    state[p.id]=true;
    try{refresh();}catch(e){state[p.id]=false;money+=p.money;clear();refresh();window.__TYCOON_CAPTURE_ERROR__?.(e,'mp161-build');return false;}
    refreshIndustrialPadMarkersV118();sfx.build();spawnBurst(industrialStepV118('mp161-'+p.id).pos.clone(),0xe1bb66);updateHUD();save();
    toast(lang==='ru'?p.toast.ru:p.toast.en);
    return true;
  }
  window.MasterplanV161={state,refresh,clear,clamp,access,floor,ensureNear,dropGroups,syncColliders,syncBackdrop,groups:padGroups};
  function padPosition(p){
    if(p.id==='B03'){
      for(let x=0;x<=12;x+=2)for(let z=-64;z<=-55;z+=2){
        if(sourceTrees.some(t=>t?.mesh&&Math.hypot(x-t.mesh.position.x,z-t.mesh.position.z)<TREE_INTERACT_RADIUS+1))continue;
        if(gatherPhysicsCircles().some(c=>Math.hypot(x-c.pos.x,z-c.pos.z)<c.radius+1))continue;
        return new THREE.Vector3(x,0,z);
      }
      return new THREE.Vector3(6,0,-57.1);
    }
    if(p.id==='B06'||p.id==='B11'){
      // The avenue starts at the ring; the circle stands in the old core beside its first metres (free of trees and colliders), never on unpaid water.
      for(const [x,z] of p.id==='B06'?[p.pos,[64,-9],[66,10.5],[66,-10.5],[62.5,11],[62.5,-11],[67,8.5],[67,-8.5]]:[p.pos,[-5,64],[16,66],[-7,66],[17,62.5],[-8,62.5],[20,64],[-11,64]]){
        if(sourceTrees.some(t=>t?.mesh&&Math.hypot(x-t.mesh.position.x,z-t.mesh.position.z)<TREE_INTERACT_RADIUS+1))continue;
        if(gatherPhysicsCircles().some(c=>Math.hypot(x-c.pos.x,z-c.pos.z)<c.radius+1))continue;
        return new THREE.Vector3(x,0,z);
      }
      return new THREE.Vector3(p.pos[0],0,p.pos[1]);
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
  for(const p of D.pads)INDUSTRIAL_BUILD_STEPS_V118.push({id:'mp161-'+p.id,masterplanV161:true,icon:p.icon,color:0xe1bb66,
    ru:p.ru,en:p.en,
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
    ensureNear();
    if(now-lastTick<500)return;lastTick=now;
    const gateKey=D.pads.map(p=>`${state[p.id]}:${gate(p)}`).join('|');
    if(gateKey!==lastGate){lastGate=gateKey;refresh();refreshIndustrialPadMarkersV118();}
  });
})();
