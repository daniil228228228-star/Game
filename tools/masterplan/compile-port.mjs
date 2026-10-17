// Compile the paid masterplan slices (plan B) into assets/masterplan-port-data-v161.js.  node tools/masterplan/compile-port.mjs [--phase=5]
// ONE script for every pad B01..B18: a later phase only raises --phase (and adds its texts/overrides below); the game layer reads everything from the data.
// Union surfaces once, clip triangles to 60 m cells. Uses the game's contour solver OFFLINE: malformed contours stop the build, never a player's frame.
//
// Data written (window.MasterplanPortDataV161):
//   pads[]       {id, phase, group, gateStage, rep, money, requires, pos, ru, en, icon, toast:{ru,en}}   (rep comes from meta.phaseInfo "репутация N")
//   edges[]      plan edges of the compiled pads (axis polylines, w, sw, lanes, cls, pad)
//   lots[]       plan lots of the compiled pads (poly, door, normal, kind, frontEdge, pad)
//   pier         B02 pier polygon (kept for the tests), piers{pad: poly}
//   land{pad}    paid earth slab polygons (the floor between the streets) for pads that own one
//   surfaces{B01,B02,B03,B04,...}.{walk,asphalt}[]  triangles (with holes!) cut into <=60 m cells; B02 is the whole port (B01+B02 edges)
//   boundaries{} outer/hole loops of the walk union (embankment base lines)
//   walkable{pad}  WALKABLE POLYGONS: array of regions, a region = array of loops (even-odd, so holes work). The game's access()/clamp()/restore/backdrop use only these.
//   bbox{pad}    [x0,z0,x1,z1] of the walkable floor (the 150 m build radius is measured to it)
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const THREE=require('../../vendor/three_r128/three.min.js');
const plan=JSON.parse(fs.readFileSync(new URL('plan-B.json',import.meta.url),'utf8'));
const source=fs.readFileSync(new URL('../../tycoon-v161.html',import.meta.url),'utf8');
const context=vm.createContext({Math,Map,Set,Error});
vm.runInContext(source.slice(source.indexOf('function insideRoadFootprints('),source.indexOf('let unionLayer=null')),context);

