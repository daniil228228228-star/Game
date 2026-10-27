// run the real browser probe (tools/lib/buildings-probe-v161.mjs installProbe) against offline geometry
const fs=require('fs');
const L=require('./load.cjs');const {ctx,run,load}=L;
const REPO=require('path').resolve(__dirname,'..','..');
let src=fs.readFileSync(REPO+'/tools/lib/buildings-probe-v161.mjs','utf8').replace('export function installProbe','function installProbe');
run(`
var PLAYER_RADIUS=0.4, playerVelocity=new THREE.Vector3(0,0,0), scene={children:[],traverse(){}}, ground={}, renderer={};
window.__TYCOON_V83_COLLISIONS__={registry:new Map()};
function circlePush(x,z,r,e){
  if(e.shape!=='obb'){let dx=x-e.pos.x,dz=z-e.pos.z,d2=dx*dx+dz*dz,min=r+e.radius;if(d2>=min*min)return null;if(d2<1e-10)return {nx:1,nz:0,push:min+.002};const d=Math.sqrt(d2);return {nx:dx/d,nz:dz/d,push:min-d+.002};}
  const yaw=Number(e.yaw)||0,sy=Math.sin(yaw),cy=Math.cos(yaw),dx=x-e.pos.x,dz=z-e.pos.z,lx=dx*cy-dz*sy,lz=dx*sy+dz*cy;
  const qx=Math.max(-e.hx,Math.min(e.hx,lx)),qz=Math.max(-e.hz,Math.min(e.hz,lz));let ox=lx-qx,oz=lz-qz,d2=ox*ox+oz*oz,lnx=0,lnz=0,push=0;
  if(d2>1e-10){const d=Math.sqrt(d2);if(d>=r)return null;lnx=ox/d;lnz=oz/d;push=r-d+.002;}else{const ex=e.hx-Math.abs(lx),ez=e.hz-Math.abs(lz);if(ex<ez){lnx=lx>=0?1:-1;push=ex+r+.002;}else{lnz=lz>=0?1:-1;push=ez+r+.002;}}
  return {nx:lnx*cy+lnz*sy,nz:-lnx*sy+lnz*cy,push};
}
function resolvePlayerCircleCollisions(x,z,entries){let hit=false;for(let it=0;it<4;it++){let ch=false;for(const e of entries){const p=circlePush(x,z,PLAYER_RADIUS,e);if(!p)continue;x+=p.nx*p.push;z+=p.nz*p.push;ch=true;hit=true;}if(!ch)break;}return {x,z,hit};}
`);
run(src);
run('installProbe()');
module.exports={...L,measure:(expr,entriesExpr,opts)=>run(`(function(){const root=${expr};root.updateMatrixWorld(true);const en=${entriesExpr};return __BLD_PROBE__.measure(root,en,${JSON.stringify(opts||{})})})()`)};
