// tiny software rasteriser (flat shading, z-buffer) to iterate on geometry without launching the game
const {ctx,run}=require('./load.cjs');
const fs=require('fs');
const THREE=ctx.THREE;
function render(root,{W=585,H=996,az=0.6,el=0.5,dist=null,target=null,fov=34,bg=[0.55,0.72,0.45],ground=true,cull=true,fit=1.0}={}){
  root.updateMatrixWorld(true);
  const bb=new THREE.Box3();root.traverse(o=>{if(o.isMesh)bb.expandByObject(o)});
  const cen=bb.getCenter(new THREE.Vector3()),sz=bb.getSize(new THREE.Vector3());
  if(!target)target=[cen.x,bb.min.y+sz.y*0.45,cen.z];
  if(dist===null){const r=Math.hypot(sz.x,sz.y*0.8,sz.z)*0.5;const tv=Math.tan(fov*Math.PI/360),th=tv*W/H;dist=fit*1.08*r/Math.min(tv,th);}
  const cam=new THREE.PerspectiveCamera(fov,W/H,0.1,200);
  const t=new THREE.Vector3(...target);
  cam.position.set(t.x+Math.sin(az)*Math.cos(el)*dist,t.y+Math.sin(el)*dist,t.z+Math.cos(az)*Math.cos(el)*dist);
  cam.lookAt(t);cam.updateMatrixWorld(true);cam.updateProjectionMatrix();
  const VP=new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix,cam.matrixWorldInverse);
  const img=new Float32Array(W*H*3),zb=new Float32Array(W*H).fill(1e9);
  for(let i=0;i<W*H;i++){img[i*3]=bg[0]*0.5+0.3;img[i*3+1]=bg[1]*0.5+0.3;img[i*3+2]=bg[2]*0.3+0.55;}
  const L=new THREE.Vector3(0.5,0.9,0.6).normalize();
  const tris=[];
  const A=new THREE.Vector3(),B=new THREE.Vector3(),C=new THREE.Vector3(),n=new THREE.Vector3(),e1=new THREE.Vector3(),e2=new THREE.Vector3();
  function addMesh(m){
    const g=m.geometry,P=g.attributes.position,col=g.attributes.color,idx=g.index;const mat=m.material;
    const base=new THREE.Color(mat.color||0xffffff);
    const emis=mat.emissive?new THREE.Color(mat.emissive).multiplyScalar(mat.emissiveIntensity||0):new THREE.Color(0);
    const alpha=mat.transparent?(mat.opacity??1):1;
    const count=idx?idx.count:P.count;
    for(let k=0;k+2<count;k+=3){
      const i0=idx?idx.getX(k):k,i1=idx?idx.getX(k+1):k+1,i2=idx?idx.getX(k+2):k+2;
      A.fromBufferAttribute(P,i0).applyMatrix4(m.matrixWorld);B.fromBufferAttribute(P,i1).applyMatrix4(m.matrixWorld);C.fromBufferAttribute(P,i2).applyMatrix4(m.matrixWorld);
      e1.subVectors(B,A);e2.subVectors(C,A);n.crossVectors(e1,e2).normalize();
      let c=[base.r,base.g,base.b];
      if(col&&mat.vertexColors){c=[c[0]*(col.getX(i0)),c[1]*(col.getY(i0)),c[2]*(col.getZ(i0))];}
      tris.push({a:A.clone(),b:B.clone(),c:C.clone(),n:n.clone(),col:c,emis:[emis.r,emis.g,emis.b],alpha,two:mat.side===THREE.DoubleSide});
    }
  }
  root.traverse(o=>{if(o.isMesh&&o.visible!==false)addMesh(o);});
  if(ground){ // big ground quad
    const y=-0.0005,s=60;const gc=[0.18,0.42,0.14];
    const q=[[-s,y,-s],[s,y,-s],[s,y,s],[-s,y,s]].map(p=>new THREE.Vector3(...p));
    tris.push({a:q[0],b:q[2],c:q[1],n:new THREE.Vector3(0,1,0),col:gc,emis:[0,0,0],alpha:1,two:true});tris.push({a:q[0],b:q[3],c:q[2],n:new THREE.Vector3(0,1,0),col:gc,emis:[0,0,0],alpha:1,two:true});
  }
  const camPos=cam.position;
  function draw(pass){
    for(const t of tris){
      if((t.alpha<1)!==(pass===1))continue;
      // cull
      const toCam=new THREE.Vector3().subVectors(camPos,t.a);
      let facing=t.n.dot(toCam);
      if(facing<0&&!t.two&&cull)continue;
      const nrm=facing<0?t.n.clone().negate():t.n;
      const P=[t.a,t.b,t.c].map(v=>{const q=new THREE.Vector4(v.x,v.y,v.z,1).applyMatrix4(VP);return q;});
      if(P.some(q=>q.w<=0.05))continue;
      const S=P.map(q=>({x:(q.x/q.w*0.5+0.5)*W,y:(1-(q.y/q.w*0.5+0.5))*H,z:q.w}));
      const sh=0.42+0.58*Math.max(0,nrm.dot(L));
      const col=[0,1,2].map(i=>Math.min(1,Math.pow(Math.min(1,t.col[i]*sh*1.12+t.emis[i]),1/2.2)));
      const minx=Math.max(0,Math.floor(Math.min(S[0].x,S[1].x,S[2].x))),maxx=Math.min(W-1,Math.ceil(Math.max(S[0].x,S[1].x,S[2].x)));
      const miny=Math.max(0,Math.floor(Math.min(S[0].y,S[1].y,S[2].y))),maxy=Math.min(H-1,Math.ceil(Math.max(S[0].y,S[1].y,S[2].y)));
      const d=(S[1].y-S[2].y)*(S[0].x-S[2].x)+(S[2].x-S[1].x)*(S[0].y-S[2].y);
      if(Math.abs(d)<1e-9)continue;
      for(let y=miny;y<=maxy;y++)for(let x=minx;x<=maxx;x++){
        const px=x+0.5,py=y+0.5;
        const l1=((S[1].y-S[2].y)*(px-S[2].x)+(S[2].x-S[1].x)*(py-S[2].y))/d;
        const l2=((S[2].y-S[0].y)*(px-S[2].x)+(S[0].x-S[2].x)*(py-S[2].y))/d;
        const l3=1-l1-l2;
        if(l1<-1e-4||l2<-1e-4||l3<-1e-4)continue;
        const z=l1*S[0].z+l2*S[1].z+l3*S[2].z;
        const k=y*W+x;
        if(z>=zb[k])continue;
        if(pass===0){zb[k]=z;img[k*3]=col[0];img[k*3+1]=col[1];img[k*3+2]=col[2];}
        else{const a=t.alpha;img[k*3]=img[k*3]*(1-a)+col[0]*a;img[k*3+1]=img[k*3+1]*(1-a)+col[1]*a;img[k*3+2]=img[k*3+2]*(1-a)+col[2]*a;}
      }
    }
  }
  draw(0);draw(1);
  const buf=Buffer.alloc(W*H*3);for(let i=0;i<W*H*3;i++)buf[i]=Math.round(Math.max(0,Math.min(1,img[i]))*255);
  return {W,H,buf};
}
async function save(r,file){
  const {encodeJpeg}=await import('../lib/image-codec-v161.mjs');
  fs.writeFileSync(file,Buffer.from(encodeJpeg(r.W,r.H,3,r.buf,88)));
}
module.exports={render,save,THREE};