const arg=(name,def)=>{const a=process.argv.find(x=>x.startsWith('--'+name+'='));return a?a.split('=')[1]:def;};
const MAX_PHASE=+arg('phase',6);
const pads=plan.pads.filter(p=>p.phase<=MAX_PHASE);
const padIds=pads.map(p=>p.id);
const railsAll=MAX_PHASE>=5?plan.rails.filter(r=>padIds.includes(r.pad)):[];
const railNodes=MAX_PHASE>=5?plan.railNodes.filter(n=>n.phase<=MAX_PHASE):[];
const stations=MAX_PHASE>=5?plan.stations.filter(s=>padIds.includes(s.pad)):[];
// Everything that is a texts/override of a particular pad lives here, so a new phase never touches the game code.
const GROUP={B01:'mp161Net',B02:'mp161Net',B03:'mp161North',B04:'mp161NW',B05:'mp161Park',B06:'mp161Main',B07:'mp161Chord',B08:'mp161ParkE',B09:'mp161East',B10:'mp161Centre',B11:'mp161South',B12:'mp161M2',B13:'mp161Rail',B14:'mp161Siding',B15:'mp161Station'};
const TEXT={
  B01:{icon:'⚓',ru:'Портовая авеню',en:'Port avenue',toast:{ru:'Портовая авеню открыта. Следующий кружок — у причала.',en:'Port avenue open. The next pad is at the quay.'}},
  B02:{icon:'⚓',ru:'Причал и участки порта',en:'Pier and port parcels',toast:{ru:'Причал открыт: пять участков подготовлены к следующим этапам.',en:'Pier open: five parcels reserved for the next phases.'}},
  B03:{icon:'🛣️',ru:'Северный проспект',en:'North avenue',toast:{ru:'Северный проспект открыт. Подготовлены три участка.',en:'North avenue open. Three parcels prepared.'}},
  B04:{icon:'🏘️',ru:'Северо-западные кварталы',en:'North-west blocks',toast:{ru:'Северо-западные кварталы открыты: 35 участков под жильё подготовлены.',en:'North-west blocks open: 35 housing parcels prepared.'}},
  B05:{icon:'🏭',ru:'Промпарк и Северная магистраль',en:'Industrial park and Northern artery',toast:{ru:'Промпарк открыт: 8 промышленных участков подготовлены.',en:'Industrial park open: 8 industrial parcels prepared.'}},
  B06:{icon:'🛣️',ru:'Главный проспект (к Хорде)',en:'Main avenue (to the Chord)',toast:{ru:'Главный проспект открыт до Восточной хорды.',en:'Main avenue open up to the Eastern chord.'}},
  B07:{icon:'🛣️',ru:'Восточная хорда (север)',en:'Eastern chord (north)',toast:{ru:'Восточная хорда открыта: 6 участков подготовлены.',en:'Eastern chord open: 6 parcels prepared.'}},
  B08:{icon:'🏭',ru:'Промпарк (восток) и окружная',en:'Industrial park (east) and ring street',toast:{ru:'Восточный промпарк открыт: 35 участков подготовлены.',en:'East industrial park open: 35 parcels prepared.'}},
  B09:{icon:'🏘️',ru:'Главный проспект (восток), жилые кварталы',en:'Main avenue (east), housing blocks',toast:{ru:'Восточные кварталы открыты: 33 участка подготовлены.',en:'East blocks open: 33 parcels prepared.'}},
  B11:{icon:'🛣️',ru:'Южный проспект и Южная улица',en:'South avenue and South street',toast:{ru:'Южный проспект открыт до набережной: 10 участков подготовлены.',en:'South avenue open down to the embankment: 10 parcels prepared.'}},
  B12:{icon:'🛣️',ru:'М2 и развязка IC-1',en:'M2 and interchange IC-1',toast:{ru:'М2 и развязка IC-1 открыты: магистраль идёт в траншее под Хордой, 3 склада подготовлены.',en:'M2 and interchange IC-1 open: the expressway runs in a trench under the Chord, 3 warehouses prepared.'}},
  B13:{icon:'🚆',ru:'Железная дорога и грузовой парк',en:'Railway and freight yard',toast:{ru:'Железная дорога открыта: два главных пути и грузовой парк, пути за ограждением.',en:'Railway open: two main tracks and a freight yard, tracks behind a fence.'}},
  B14:{icon:'🚆',ru:'Подъездная ветка и склады',en:'Siding and warehouses',toast:{ru:'Подъездная ветка к складам открыта: погрузочная платформа готова.',en:'Siding to the warehouses open: the loading dock is ready.'}},
  B15:{icon:'🚉',ru:'Южный вокзал',en:'South station',toast:{ru:'Южный вокзал открыт: здание, привокзальная площадь, две платформы и автовокзал.',en:'South station open: the hall, the forecourt, two platforms and the bus station.'}},
  B10:{icon:'🏙️',ru:'Деловой центр',en:'Business centre',toast:{ru:'Деловой центр открыт: 8 площадок подготовлены.',en:'Business centre open: 8 plazas prepared.'}},
};
// Purchase circles that are not the plan node: B03 searches a clear spot in the game; B04/B05 plan nodes (-102,-100)/(6,-100) lie on unpaid ground / the avenue,
// the circle must stand on the floor the player already owns (rule 3: the player can reach every pad): on the paid strip beside each artery's first metre.
// Phase 3 circles also stand on floor that is ALREADY paid when the pad appears (B06: the old core east of the ring, searched in the game for a clear spot; B07: B05's earth beside the
// chord start; B08: B07's land beside the chord; B09: B07's land at the avenue crossing; B10: B09's land in the gap between two parcels).
const PAD_POS={B04:[-3.5,-97.5],B05:[11.5,-97.5],B06:[64,9],B07:[106,-95.4],B08:[106.5,-92],B09:[111,1],B10:[150,8],B11:[14,64],B12:[110,104],B13:[165,52.9],B14:[203,90],B15:[122,53.2]};   // phase 5: B13 on B10's land south of the z=48 street (the yard itself is unpaid until bought), B14 on B12's land east of the warehouse parcels   // phase 4: B11 in the old core beside the avenue start (searched in the game), B12 on B07's land beside the chord's end
// Paid earth slab of a pad (the floor between its streets). B03 is the slice-1 rectangle (kept byte for byte); later pads default to the padded bbox of their roads+lots.
const LAND={
  B03:[[-8,-60],[14,-60],[14,-155],[-8,-155]],
  B04:[[-108,-155],[-8,-155],[-8,-94],[-108,-94]],   // NW1+NW2 west of the strip: streets x -102..-48, z -148/-100 (+walk 5.2 m), lots, coast z -155 like the strip
  B05:[[14,-155],[108,-155],[108,-94],[14,-94]],     // NE1+NE2 east of the strip, up to the cap of N21 (102,-100)
  // Phase 3 (east). Slabs may overlap each other (same colour, same height: invisible), never leave a hole between two pads that can be bought in the planned order.
  B06:[[60,-8],[110,-8],[110,8],[60,8]],              // main avenue z 0 from the ring (60.2) to the Chord (+ its cap 6.1)
  B07:[[94,-94],[118,-94],[118,108],[94,108]],        // Chord x 102 from B05's land (z -94) to its stub z 100 (+cap) with the parcels east of it (x <= 115.6)
  // Industrial park east: R1+R2 (z -155..-66) and the strips of its x=150 / x=198 collectors down to z 52 (their parcels), a comb: the blocks between belong to B09/B10
  B08:[[108,-155],[206,-155],[206,52],[181,52],[181,-66],[167,-66],[167,52],[133,52],[133,-66],[118,-66],[118,-94],[108,-94]],
  B09:[[118,-66],[206,-66],[206,16],[118,16]],        // z=-52 and z=0 avenues, the blocks between
  B10:[[118,16],[206,16],[206,54],[118,54]],          // z=48 street and the southern halves of the two business blocks
  // Phase 4 (south; the estuary starts at z 192, the floors stop at z 188). B11: avenue x 6 (z 58..188), South street z 100 with its parcels (to x 106), the M2 arterial z 140 (to x 32, where the expressway hole begins). B12: everything between x 26 and the map edge 212
  B11:[[-4,58],[16,58],[16,88],[106,88],[106,104],[16,104],[16,134],[32,134],[32,146],[16,146],[16,188],[-4,188]],
  B12:[[26,88],[212,88],[212,188],[26,188]],
  // Phase 5 (railway). One slab for the freight yard, the two main tracks and the siding zone, between B10 (z 54) and B12 (z 88); the tracks themselves are BLOCKERS (not walkable), see below
  B13:[[108,52],[212,52],[212,90],[108,90]],
};
// Holes of a slab that are NOT earth: the open cut of the M2 trench (clear span 18 m of the overpass; the walls, the floor and the bridge are drawn by the game from the trench profile)
const cutOf=()=>{const o=plan.edges.find(e=>e.overpass&&e.phase<=MAX_PHASE);if(!o)return null;const t=plan.edges.find(e=>e.id===o.overpass.over);const [x0,x1]=[Math.min(...t.trench.profile.map(q=>q[0])),Math.max(...t.trench.profile.map(q=>q[0]))],zc=t.pts[0][1],h=o.overpass.clearSpan/2;return {edge:t.id,rect:[[x0,zc-h],[x1,zc-h],[x1,zc+h],[x0,zc+h]],x0,x1,zc,h};};
const CUT=MAX_PHASE>=4?cutOf():null;
// Expressway / ramps are for vehicles: pedestrians never walk on them (no height logic anywhere: every walkable floor is flat y=0, the trench is a hole in the floor, the overpass deck is level 0)
const VEHICLE_ONLY=e=>e.cls==='expressway'||e.cls==='ramp';
// M2 at grade (outside the trench): flat-ended rectangles, no round junction caps (they would hang over the trench portal / the arterial)
const M2_STRIP=MAX_PHASE>=4?{x0:32.26,x1:212,z0:133,z1:147}:null;
const EXPRESS_RECTS={B12:[[[154,133],[210,133],[210,147],[154,147]],[[32.26,133],[50,133],[50,147],[32.26,147]]]};

