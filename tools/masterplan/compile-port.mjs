// Compile the paid masterplan slices (plan B) into assets/masterplan-port-data-v161.js.  node tools/masterplan/compile-port.mjs [--phase=2]
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
const MAX_PHASE=+arg('phase',2);
const pads=plan.pads.filter(p=>p.phase<=MAX_PHASE);
const padIds=pads.map(p=>p.id);
// Everything that is a texts/override of a particular pad lives here, so a new phase never touches the game code.
const GROUP={B01:'mp161Net',B02:'mp161Net',B03:'mp161North',B04:'mp161NW',B05:'mp161Park'};
const TEXT={
  B01:{icon:'⚓',ru:'Портовая авеню',en:'Port avenue',toast:{ru:'Портовая авеню открыта. Следующий кружок — у причала.',en:'Port avenue open. The next pad is at the quay.'}},
  B02:{icon:'⚓',ru:'Причал и участки порта',en:'Pier and port parcels',toast:{ru:'Причал открыт: пять участков подготовлены к следующим этапам.',en:'Pier open: five parcels reserved for the next phases.'}},
  B03:{icon:'🛣️',ru:'Северный проспект',en:'North avenue',toast:{ru:'Северный проспект открыт. Подготовлены три участка.',en:'North avenue open. Three parcels prepared.'}},
  B04:{icon:'🏘️',ru:'Северо-западные кварталы',en:'North-west blocks',toast:{ru:'Северо-западные кварталы открыты: 35 участков под жильё подготовлены.',en:'North-west blocks open: 35 housing parcels prepared.'}},
  B05:{icon:'🏭',ru:'Промпарк и Северная магистраль',en:'Industrial park and Northern artery',toast:{ru:'Промпарк открыт: 8 промышленных участков подготовлены.',en:'Industrial park open: 8 industrial parcels prepared.'}},
};
// Purchase circles that are not the plan node: B03 searches a clear spot in the game; B04/B05 plan nodes (-102,-100)/(6,-100) lie on unpaid ground / the avenue,
// the circle must stand on the floor the player already owns (rule 3: the player can reach every pad): on the paid strip beside each artery's first metre.
const PAD_POS={B04:[-3.5,-97.5],B05:[11.5,-97.5]};
// Paid earth slab of a pad (the floor between its streets). B03 is the slice-1 rectangle (kept byte for byte); later pads default to the padded bbox of their roads+lots.
const LAND={
  B03:[[-8,-60],[14,-60],[14,-155],[-8,-155]],
  B04:[[-108,-155],[-8,-155],[-8,-94],[-108,-94]],   // NW1+NW2 west of the strip: streets x -102..-48, z -148/-100 (+walk 5.2 m), lots, coast z -155 like the strip
  B05:[[14,-155],[108,-155],[108,-94],[14,-94]],     // NE1+NE2 east of the strip, up to the cap of N21 (102,-100)
};

