/* Bounded manual work sessions. Existing work durations/cooldowns award every unit. */
function createWorkSessionV158(env){
 let size=1,session=null;
 const runtime={started:0,units:0,cancelled:0};
 function stop(){if(session)runtime.cancelled++;session=null;}
 function choose(value){if(![1,3,5].includes(value)||session||env.work())return false;size=value;return true;}
 function handle(ctx,next){
   const before=env.work(),result=next();
   if(ctx?.type==='mine'&&result&&!before&&env.work()&&!session){session={cargo:ctx.cargo,total:size,done:0,origin:env.position().clone(),def:ctx.def};runtime.started++;}
   return result;
 }
 function finished(work,ok){
   if(!session||session.cargo!==work.cargo)return;
   if(!ok){stop();return;}session.done++;runtime.units++;
   if(session.done>=session.total)session=null;
 }
 function tick(){
   if(!session)return;
   const p=env.position();
   if(env.blocked()||Math.hypot(p.x-session.origin.x,p.z-session.origin.z)>.48||!session.def.visible()){stop();return;}
   if(env.work())return;
   const ctx=env.context();
   if(ctx?.type!=='mine'||ctx.cargo!==session.cargo||env.full(session.cargo)){stop();return;}
   if(env.now()<env.cooldown(session.cargo))return;
   env.start(ctx);if(!env.work())stop();
 }
 return {choose,stop,handle,finished,tick,runtime,get size(){return size;},get active(){return session?{cargo:session.cargo,total:session.total,done:session.done,waiting:!env.work(),wait:Math.max(0,env.cooldown(session.cargo)-env.now())}:null;},reset(){stop();size=1;}};
}