const edgesAll=plan.edges.filter(e=>padIds.includes(e.pad));
const edges=edgesAll.map(e=>({...e}));
// The first 4.1 m of B-PORT / B-N-1 lie over the existing ring. Keep the frozen ring itself untouched.
for(let i=0;i<edges.length;i++){
  if(edges[i].id==='B-S-1'){const p=edges[i].pts[0];edges[i]={...edges[i],pts:edges[i].pts.map((q,j)=>j?q:[p[0],Math.sqrt(60.2*60.2-p[0]*p[0])])};continue;}   // phase 4: the avenue starts at the outer edge of the ring (r 60.2), straight along x=6
  if(edges[i].id==='B-PORT'||edges[i].id==='B-N-1'||edges[i].id==='B-MAIN-1'){const p=edges[i].pts[0];edges[i]={...edges[i],pts:edges[i].pts.map((q,j)=>j?q:[p[0]*60.2/Math.hypot(...p),p[1]*60.2/Math.hypot(...p)])};}
}
function footprints(list,walk,extra=[]){
  const out=[];
  const add=poly=>{const triangles=[];for(let i=1;i<poly.length-1;i++)triangles.push([poly[0],poly[i],poly[i+1]].map(p=>({x:p[0],z:p[1]})));out.push({triangles,minX:Math.min(...poly.map(p=>p[0])),maxX:Math.max(...poly.map(p=>p[0])),minZ:Math.min(...poly.map(p=>p[1])),maxZ:Math.max(...poly.map(p=>p[1]))});};
  for(const poly of extra)add(poly);
  for(const e of list){const hw=e.w/2+(walk?e.sw:0);for(let i=1;i<e.pts.length;i++){const a=e.pts[i-1],b=e.pts[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]),nx=-(b[1]-a[1])/l*hw,nz=(b[0]-a[0])/l*hw;add([[a[0]+nx,a[1]+nz],[b[0]+nx,b[1]+nz],[b[0]-nx,b[1]-nz],[a[0]-nx,a[1]-nz]]);}
    // Exact union removes overlap at joins. No circle at the frozen ring end.
    for(let i=1;i<e.pts.length;i++){const p=e.pts[i];add(Array.from({length:32},(_,j)=>[p[0]+Math.cos(j*Math.PI/16)*hw,p[1]+Math.sin(j*Math.PI/16)*hw]));}}
  return out;
}
function clip(poly,axis,value,less){const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],ia=less?a[axis]<=value:a[axis]>=value,ib=less?b[axis]<=value:b[axis]>=value;if(ia)out.push(a);if(ia!==ib){const t=(value-a[axis])/(b[axis]-a[axis]);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}return out;}
const area=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.x*b.z-b.x*a.z;},0)/2;
const inRing=(p,ring)=>{let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)inside=!inside;}return inside;};
const round=loop=>loop.map(p=>[+p.x.toFixed(5),+p.z.toFixed(5)]);
// Road blocks closed by their own streets (NW1) leave a hole in the union: triangulate outers WITH their holes (the game does the same for the starter roads).
function loopsOf(list,walk,extra){context.fp=footprints(list,walk,extra);return vm.runInContext('roadUnionContours(fp)',context);}
function triangles(loops){
  const outers=loops.filter(p=>area(p)>1e-7).map(p=>({p,holes:[]}));
  for(const hole of loops.filter(p=>area(p)<-1e-7)){const parents=outers.filter(o=>inRing(hole[0],o.p)).sort((a,b)=>area(a.p)-area(b.p));if(!parents.length)throw new Error('Road union hole has no outer ring');parents[0].holes.push(hole);}
  const out=[];
  for(const o of outers){
    const contour=o.p.map(p=>new THREE.Vector2(p.x,p.z)),holes=o.holes.map(h=>h.map(p=>new THREE.Vector2(p.x,p.z))),all=contour.concat(...holes);
    for(const tri of THREE.ShapeUtils.triangulateShape(contour,holes))out.push(tri.map(i=>[all[i].x,all[i].y]));
  }
  return out;
}
const boundaries={};
function surface(list,walk,key,extra){
  const loops=loopsOf(list,walk,extra);
  if(walk)boundaries[key]=loops.map(round);
  const chunks=new Map();
  for(const poly of triangles(loops)){
    for(let cx=Math.floor(Math.min(...poly.map(p=>p[0]))/60);cx<=Math.floor(Math.max(...poly.map(p=>p[0]))/60);cx++)for(let cz=Math.floor(Math.min(...poly.map(p=>p[1]))/60);cz<=Math.floor(Math.max(...poly.map(p=>p[1]))/60);cz++){
      let q=poly;for(const [axis,value,less] of [[0,cx*60,false],[0,(cx+1)*60,true],[1,cz*60,false],[1,(cz+1)*60,true]]){q=clip(q,axis,value,less);if(!q.length)break;}if(q.length<3)continue;
      const key=cx+','+cz,arr=chunks.get(key)||[];for(let i=1;i<q.length-1;i++){const a=q[0],b=q[i],c=q[i+1],ar=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);if(Math.abs(ar)<1e-8)continue;for(const p of ar<0?[a,b,c]:[a,c,b])arr.push(+p[0].toFixed(5),walk?.025:.065,+p[1].toFixed(5));}chunks.set(key,arr);
    }
  }
  return [...chunks].map(([key,positions])=>({key,positions}));
}
const own=id=>edges.filter(e=>e.pad===id);
const surfaces={};
// B02's mesh set is the WHOLE port (B01+B02 edges) so the two never overlap; every other pad is its own group.
for(const id of padIds){
  let list=id==='B02'?edges.filter(e=>e.pad==='B01'||e.pad==='B02'):own(id);
  if(!list.length){if(railsAll.some(r=>r.pad===id)||stations.some(q=>q.pad===id))surfaces[id]={walk:[],asphalt:[]};continue;}   // rail / station pads draw their own track and hall
  const extra=EXPRESS_RECTS[id]||[];
  if(extra.length)list=list.filter(e=>!/^B-M2-[1-4]$/.test(e.id));   // M2 at grade = the flat rectangles; the trench piece is drawn by the game
  // the sidewalk-coloured under-layer exists only for streets people walk on (an expressway / ramp has no sidewalk: asphalt alone, half the triangles)
  const walkList=extra.length||list.some(VEHICLE_ONLY)?list.filter(e=>!VEHICLE_ONLY(e)):list;
  surfaces[id]={walk:walkList.length?surface(walkList,true,id,[]):[],asphalt:surface(list,false,id,extra)};
}

