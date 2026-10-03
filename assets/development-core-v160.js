/* Paid, activity-backed company programmes. No offline clock or resource grants. */
function createCompanyDevelopmentV160(raw){
 'use strict';
 const ids=['storage','production','crew'],unlocks=[2,4,7,10,14],seconds=[90,150,240,360,480],work=[8,14,22,34,48];
 const cash=[900,6000,32000,160000,650000],wood=[4,8,16,28,42],concrete=[0,2,6,12,20],metal=[0,1,3,7,12];
 const keys=['delivery','mining','checkpoints','roads'];let env=null,state;
 const integer=(n,max=Number.MAX_SAFE_INTEGER)=>typeof n==='number'&&Number.isFinite(n)?Math.min(max,Math.max(0,Math.floor(n))):0;
 const number=(n,max)=>typeof n==='number'&&Number.isFinite(n)?Math.min(max,Math.max(0,n)):0;
 const metrics=value=>Object.fromEntries(keys.map(k=>[k,integer(value?.[k])]));
 function restore(value){
   state={version:1,levels:Object.fromEntries(ids.map(k=>[k,value?.version===1?integer(value.levels?.[k],5):0])),active:null};
   const a=value?.version===1?value.active:null;
   if(a&&ids.includes(a.id)&&Number.isInteger(a.level)&&a.level===state.levels[a.id]+1&&a.level<=5&&keys.every(k=>typeof a.last?.[k]==='number'&&Number.isFinite(a.last[k])&&a.last[k]>=0)){const i=a.level-1;state.active={id:a.id,level:a.level,elapsed:number(a.elapsed,seconds[i]),work:integer(a.work,work[i]),last:metrics(a.last)};}
 }
 function price(id){if(!ids.includes(id))return null;const i=state.levels[id];if(i>=5)return null;return {money:Math.round(cash[i]*(id==='storage'?1:id==='production'?1.2:1.1)),wood:wood[i],concrete:concrete[i],metal:metal[i]};}
 function writable(){return !!env&&env.writable();}
 function start(id){
   if(!writable()||!ids.includes(id)||state.active||env.occupied())return false;
   const level=state.levels[id]+1,cost=price(id);if(!cost||env.stage()<unlocks[level-1])return false;
   const last=metrics(env.metrics());if(!env.pay(cost))return false;
   state.active={id,level,elapsed:0,work:0,last};return true;
 }
 function tick(dt){
   if(!writable()||!state.active||env.paused()||!Number.isFinite(dt)||dt<=0)return false;
   const a=state.active,i=a.level-1,next=metrics(env.metrics());let added=0;
   for(const key of keys)added+=Math.max(0,next[key]-a.last[key]);
   a.last=next;a.work=Math.min(work[i],a.work+added);a.elapsed=Math.min(seconds[i],a.elapsed+Math.min(dt,.25));return true;
 }
 function ready(){const a=state.active;return !!a&&a.elapsed>=seconds[a.level-1]&&a.work>=work[a.level-1];}
 function commission(){if(!writable()||!ready()||env.occupied())return false;const a=state.active;state.levels[a.id]=a.level;state.active=null;return true;}
 function view(){return ids.map(id=>{const level=state.levels[id],a=state.active?.id===id?state.active:null,i=Math.min(4,level);return {id,level,cost:price(id),unlock:unlocks[i],duration:seconds[i],requiredWork:work[i],active:a?{elapsed:a.elapsed,work:a.work,ready:ready()}:null};});}
 restore(raw);
 return {attach(value){env=value;},restore,start,tick,commission,ready,price,view,total:()=>ids.reduce((n,id)=>n+state.levels[id],0),level:id=>state.levels[id]||0,snapshot:()=>JSON.parse(JSON.stringify(state)),reset:()=>restore(null)};
}
