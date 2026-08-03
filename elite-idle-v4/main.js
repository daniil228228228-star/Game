import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const canvas=document.getElementById('game');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.08;

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x8ebfd4);
scene.fog=new THREE.FogExp2(0x9fbec8,.018);
const camera=new THREE.PerspectiveCamera(48,innerWidth/innerHeight,.1,180);
camera.position.set(12,12,17);

scene.add(new THREE.HemisphereLight(0xdff4ff,0x4c3a2b,1.8));
const sun=new THREE.DirectionalLight(0xffdfae,4.4);sun.position.set(-14,22,-9);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-25;sun.shadow.camera.right=25;sun.shadow.camera.top=25;sun.shadow.camera.bottom=-25;scene.add(sun);

const mat=(color,rough=.85,metal=0)=>new THREE.MeshStandardMaterial({color,roughness:rough,metalness:metal});
const dirt=mat(0x79513a,1), concrete=mat(0x9c9d98,.92), brick=mat(0xa44728,.92), wood=mat(0x8a582d,.88), dark=mat(0x20262b,.72,.1), orange=mat(0xe48a0b,.65,.05), glass=mat(0x2c7794,.2,.1);
const world=new THREE.Group();scene.add(world);
function box(name,x,y,z,w,h,d,m,cast=true){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.name=name;o.position.set(x,y,z);o.castShadow=cast;o.receiveShadow=true;world.add(o);return o}
function cyl(name,x,y,z,r,h,m){const o=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,20),m);o.name=name;o.position.set(x,y,z);o.castShadow=o.receiveShadow=true;world.add(o);return o}

const ground=new THREE.Mesh(new THREE.PlaneGeometry(90,90),mat(0x4e6d3e,1));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
const site=new THREE.Mesh(new THREE.PlaneGeometry(35,28),dirt);site.rotation.x=-Math.PI/2;site.position.y=.012;site.receiveShadow=true;scene.add(site);
for(let i=-18;i<=18;i+=3) box('road',i,.06,14,2.4,.12,3,dark,false);
for(let i=-17;i<=17;i+=2) box('fence',i,1.1,-13.5,1.8,2.2,.08,mat(0x535b5f,.9),false);
for(let p=0;p<5;p++){const px=-11+(p%3)*2.4,pz=-5+Math.floor(p/3)*2.8;box('pallet',px,.12,pz,1.8,.22,1.25,wood);for(let i=0;i<18;i++)box('load',px+(i%6)*.25-.62,.35+Math.floor(i/6)*.22,pz,.21,.18,.42,p===0?brick:p===1?concrete:p===2?wood:dark)}
box('container',-12,1.55,4.5,4.7,3.1,3.4,mat(0x274e40,.78));box('containerRoof',-12,3.17,4.5,5,.18,3.7,dark);

const build=[];function stageObj(o,a,b){o.visible=false;o.userData={a,b,base:o.scale.y};build.push(o);return o}
stageObj(box('pit',2,-.2,0,9,.4,7,mat(0x5a3d2c,1),false),0,.05);
for(let x=-1.5;x<=5.5;x+=1){stageObj(box('foundation',x,.35,-3,.82,.7,.55,concrete),.05,.14);stageObj(box('foundation',x,.35,3,.82,.7,.55,concrete),.05,.14)}
for(let z=-2;z<=2;z+=1){stageObj(box('foundation',-2,.35,z,.55,.7,.82,concrete),.05,.14);stageObj(box('foundation',6,.35,z,.55,.7,.82,concrete),.05,.14)}
stageObj(box('slab',2,.82,0,7.5,.35,5.5,concrete),.14,.23);
for(let r=0;r<8;r++){for(let x=-1.6;x<=5.6;x+=.72){stageObj(box('wall',x,1.12+r*.34,-2.75,.62,.3,.34,r%2?brick:mat(0xb85b33,.92)),.23,.44);stageObj(box('wall',x,1.12+r*.34,2.75,.62,.3,.34,r%2?brick:mat(0xb85b33,.92)),.23,.44)}}
stageObj(box('upperSlab',2,3.85,0,7.5,.3,5.5,concrete),.44,.52);
for(let r=0;r<7;r++)for(let x=-1.6;x<=5.6;x+=.72)stageObj(box('upperWall',x,4.15+r*.34,-2.75,.62,.3,.34,mat(0xbd6037,.9)),.52,.69);
for(let i=0;i<14;i++){const x=-1.6+i*.55;const a=stageObj(box('rafter',x,6.75,-.9,.12,.14,4.3,wood),.69,.81);a.rotation.x=.55;const b=stageObj(box('rafter',x,6.75,.9,.12,.14,4.3,wood),.69,.81);b.rotation.x=-.55}
for(let i=0;i<14;i++){const x=-1.6+i*.55;const a=stageObj(box('roof',x,7.02,-.98,.5,.12,4.45,dark),.81,.95);a.rotation.x=.55;const b=stageObj(box('roof',x,7.02,.98,.5,.12,4.45,dark),.81,.95);b.rotation.x=-.55}