// ---- phase 5: rails. Static track (ballast + sleepers + rails drawn by the game from the axis polylines), impassable for pedestrians: BLOCKERS (even-odd regions like the walkable floor,
// subtracted from it while the pad is paid) with a fence on their boundary. The plan has no level crossings, so there is no way over a track; the freight yard is one fenced block.
const RAIL_BLOCK_HW=3;                                     // half width of the blocked strip: ballast 3.4 m + 1.3 m either side for the fence; the two main tracks (6 m apart) merge into one strip, no 1.2 m slot between them
// Solid yard furniture (all data, drawn by the game): container stacks of the freight yard along its north edge, the loading dock beside the siding (platform 1.2 m from the axis, plan rule 0.8..2.4)
const yard={};
if(railsAll.length){
  const CONT=[[148,0,2],[154.4,0,1],[160.8,0,2],[184,0,1],[190.4,0,2],[196.8,0,1]];   // x centre, yaw, levels; z 57.4 (north of the yard tracks, south of the B10 street)
  yard.B13={containers:CONT.map(([x,yaw,levels])=>({x,z:57.4,l:6.1,w:2.44,yaw,levels}))};
  yard.B14={docks:[[[154,82.6],[174,82.6],[174,84.8],[154,84.8]]]};
}
const rectOf=c=>{const hx=c.l/2,hz=c.w/2;return [[c.x-hx,c.z-hz],[c.x+hx,c.z-hz],[c.x+hx,c.z+hz],[c.x-hx,c.z+hz]];};
const blockers={};
if(railsAll.length){
  for(const id of padIds){
    const rs=railsAll.filter(r=>r.pad===id);if(!rs.length)continue;
    // exits run on to the map edge (the blocked strip leaves no way round the end of a track)
    const list=rs.map(r=>{const pts=r.pts.map(p=>[...p]);if(railNodes.find(n=>n.id===r.from)?.type==='exit')pts.unshift([pts[0][0]+(pts[0][0]>=206?2:-2),pts[0][1]]);return {w:RAIL_BLOCK_HW*2,sw:0,pts};});
    const regions=[loopsOf(list,false).map(round)];
    for(const c of (yard[id]?.containers||[]))regions.push([rectOf(c)]);
    for(const d of (yard[id]?.docks||[]))regions.push([d]);
    blockers[id]=regions;
  }
}
// ---- phase 6: stations. The hall and the platforms are solid (blockers, fenced); the forecourt, the bus station and the apron south of the tracks lie on floor that is already paid (B10 / B13 / B12).
// The plan's pedestrian underpass is not built: the bus station is reached over the floor south of the tracks, so no walkway has to cross the blocked strip.
for(const st of stations){
  const regions=[st.building,...(st.platforms||[])].filter(Boolean).map(r=>[r.map(q=>[...q])]);
  if(regions.length)blockers[st.pad]=regions;
}
// walkable regions
const PIER_OF={B02:'PIER-1'};   // plan.piers ids differ from the pad element names (B-PIER)
const piers={};for(const id of padIds)if(PIER_OF[id])piers[id]=plan.piers.find(q=>q.id===PIER_OF[id]).poly;
const lots=plan.lots.filter(l=>padIds.includes(l.pad));
const land={};
for(const id of padIds){
  if(LAND[id]){land[id]=LAND[id];continue;}
  if(pads.find(p=>p.id===id).phase<2)continue;   // slice 1 (port) has no earth slab: its floor is the drawn streets, pier and decks only
  const es=own(id);if(!es.length)continue;
  const xs=[],zs=[];for(const e of es){const hw=e.w/2+e.sw;for(const q of e.pts){xs.push(q[0]-hw,q[0]+hw);zs.push(q[1]-hw,q[1]+hw);}}
  for(const l of lots.filter(l=>l.pad===id))for(const q of l.poly){xs.push(q[0]);zs.push(q[1]);}
  const x0=Math.floor(Math.min(...xs)/2)*2-2,x1=Math.ceil(Math.max(...xs)/2)*2+2,z0=Math.floor(Math.min(...zs)/2)*2-2,z1=Math.ceil(Math.max(...zs)/2)*2+2;
  land[id]=[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
}
// Holes in the walkable slab (pad B12): the M2 carriageway (rectangle, flat ends), the open cut of the trench and the four ramps. Together with the roads' own walkable regions
// (frontage streets, the chord's overpass deck) they form the floor: the deck region lies OVER the cut, so the chord is walkable across the trench.
const landHoleCache={};
function landHoleLoops(id){
  if(id!=='B12'||!M2_STRIP||!CUT)return [];
  if(!landHoleCache[id]){
    const ramps=own(id).filter(e=>e.cls==='ramp'),poly=[[M2_STRIP.x0,M2_STRIP.z0],[M2_STRIP.x1,M2_STRIP.z0],[M2_STRIP.x1,M2_STRIP.z1],[M2_STRIP.x0,M2_STRIP.z1]];
    landHoleCache[id]=loopsOf(ramps,false,[poly,CUT.rect]).map(round);
  }
  return landHoleCache[id];
}
const landHoles={};if(CUT&&padIds.includes('B12'))landHoles.B12=[CUT.rect.map(p=>[...p])];
const walkable={},bbox={};
for(const id of padIds){
  const regions=[];
  const es=own(id).filter(e=>!VEHICLE_ONLY(e));   // expressway and ramps are not floor for the player
  if(es.length)regions.push(loopsOf(es,true).map(round));
  if(piers[id])regions.push([piers[id]]);
  for(const l of lots.filter(l=>l.pad===id&&id==='B02'))regions.push([l.poly]);   // slice 1: port lots are separate decks; later pads' lots lie on the earth slab
  if(land[id]){
    const holes=landHoleLoops(id);
    regions.push([land[id],...holes]);
  }
  walkable[id]=regions;
  const pts=regions.flat(2).concat((blockers[id]||[]).flat(2));
  bbox[id]=[Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))].map(v=>+v.toFixed(3));
}
// FENCES: jersey barriers along the boundary of the vehicle-only holes, except where a street's walkable floor lies over the hole (frontage streets at the ramp ends, the overpass deck).
const fences={};
// Jersey/fence segments along the boundary loops, merged where collinear; skip(x,z,nx,nz) true = leave this metre open (a street's floor lies over the hole, a dock stands there).
function fenceSegs(loops,skip){
  const segs=[];
  for(const loop of loops){
    const ar=loop.reduce((s,a,i)=>{const b=loop[(i+1)%loop.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;
    for(let i=0;i<loop.length;i++){
      const a=loop[i],b=loop[(i+1)%loop.length],L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(L<.05)continue;
      const nx=(b[1]-a[1])/L*(ar>0?1:-1),nz=-(b[0]-a[0])/L*(ar>0?1:-1);   // outward normal
      const n=Math.max(1,Math.ceil(L)),open=[];
      for(let k=0;k<n;k++){const t=(k+.5)/n,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;open.push(!skip(x,z,nx,nz));}
      let k=0;while(k<n){if(!open[k]){k++;continue;}let m=k;while(m<n&&open[m])m++;
        const p=[a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n],q=[a[0]+(b[0]-a[0])*m/n,a[1]+(b[1]-a[1])*m/n];
        const last=segs[segs.length-1];
        if(last&&Math.hypot(last[2]-p[0],last[3]-p[1])<.02&&Math.abs((last[2]-last[0])*(q[1]-p[1])-(last[3]-last[1])*(q[0]-p[0]))<1e-3*Math.hypot(last[2]-last[0],last[3]-last[1])*Math.hypot(q[0]-p[0],q[1]-p[1])&&(last[2]-last[0])*(q[0]-p[0])+(last[3]-last[1])*(q[1]-p[1])>0)last[2]=+q[0].toFixed(3),last[3]=+q[1].toFixed(3);
        else segs.push([+p[0].toFixed(3),+p[1].toFixed(3),+q[0].toFixed(3),+q[1].toFixed(3)]);
        k=m;}
    }
  }
  return segs;
}
if(landHoles.B12){
  const roadLoops=[];for(const id of padIds)if(walkable[id])walkable[id].forEach((r,i)=>{if(!(land[id]&&i===walkable[id].length-1))roadLoops.push(r);});
  const onRoad=(x,z)=>roadLoops.some(r=>{let yes=false;for(const l of r){let inside=false;for(let i=0,j=l.length-1;i<l.length;j=i++){const a=l[i],b=l[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;}if(inside)yes=!yes;}return yes;});
  fences.B12=fenceSegs(landHoles.B12?landHoleLoops('B12'):[],(x,z,nx,nz)=>onRoad(x+nx*.3,z+nz*.3)&&onRoad(x-nx*.3,z-nz*.3));
}
// Rails: fence along the outer boundary of every blocked strip (container stacks and the dock are solid themselves: no fence where they stand)
for(const id in blockers){
  if(stations.some(q=>q.pad===id)){fences[id]=blockers[id].flatMap(region=>fenceSegs(region,()=>false));continue;}   // station pads: every region is solid (hall, platforms)
  const solid=[...(yard[id]?.containers||[]).map(rectOf),...(yard[id]?.docks||[])];
  const inBox=(x,z,p)=>x>p[0][0]-.35&&x<p[2][0]+.35&&z>p[0][1]-.35&&z<p[2][1]+.35;
  const sub=[...(yard[id]?.containers||[]).map(rectOf),...(yard[id]?.docks||[])];
  fences[id]=fenceSegs(blockers[id][0],(x,z)=>x>212.2||solid.some(p=>inBox(x,z,p)));
}
const repOf=p=>{const m=/репутация\s+(\d+)/.exec(plan.meta.phaseInfo[p.phase]||'');return m?+m[1]:0;};
const outPads=pads.map(p=>{const q={id:p.id,phase:p.phase,group:GROUP[p.id],gateStage:p.gateStage,money:p.money,requires:p.requires,pos:PAD_POS[p.id]||p.pos,name:p.name,...TEXT[p.id]};const rep=p.id==='B03'?25:repOf(p);if(rep)q.rep=rep;return q;});
const out={version:3,pads:outPads,edges,lots,pier:plan.piers[0].poly,piers,land,surfaces,boundaries,walkable,bbox};
if(Object.keys(landHoles).length){out.landHoles=landHoles;out.fences=fences;}   // phase 4+ only: older data keeps its exact shape
if(railsAll.length){out.version=4;out.rails=railsAll;out.railNodes=railNodes;out.stations=stations;out.blockers=blockers;out.yard=yard;}   // phase 5+ only
const text='// Generated by tools/masterplan/compile-port.mjs --phase='+MAX_PHASE+'; no network assets.\nwindow.MasterplanPortDataV161='+JSON.stringify(out)+';\n';
const target=new URL('../../assets/masterplan-port-data-v161.js',import.meta.url);
if(process.argv.includes('--check')){   // tests: the committed data must equal a fresh compile
  const same=fs.existsSync(target)&&fs.readFileSync(target,'utf8')===text;
  console.log(same?'data is up to date':'DATA IS STALE: run node tools/masterplan/compile-port.mjs');
  process.exit(same?0:1);
}
fs.writeFileSync(target,text);
console.log('Compiled '+padIds.join('/')+': '+lots.length+' lots, '+edges.length+' edges, cells '+padIds.map(i=>i+':'+(surfaces[i]?surfaces[i].walk.length+'+'+surfaces[i].asphalt.length:0)).join(' '));
