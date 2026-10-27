// Offline stand-in for the game page (2026-10-05 (8)): loads vendor three.min.js + any assets/*.js layer into a node `vm` with the few globals the builders read (STAGES, createSurfaceMaterialV152,
// VISUAL_MOBILE ...), so building geometry can be designed, measured and drawn WITHOUT launching the browser (the launch budget is small, software WebGL is slow).
//   const { load, run, ctx } = require('./load.cjs'); load('assets/buildings-v161.js'); load('assets/shop-v161.js'); run('buildShopV161(STAGES[2], 2.6, 2.6, 3)');
// render.cjs draws a Group with a flat-shaded z-buffer rasteriser to JPEG (no textures, vertex colours + material colours); probe.cjs runs the real tools/lib/buildings-probe-v161.mjs measurement
// (footprint raster, collider cover, 8-direction walk-in sweep) against such geometry with stub colliders.
// offline three stand-in loader
const fs=require('fs'),path=require('path'),vm=require('vm');
const REPO=path.resolve(__dirname,'..','..');
const win={};
const ctx={console,Math,Float32Array,Uint32Array,Uint16Array,Map,Set,WeakMap,Array,Object,Number,String,JSON,Date,performance:{now:()=>0},document:{createElement:()=>({getContext:()=>null,style:{}}),},navigator:{userAgent:'node'}};
ctx.window=ctx;ctx.self=ctx;ctx.globalThis=ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(REPO+'/vendor/three_r128/three.min.js','utf8'),ctx);
ctx.THREE=ctx.THREE||win.THREE;
vm.runInContext(`
var VISUAL_MOBILE=false;
var STAGES=[{archetype:'house',color:0x6fcf6f,baseSize:2.2},{archetype:'house',baseSize:2.5},{archetype:'shop',baseSize:2.6,height:2.6,color:0x5ab0ff}];
function stageAccessAxisV92(i){return new THREE.Vector3(1,0,0)}
function stagePosition(i){return new THREE.Vector3(10,0,10)}
function createSurfaceMaterialV152(f,c,o){const m=new THREE.MeshStandardMaterial(Object.assign({color:c},o||{}));m.userData={};return m}
`,ctx);
module.exports={ctx,load:(f)=>vm.runInContext(fs.readFileSync(REPO+'/'+f,'utf8'),ctx,{filename:f}),run:(s)=>vm.runInContext(s,ctx)};