// detailed procedural truck
const truck=new THREE.Group();world.add(truck);truck.position.set(10,0,5);truck.rotation.y=-.55;
const addPart=(g,geo,m,x,y,z)=>{const o=new THREE.Mesh(geo,m);o.position.set(x,y,z);o.castShadow=o.receiveShadow=true;g.add(o);return o};
addPart(truck,new THREE.BoxGeometry(4.4,.7,1.9),dark,0,.75,0);addPart(truck,new THREE.BoxGeometry(1.45,1.8,1.7),orange,-1.5,1.7,0);addPart(truck,new THREE.BoxGeometry(2.2,1.35,1.75),concrete,1.05,1.45,0);addPart(truck,new THREE.BoxGeometry(.06,.75,1.4),glass,-2.24,1.95,0);
for(const x of[-1.45,1.25])for(const z of[-.98,.98]){const w=addPart(truck,new THREE.CylinderGeometry(.48,.48,.3,24),dark,x,.45,z);w.rotation.x=Math.PI/2}

// upgrade pads
const pads=[{x:-7,z:7,c:0x57ff6b,name:'СКЛАД',cost:3200,key:'cargo'},{x:-2.5,z:7,c:0x35bfff,name:'СКОРОСТЬ',cost:3400,key:'speed'},{x:2,z:7,c:0xffd129,name:'ДОХОД',cost:4800,key:'income'},{x:6.5,z:7,c:0xff8d24,name:'ДОСТАВКА',cost:1500,key:'delivery'}];
for(const p of pads){const ring=new THREE.Mesh(new THREE.TorusGeometry(1.25,.09,14,60),new THREE.MeshBasicMaterial({color:p.c}));ring.rotation.x=Math.PI/2;ring.position.set(p.x,.08,p.z);p.ring=ring;world.add(ring);const disc=new THREE.Mesh(new THREE.CircleGeometry(1.12,48),new THREE.MeshBasicMaterial({color:p.c,transparent:true,opacity:.12}));disc.rotation.x=-Math.PI/2;disc.position.set(p.x,.03,p.z);world.add(disc)}

// player
const player=new THREE.Group();world.add(player);const body=addPart(player,new THREE.CapsuleGeometry(.42,1.05,6,12),mat(0xf1efe8,.8),0,1.22,0);const head=addPart(player,new THREE.SphereGeometry(.29,20,16),mat(0xd3a078,.85),0,2.05,0);const legs=[];for(const x of[-.18,.18])legs.push(addPart(player,new THREE.BoxGeometry(.22,.85,.25),dark,x,.46,0));const arms=[];for(const x of[-.48,.48])arms.push(addPart(player,new THREE.BoxGeometry(.18,.85,.2),mat(0xf1efe8,.8),x,1.3,0));const cargo=addPart(player,new THREE.BoxGeometry(.9,.55,.7),brick,0,1.25,.55);player.position.set(-8,0,-1);

const state={money:12450,brick:1860,wood:1540,progress:0,speed:1,cargo:1,income:1,auto:true,run:false,dir:1};try{Object.assign(state,JSON.parse(localStorage.getItem('er_v4')||'{}'))}catch{}
const input={x:0,y:0,active:false,id:null};const from=new THREE.Vector3(-8,0,-1),to=new THREE.Vector3(-1,0,-1);let autoT=0,last=performance.now(),qualityHigh=true;
function toast(t){const e=document.getElementById('toast');e.textContent=t;e.classList.add('on');clearTimeout(toast.i);toast.i=setTimeout(()=>e.classList.remove('on'),1200)}
function updateBuild(){for(const o of build){const q=THREE.MathUtils.clamp((state.progress-o.userData.a)/(o.userData.b-o.userData.a),0,1);o.visible=q>0;o.scale.y=Math.max(.03,q)}}
function update(dt,t){let moving=false;if(state.auto){autoT+=dt*.16*state.speed*state.dir;if(autoT>=1){autoT=1;state.dir=-1;state.progress=Math.min(1,state.progress+.006*state.cargo);state.money+=8*state.cargo*state.income}if(autoT<=0){autoT=0;state.dir=1}player.position.lerpVectors(from,to,autoT);moving=true;cargo.visible=state.dir>0}else if(input.active){const mult=state.run?2:1;player.position.x+=input.x*dt*4*state.speed*mult;player.position.z+=input.y*dt*4*state.speed*mult;player.position.x=THREE.MathUtils.clamp(player.position.x,-14,14);player.position.z=THREE.MathUtils.clamp(player.position.z,-11,11);if(Math.abs(input.x)+Math.abs(input.y)>.1){player.rotation.y=Math.atan2(input.x,input.y);moving=true}cargo.visible=false}
const walk=moving?Math.sin(t*.012*state.speed*(state.run?1.8:1)):0;arms[0].rotation.x=walk*.8;arms[1].rotation.x=-walk*.8;legs[0].rotation.x=-walk*.65;legs[1].rotation.x=walk*.65;player.position.y=Math.abs(walk)*.04;
for(const p of pads){p.ring.scale.setScalar(1+Math.sin(t*.004)*.05);const d=Math.hypot(player.position.x-p.x,player.position.z-p.z);if(d<1.3&&!state.auto&&!p.lock){p.lock=true;if(state.money>=p.cost){state.money-=p.cost;if(p.key==='delivery')state.progress=Math.min(1,state.progress+.05);else state[p.key]+=p.key==='speed'?.2:1;toast(p.name+' улучшено')}else toast('Не хватает денег')}if(d>1.6)p.lock=false}
updateBuild();truck.position.x=10+Math.sin(t*.00025)*1.2;camera.position.lerp(new THREE.Vector3(player.position.x+10,player.position.y+10,player.position.z+13),Math.min(1,dt*3.5));camera.lookAt(player.position.x,1.7,player.position.z);
}

