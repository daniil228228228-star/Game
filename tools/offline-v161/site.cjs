// offline loop for the construction site rig (2026-10-10 (13)): assets/infra-plants-v161.js (kit) + assets/site-v161.js against stub globals, every phase drawn.
//   node tools/offline-v161/site.cjs [--stages house,shop,industrial,tower] [--phases 0,2,4,5] [--views iso] [--out DIR]
const path = require('path'), fs = require('fs');
const { ctx, run, load } = require('./load.cjs');
const { render, save } = require('./render.cjs');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const OUT = path.resolve(String(opt('out', path.join(__dirname, '..', '..', '..', 'off')))); fs.mkdirSync(OUT, { recursive: true });
run(`var lang='ru'; var scene=new THREE.Group(); var player={position:new THREE.Vector3(0,0,0)}; var constructionSites=[];
function makeLabelSprite(){const g=new THREE.Group();g.isSprite=true;return g}
const _M=(c,o)=>new THREE.MeshStandardMaterial(Object.assign({color:c},o||{}));
function createConcreteMaterial(c,o){return _M(c,o)} function createCorrugatedMaterial(c,o){return _M(c,o)} function createMetalMaterial(c,o){return _M(c,o)} function createRoofMaterial(c,o){return _M(c,o)} function createCurtainWallMaterial(c,o){return _M(c,o)}
function createGableRoof(width,depth,h,mat){const w=width/2,d=depth/2;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array([-w,0,d,w,0,d,0,h,d,-w,0,-d,w,0,-d,0,h,-d]),3));g.setIndex([0,1,2,3,5,4,0,2,5,0,5,3,2,1,4,2,4,5,0,3,4,0,4,1]);g.computeVertexNormals();return new THREE.Mesh(g,mat)}
`);
load('assets/infra-plants-v161.js'); load('assets/site-v161.js');
const STG = { house: { archetype: 'house', baseSize: 2.2, height: 2.4, color: 0x6fcf6f }, shop: { archetype: 'shop', baseSize: 2.6, height: 2.6, color: 0x5ab0ff }, industrial: { archetype: 'factory', baseSize: 3.3, height: 3.6, color: 0xb0b6bd }, tower: { archetype: 'tower', baseSize: 2.2, height: 8.8, color: 0x467aa2 } };
const kinds = String(opt('stages', 'house,industrial,tower')).split(','), phases = String(opt('phases', '0,1,2,3,4,5')).split(',').map(Number), views = String(opt('views', 'iso')).split(',');
const VIEW = { iso: { az: 0.55, el: 0.5 }, front: { az: 0, el: 0.15 }, top: { az: 0, el: 1.45 } };
const THREE = ctx.THREE; const T = [0.05, 0.2, 0.4, 0.6, 0.8, 0.95];
ctx.__st = STG;
for (const k of kinds) for (const ph of phases) {
  const g = run(`(function(){const s=SiteV161.build(new THREE.Vector3(0,0,0), __st.${k}, 30); s.group.userData.site=s; s.foundationVisual.visible=${ph} >= 1; s.frameVisual.visible=${ph}>=2&&${ph}<=4; s.wallVisual.visible=${ph}>=3&&${ph}<=4; s.roofVisual.visible=${ph}===4; s.finishVisual.visible=${ph}>=5; s.mixer.visible=${ph}===1; s.excavator.visible=${ph}===0; s.beamStack.visible=${ph}===2; s.rebarCage.visible=${ph}===1; s.scaffolding.visible=${ph}>=3&&${ph}<=5; s.craneParts.forEach(o=>o.visible=${ph}>=2&&${ph}<=4); s.unloadZone.visible=false; s.beacon.visible=false;
    const t=${T[ph]}; if(${ph}===1) s.foundationVisual.scale.y=Math.max(.08,Math.min(1,(t-.12)/.18)); return s.group})()`);
  g.updateMatrixWorld(true);
  let meshes = 0, tris = 0, minY = 1e9, maxY = -1e9; const bb = new THREE.Box3();
  g.traverse((o) => { let vis = true; for (let p = o; p; p = p.parent) if (p.visible === false) vis = false; if (o.isMesh && vis) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; const b = new THREE.Box3().setFromObject(o); bb.union(b); minY = Math.min(minY, b.min.y); maxY = Math.max(maxY, b.max.y); } });
  console.log(`${k} phase ${ph}: visible meshes ${meshes}, tris ${tris}, minY ${minY.toFixed(3)}, maxY ${maxY.toFixed(2)}, size ${bb.getSize(new THREE.Vector3()).toArray().map((v) => v.toFixed(2)).join('x')}`);
  for (const v of views) save(render(g, Object.assign({ W: 600, H: 600 }, VIEW[v])), path.join(OUT, `site-${k}-p${ph}-${v}.jpg`));
}
