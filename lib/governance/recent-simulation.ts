import {makeRun,reviewScenario} from './mock-data';
import {END_TO_END_DEMO_ID} from './end-to-end-demo';
import type {Agent,Store} from './types';

export const SIMULATION_WINDOW_MS=2*60*60*1000;
export const SIMULATION_BUCKET_MS=10*60*1000;

/** The dedicated Studio example only contains explicitly requested executions. */
export function simulationAgents(store:Store){
 return store.agents.filter(agent=>agent.id!==END_TO_END_DEMO_ID&&agent.status!=='Paused'&&agent.tools.length>0&&store.definitions.some(definition=>definition.agentId===agent.id));
}

function nextSequence(store:Store){
 const used=new Set([...store.runs,...store.toolCalls,...store.approvals,...store.policies,...store.audit,...store.assignments].map(record=>record.id));
 let sequence=Math.max(0,Math.floor(store.sequence));
 for(const run of store.runs){const match=/^RUN-(\d+)$/.exec(run.id);if(match&&Number.isSafeInteger(Number(match[1])))sequence=Math.max(sequence,Number(match[1]))}
 do{
  if(!Number.isSafeInteger(sequence+1))return null;
  sequence++;
 }while([`RUN-${String(sequence).padStart(5,'0')}`,`TC-${sequence}`,`APR-L${sequence}`,`POL-L${sequence}`,`AU-SIM-RUN-${sequence}`,`AU-SIM-REVIEW-${sequence}`,`AU-SIM-EXPIRE-${sequence}`].some(id=>used.has(id)));
 store.sequence=sequence;
 return sequence;
}

/** Materialize matching simulated run/tool/review records, never external actions. */
export function appendSimulationRun(store:Store,agent:Agent,at:string,now=Date.now(),historical=false){
 const definition=store.definitions.find(item=>item.agentId===agent.id);
 if(!definition||agent.id===END_TO_END_DEMO_ID||agent.status==='Paused'||!agent.tools.length)return null;
 const sequence=nextSequence(store);if(sequence===null)return null;
 const {run,calls}=makeRun(agent,sequence,at,definition);
 // A historic background sample is a completed observation, not an ongoing run.
 if(historical&&run.status==='Running'){
  run.status='Success';const final=run.steps[run.steps.length-1];final.outcome='Success';final.summary='Saved the result with references to the permitted source records.';
 }
 store.runs.unshift(run);store.toolCalls.unshift(...calls);
 if(Date.parse(at)>Date.parse(agent.lastActive))agent.lastActive=at;
 const scenario=reviewScenario(agent,definition,run.status);
 if(run.status==='Awaiting approval'){
  const id=`APR-L${sequence}`,expiresAt=new Date(Date.parse(at)+60*60*1000).toISOString(),expired=Date.parse(expiresAt)<=now;
  store.approvals.unshift({id,agentId:agent.id,runId:run.id,action:scenario.action,risk:'High',context:scenario.context,status:expired?'Expired':'Pending',at,expiresAt,assigneeId:null,note:''});
  store.audit.unshift({id:`AU-SIM-REVIEW-${sequence}`,actorId:'system',action:'Approval requested',target:id,at,outcome:'Pending · unassigned',agentId:agent.id});
  if(expired)store.audit.unshift({id:`AU-SIM-EXPIRE-${sequence}`,actorId:'system',action:'Approval expired',target:id,at:expiresAt,outcome:'No action executed',agentId:agent.id});
 }
 if(run.status==='Blocked'){
  const id=`POL-L${sequence}`;
  store.policies.unshift({id,agentId:agent.id,runId:run.id,rule:scenario.rule,severity:definition.guardrails.find(rule=>rule.enabled&&rule.name===scenario.rule)?.severity||'High',action:scenario.action,at,status:'Open',disposition:'Blocked',context:scenario.context,notes:'Verify the permitted scope and route for human review.',assigneeId:null});
  store.audit.unshift({id:`AU-SIM-REVIEW-${sequence}`,actorId:'system',action:'Policy triggered',target:id,at,outcome:'Blocked',agentId:agent.id});
 }
 store.audit.unshift({id:`AU-SIM-RUN-${sequence}`,actorId:'system',action:'Run observed',target:run.id,at,outcome:run.status,agentId:agent.id});
 return run;
}

/** Restore recent chart coverage by appending observations, not by moving history. */
export function warmRecentSimulation(store:Store,now=Date.now()){
 const agents=simulationAgents(store);if(!agents.length)return 0;
 const cutoff=now-SIMULATION_WINDOW_MS,currentBucket=Math.floor(now/SIMULATION_BUCKET_MS);
 const recent=store.runs.filter(run=>run.source!=='live'&&Date.parse(run.at)>=cutoff&&Date.parse(run.at)<=now);
 const coverage=new Map<string,Set<number>>();
 for(const run of recent){const buckets=coverage.get(run.agentId)||new Set<number>();buckets.add(Math.floor(Date.parse(run.at)/SIMULATION_BUCKET_MS));coverage.set(run.agentId,buckets)}
 // Fresh seed data and active sessions already have useful history. Avoid
 // manufacturing a new batch for every service notification or four-second tick.
 if(agents.every(agent=>(coverage.get(agent.id)?.size||0)>=8))return 0;
 let added=0;
 for(const [agentIndex,agent] of agents.entries()){
  const buckets=coverage.get(agent.id)||new Set<number>();
  for(let offset=11;offset>=0;offset--){
   const bucket=currentBucket-offset;if(buckets.has(bucket))continue;
   const start=Math.max(cutoff,bucket*SIMULATION_BUCKET_MS),end=Math.min(now,(bucket+1)*SIMULATION_BUCKET_MS-1);
   if(end<start)continue;
   const count=1+((bucket+agentIndex)%3===0?1:0);
   for(let index=0;index<count;index++){
    const at=new Date(Math.floor(start+(end-start)*(index+1)/(count+1))).toISOString();
    if(appendSimulationRun(store,agent,at,now,true))added++;
   }
  }
 }
 if(added){store.runs.sort((a,b)=>b.at.localeCompare(a.at));store.toolCalls.sort((a,b)=>b.at.localeCompare(a.at));store.audit.sort((a,b)=>b.at.localeCompare(a.at))}
 return added;
}

/** Retain dense recent activity plus sparse two-hour chart history and evidence. */
export function retainSimulationHistory(store:Store,now=Date.now()){
 const linked=new Set([...store.approvals,...store.policies].map(review=>review.runId));
 const recent=new Set([...store.runs].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,180).map(run=>run.id));
 const buckets=new Set<string>(),representatives=new Set<string>();
 for(const run of [...store.runs].sort((a,b)=>b.at.localeCompare(a.at))){
  const at=Date.parse(run.at);if(run.source==='live'||at<now-SIMULATION_WINDOW_MS||at>now)continue;
  const key=`${run.agentId}:${Math.floor(at/SIMULATION_BUCKET_MS)}`;
  if(!buckets.has(key)){buckets.add(key);representatives.add(run.id)}
 }
 store.runs=store.runs.filter(run=>run.source==='live'||linked.has(run.id)||recent.has(run.id)||representatives.has(run.id));
 const ids=new Set(store.runs.map(run=>run.id));store.toolCalls=store.toolCalls.filter(call=>ids.has(call.runId));
 store.audit=store.audit.slice(0,300);
}
