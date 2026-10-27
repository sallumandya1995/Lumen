import type {Service,Store} from './types';

export async function governanceFetch(path:string,body?:unknown){
 const response=await fetch('/api/governance/'+path,{method:body===undefined?'GET':'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
 const data=await response.json().catch(()=>null) as any;
 if(!response.ok||!data)throw Error(data?.error||`Governance request failed (${response.status}). Please retry.`);
 return data;
}

const CHANNEL='lumen-workspace-changed';
type Snapshot={store:Store;revision:number};
export function createHostedService():Service{
 const listeners=new Set<()=>void>();
 let initialized:Promise<void>|null=null,inFlight:Promise<Snapshot>|null=null,ticking=false,generation=0;
 let latest:Snapshot|null=null,minimumRevision=0,stopWatching:(()=>void)|null=null,channel:BroadcastChannel|null=null;
 const publish=()=>listeners.forEach(fn=>fn());
 function invalidate(){generation++;inFlight=null;publish()}
 function notifyOtherTabs(){
  // Send only an invalidation signal. Each tab fetches its own authenticated workspace.
  try{channel?.postMessage('changed')}catch{/* Storage fallback below. */}
  if(typeof window!=='undefined')try{localStorage.setItem(CHANNEL,crypto.randomUUID())}catch{/* Polling remains available. */}
 }
 function watch(){
  if(typeof window==='undefined'||stopWatching)return;
  const refresh=()=>{if(document.visibilityState!=='hidden'&&!inFlight)invalidate()};
  const storage=(event:StorageEvent)=>{if(event.key===CHANNEL&&!channel)invalidate()};
  if(typeof BroadcastChannel!=='undefined')try{channel=new BroadcastChannel(CHANNEL);channel.onmessage=()=>invalidate()}catch{/* Storage events and polling cover restricted browsers. */}
  window.addEventListener('storage',storage);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  // Configuration synchronization continues even when the simulated activity feed is paused.
  const timer=window.setInterval(refresh,15000);
  stopWatching=()=>{window.clearInterval(timer);window.removeEventListener('storage',storage);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);channel?.close();channel=null;stopWatching=null};
 }
 async function initialize(){
  if(!initialized)initialized=(async()=>{
   const data=await governanceFetch('workspace');
   if(data.fresh&&typeof window!=='undefined')try{const legacy=localStorage.getItem('azure-governance-v1');if(legacy){const snapshot=JSON.parse(legacy);if(snapshot?.version===1)await governanceFetch('workspace',{action:'migrate',snapshot})}}catch{console.warn('Previous browser records were not imported. They remain in browser storage.')}
  })().catch(e=>{initialized=null;throw e});
  return initialized;
 }
 async function load():Promise<Store>{
  await initialize();
  for(let attempt=0;attempt<8;attempt++){
   const observed=generation;
   if(!inFlight){
    const task=governanceFetch('workspace').then(data=>{
     if(!Number.isSafeInteger(data.revision)||!data.store)throw Error('The workspace response was incomplete. Please refresh.');
     return {store:data.store,revision:data.revision} as Snapshot;
    });
    inFlight=task;
    // An older read must never clear a newer read started after a save.
    task.then(()=>{if(inFlight===task)inFlight=null},()=>{if(inFlight===task)inFlight=null});
   }
   let result:Snapshot;
   try{result=await inFlight}catch(error){if(observed!==generation)continue;throw error}
   if(observed!==generation)continue;
   if(result.revision<minimumRevision)continue;
   if(!latest||result.revision>=latest.revision)latest=result;
   return structuredClone(latest.store);
  }
  throw Error('The workspace changed while refreshing. Your saved changes are safe; retry loading.');
 }
 async function mutate(action:string,args:any[]){
  await initialize();const result=await governanceFetch('workspace',{action,args});
  if(Number.isSafeInteger(result.revision))minimumRevision=Math.max(minimumRevision,result.revision);
  invalidate();if(action!=='tick')notifyOtherTabs();
 }
 return {mode:'api',load,subscribe(fn){listeners.add(fn);watch();return()=>{listeners.delete(fn);if(!listeners.size)stopWatching?.()}},
  tick(){if(ticking)return;ticking=true;mutate('tick',[]).catch(()=>publish()).finally(()=>{ticking=false})},
  decide:(...args)=>mutate('decide',args),assign:(...args)=>mutate('assign',args),resolve:(...args)=>mutate('resolve',args),
  testConnector:async(...args)=>{await initialize();return (await governanceFetch('workspace',{action:'testConnector',args})).result},
  saveConnector:(...args)=>mutate('saveConnector',args),setAgentStatus:(...args)=>mutate('setAgentStatus',args),setAvailability:(...args)=>mutate('setAvailability',args),saveAgentConfiguration:(...args)=>mutate('saveAgentConfiguration',args),saveGlobalPolicies:(...args)=>mutate('saveGlobalPolicies',args),
  async recordExecution(result){await initialize();const data=await governanceFetch('workspace?runId='+encodeURIComponent(result.id));if(!data.store.runs.some((r:any)=>r.id===result.id&&r.source==='live'))throw Error('The server has not confirmed this run yet. Retry to refresh its record.');minimumRevision=Math.max(minimumRevision,data.revision||0);invalidate();notifyOtherTabs()},
  async reset(){throw Error('Server evidence cannot be reset from the browser.')}
 };
}