const edgesAll=plan.edges.filter(e=>padIds.includes(e.pad));
const edges=edgesAll.map(e=>({...e}));
// The first 4.1 m of B-PORT / B-N-1 lie over the existing ring. Keep the frozen ring itself untouched.
for(let i=0;i<edges.length;i++){
  if(edges[i].id==='B-PORT'||edges[i].id==='B-N-1'){const p=edges[i].pts[0];edges[i]={...edges[i],pts:edges[i].pts.map((q,j)=>j?q:[p[0]*60.2/Math.hypot(...p),p[1]*60.2/Math.hypot(...p)])};}
}
function footprints(list,walk){
  const out=[];
  const add=poly=>{const triangles=[];for(let i=1;i<poly.length-1;i++)triangles.push([poly[0],poly[i],poly[i+1]].map(p=>({x:p[0],z:p[1]})));out.push({triangles,minX:Math.min(...poly.map(p=>p[0])),maxX:Math.max(...poly.map(p=>p[0])),minZ:Math.min(...poly.map(p=>p[1])),maxZ:Math.max(...poly.map(p=>p[1]))});};
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
function loopsOf(list,walk){context.fp=footprints(list,walk);return vm.runInContext('roadUnionContours(fp)',context);}
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
function surface(list,walk,key){
  const loops=loopsOf(list,walk);
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
  const list=id==='B02'?edges.filter(e=>e.pad==='B01'||e.pad==='B02'):own(id);
  if(!list.length)continue;
  surfaces[id]={walk:surface(list,true,id),asphalt:surface(list,false,id)};
}
// walkable regions
const PIER_OF={B02:'PIER-1'};   // plan.piers ids differ from the pad element names (B-PIER)
const piers={};for(const id of padIds)if(PIER_OF[id])piers[id]=plan.piers.find(q=>q.id===PIER_OF[id]).poly;
const lots=plan.lots.filter(l=>padIds.includes(l.pad));
const land={};
for(const id of padIds){
  if(LAND[id]){land[id]=LAND[id];continue;}
  const es=own(id);if(!es.length)continue;
  const xs=[],zs=[];for(const e of es){const hw=e.w/2+e.sw;for(const q of e.pts){xs.push(q[0]-hw,q[0]+hw);zs.push(q[1]-hw,q[1]+hw);}}
  for(const l of lots.filter(l=>l.pad===id))for(const q of l.poly){xs.push(q[0]);zs.push(q[1]);}
  const x0=Math.floor(Math.min(...xs)/2)*2-2,x1=Math.ceil(Math.max(...xs)/2)*2+2,z0=Math.floor(Math.min(...zs)/2)*2-2,z1=Math.ceil(Math.max(...zs)/2)*2+2;
  land[id]=[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
}
const walkable={},bbox={};
for(const id of padIds){
  const regions=[];
  const es=own(id);
  if(es.length)regions.push(loopsOf(es,true).map(round));
  if(piers[id])regions.push([piers[id]]);
  for(const l of lots.filter(l=>l.pad===id&&id==='B02'))regions.push([l.poly]);   // slice 1: port lots are separate decks; later pads' lots lie on the earth slab
  if(land[id])regions.push([land[id]]);
  walkable[id]=regions;
  const pts=regions.flat(2);
  bbox[id]=[Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))].map(v=>+v.toFixed(3));
}
const repOf=p=>{const m=/репутация\s+(\d+)/.exec(plan.meta.phaseInfo[p.phase]||'');return m?+m[1]:0;};
const outPads=pads.map(p=>{const q={id:p.id,phase:p.phase,group:GROUP[p.id],gateStage:p.gateStage,money:p.money,requires:p.requires,pos:PAD_POS[p.id]||p.pos,name:p.name,...TEXT[p.id]};const rep=p.id==='B03'?25:repOf(p);if(rep)q.rep=rep;return q;});
const out={version:3,pads:outPads,edges,lots,pier:plan.piers[0].poly,piers,land,surfaces,boundaries,walkable,bbox};
const text='// Generated by tools/masterplan/compile-port.mjs --phase='+MAX_PHASE+'; no network assets.\nwindow.MasterplanPortDataV161='+JSON.stringify(out)+';\n';
const target=new URL('../../assets/masterplan-port-data-v161.js',import.meta.url);
if(process.argv.includes('--check')){   // tests: the committed data must equal a fresh compile
  const same=fs.existsSync(target)&&fs.readFileSync(target,'utf8')===text;
  console.log(same?'data is up to date':'DATA IS STALE: run node tools/masterplan/compile-port.mjs');
  process.exit(same?0:1);
}
fs.writeFileSync(target,text);
console.log('Compiled '+padIds.join('/')+': '+lots.length+' lots, '+edges.length+' edges, cells '+padIds.map(i=>i+':'+(surfaces[i]?surfaces[i].walk.length+'+'+surfaces[i].asphalt.length:0)).join(' '));