const loader=new GLTFLoader();const root='https://raw.githubusercontent.com/KenneyNL/Starter-Kit-City-Builder/4535092b740b378b700efd9df9e27a631815b84a/models/';
const assets=[['building-garage.glb',-12,0,-5,2.6],['building-small-a.glb',13,0,-7,2.8],['grass-trees.glb',-15,0,9,3.2],['grass-trees-tall.glb',13,0,10,3.2],['road-straight-lightposts.glb',0,0,14,3.5]];
let loaded=0;for(const [file,x,y,z,s] of assets){loader.load(root+file,g=>{g.scene.position.set(x,y,z);g.scene.scale.setScalar(s);g.scene.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true;if(o.material&&o.material.map)o.material.map.colorSpace=THREE.SRGBColorSpace}});scene.add(g.scene);if(++loaded===assets.length)document.getElementById('loading').remove()},undefined,()=>{if(++loaded===assets.length)document.getElementById('loading').remove()})}
setTimeout(()=>document.getElementById('loading')?.remove(),8000);

const joy=document.getElementById('joy'),knob=document.getElementById('knob');function setJoy(cx,cy){const r=joy.getBoundingClientRect(),dx=cx-(r.left+r.width/2),dy=cy-(r.top+r.height/2),max=34,l=Math.hypot(dx,dy)||1,k=Math.min(1,max/l);input.x=dx*k/max;input.y=dy*k/max;knob.style.transform=`translate(${dx*k}px,${dy*k}px)`}function endJoy(){input.active=false;input.id=null;input.x=input.y=0;knob.style.transform=''}joy.addEventListener('pointerdown',e=>{e.preventDefault();state.auto=false;auto.textContent='АВТО: ВЫКЛ';input.active=true;input.id=e.pointerId;joy.setPointerCapture(e.pointerId);setJoy(e.clientX,e.clientY)});joy.addEventListener('pointermove',e=>{if(input.active&&e.pointerId===input.id){e.preventDefault();setJoy(e.clientX,e.clientY)}});joy.addEventListener('pointerup',endJoy);joy.addEventListener('pointercancel',endJoy);
auto.onclick=()=>{state.auto=!state.auto;auto.textContent='АВТО: '+(state.auto?'ВКЛ':'ВЫКЛ')};run.onpointerdown=()=>state.run=true;run.onpointerup=run.onpointercancel=()=>state.run=false;quality.onclick=()=>{qualityHigh=!qualityHigh;renderer.setPixelRatio(Math.min(devicePixelRatio,qualityHigh?1.65:1));quality.textContent='КАЧЕСТВО: '+(qualityHigh?'ВЫСОКОЕ':'ЭКОНОМ');renderer.shadowMap.enabled=qualityHigh};
function ui(){money.textContent=Math.floor(state.money).toLocaleString('ru');brick.textContent=state.brick;wood.textContent=state.wood;const pc=Math.round(state.progress*100);pct.textContent=pc+'%';fill.style.width=pc+'%';const st=pc<5?'Расчистка':pc<14?'Фундамент':pc<23?'Плита':pc<44?'Стены 1 этажа':pc<52?'Перекрытие':pc<69?'Стены 2 этажа':pc<81?'Стропила':pc<95?'Кровля':'Отделка';stage.textContent=st}
function loop(t){const dt=Math.min(.04,(t-last)/1000);last=t;update(dt,t);ui();renderer.render(scene,camera);requestAnimationFrame(loop)}requestAnimationFrame(loop);setInterval(()=>localStorage.setItem('er_v4',JSON.stringify(state)),2000);addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});