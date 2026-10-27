import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import ts from 'typescript';

const dir=new URL('../.sites-runtime/recent-simulation-tests/',import.meta.url);
await mkdir(dir,{recursive:true});
for(const name of ['types','policy-config','end-to-end-demo','definitions','mock-data','recent-simulation','service']){
 const source=await readFile(new URL(`../lib/governance/${name==='service'?'store-core':name}.ts`,import.meta.url),'utf8');
 const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
 await writeFile(new URL(name+'.mjs',dir),outputText.replace("from '../models.mjs'","from './models.mjs'").replace(/from '\.\/(mock-data|types|policy-config|end-to-end-demo|definitions|recent-simulation)'/g,"from './$1.mjs'"));
}
await writeFile(new URL('models.mjs',dir),await readFile(new URL('../lib/models.mjs',import.meta.url)));
const {createSeed}=await import(new URL('mock-data.mjs',dir));
const {warmRecentSimulation,retainSimulationHistory,appendSimulationRun,simulationAgents,SIMULATION_WINDOW_MS,SIMULATION_BUCKET_MS}=await import(new URL('recent-simulation.mjs',dir));
const {createMockService,createFastApiService,isUsableSnapshot,scopeStore}=await import(new URL('service.mjs',dir));
const {END_TO_END_DEMO_ID}=await import(new URL('end-to-end-demo.mjs',dir));
const now=Date.parse('2026-10-22T12:07:45.000Z');

// A fresh workspace already has chart history and must not change on read.
const fresh=createSeed(now),freshBefore=structuredClone(fresh);
assert.equal(warmRecentSimulation(fresh,now),0);assert.deepEqual(fresh,freshBefore);

// Stale local history gets new linked observations while all captured records,
// decisions, configuration, and live receipts keep their original identity/time.
const stale=createSeed(now-86400000);
stale.definitions[0].prompt.system='Preserve the owner’s saved instructions.';stale.definitions[0].revision=9;
stale.globalPolicies={...stale.globalPolicies,revision:7,rules:[]};
for(const approval of stale.approvals)if(approval.status==='Pending')approval.status='Expired';
stale.approvals[0].status='Approved';stale.approvals[0].note='Owner verified the approved recipient.';
const live={...structuredClone(stale.runs[0]),id:'RUN-00101',source:'live',status:'Success',output:'Recorded live output remains unchanged.'};
stale.runs.push(live);stale.sequence=1;
const original=structuredClone(stale),oldIds=new Set(stale.runs.map(run=>run.id));
const count=warmRecentSimulation(stale,now);
assert(count>=60&&count<=90);assert(stale.sequence>101);assert(isUsableSnapshot(stale));
const added=stale.runs.filter(run=>!oldIds.has(run.id));
assert.equal(added.length,count);assert(added.every(run=>run.source!=='live'&&Date.parse(run.at)>=now-SIMULATION_WINDOW_MS&&Date.parse(run.at)<=now));
assert(added.every(run=>run.agentId!==END_TO_END_DEMO_ID&&run.agentId!=='a-risk'));
assert(added.every(run=>run.status!=='Running'));
assert(new Set(added.map(run=>run.status)).size>=3);
for(const key of ['definitions','globalPolicies','users','connectors','assignments'])assert.deepEqual(stale[key],original[key]);
for(const key of ['runs','toolCalls','approvals','policies','audit'])for(const record of original[key])assert.deepEqual(stale[key].find(item=>item.id===record.id),record);
for(const key of ['runs','toolCalls','approvals','policies','audit'])assert.equal(new Set(stale[key].map(item=>item.id)).size,stale[key].length);
for(const run of added){
 assert(stale.toolCalls.some(call=>call.runId===run.id&&call.agentId===run.agentId&&call.at===run.at));
 if(run.status==='Blocked')assert(stale.policies.some(policy=>policy.runId===run.id&&policy.disposition==='Blocked'));
 if(run.status==='Awaiting approval'){
  const approval=stale.approvals.find(item=>item.runId===run.id);assert(approval);
  assert.equal(approval.status,Date.parse(approval.expiresAt)<=now?'Expired':'Pending');
 }
}
for(const user of stale.users){
 const visible=scopeStore(stale,user),current=visible.runs.filter(run=>Date.parse(run.at)>=now-SIMULATION_WINDOW_MS);
 assert(current.length>0,`${user.role} should open with recent scoped activity`);
 assert(current.every(run=>user.role==='Owner'||user.agentIds.includes(run.agentId)));
}
const warmed=structuredClone(stale);assert.equal(warmRecentSimulation(stale,now+1000),0);assert.deepEqual(stale,warmed);

// Dense four-second updates retain sparse older chart samples, all live runs,
// and linked reviews, while unrelated synthetic history remains bounded.
const protectedLive=structuredClone(live),agents=simulationAgents(stale);
for(let index=0;index<400;index++)appendSimulationRun(stale,agents[index%agents.length],new Date(now-1000+index).toISOString(),now);
retainSimulationHistory(stale,now);
assert.deepEqual(stale.runs.find(run=>run.id===live.id),protectedLive);assert(isUsableSnapshot(stale));
for(const review of [...stale.approvals,...stale.policies])assert(stale.runs.some(run=>run.id===review.runId));
const linked=new Set([...stale.approvals,...stale.policies].map(review=>review.runId));
assert(stale.runs.filter(run=>run.source!=='live'&&!linked.has(run.id)).length<=180+stale.agents.length*13);
for(const agent of agents){
 const coverage=new Set(stale.runs.filter(run=>run.source!=='live'&&run.agentId===agent.id&&Date.parse(run.at)>=now-SIMULATION_WINDOW_MS&&Date.parse(run.at)<=now).map(run=>Math.floor(Date.parse(run.at)/SIMULATION_BUCKET_MS)));
 assert(coverage.size>=11,'Older chart history must survive the dense current feed');
}

const realNow=Date.now,realWindow=globalThis.window,realStorage=globalThis.localStorage,realFetch=globalThis.fetch;
Date.now=()=>now;
let stored=JSON.stringify(original);
globalThis.window={};globalThis.localStorage={getItem:()=>stored,setItem:(_key,value)=>{stored=value}};
try{
 const service=createMockService(),opened=await service.load();
 assert(opened.runs.some(run=>Date.parse(run.at)>=now-SIMULATION_WINDOW_MS));
 assert.deepEqual(opened.definitions,original.definitions);assert.deepEqual(opened.globalPolicies,original.globalPolicies);
 assert.deepEqual(opened.approvals.find(item=>item.id===original.approvals[0].id),original.approvals[0]);
 assert.deepEqual(await service.load(),opened,'Reload must not replay the warm-start batch');
 const sequence=opened.sequence;service.tick();const advanced=await service.load();assert(advanced.sequence>sequence);
 assert.deepEqual(advanced.runs.find(run=>run.id===live.id),protectedLive);
 const paused=createSeed(now-86400000);for(const agent of paused.agents)agent.status='Paused';
 const pausedBefore=structuredClone(paused);assert.equal(warmRecentSimulation(paused,now),0);assert.deepEqual(paused,pausedBefore);

 // The API adapter returns the backend's sparse history exactly as supplied.
 const keys={'agents':'agents','runs':'runs','tool-calls':'toolCalls','policy-events':'policies','approvals':'approvals','users':'users','assignments':'assignments','audit-events':'audit','connectors':'connectors','agent-definitions':'definitions','global-policies':'globalPolicies'};
 globalThis.fetch=async url=>Response.json(original[keys[new URL(url).pathname.split('/').at(-1)]]);
 const api=await createFastApiService('https://api.example.test').load();
 assert.deepEqual(api.runs,original.runs);assert.deepEqual(api.approvals,original.approvals);assert.deepEqual(api.policies,original.policies);
}finally{
 Date.now=realNow;globalThis.fetch=realFetch;
 if(realWindow===undefined)delete globalThis.window;else globalThis.window=realWindow;
 if(realStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=realStorage;
}
console.log('Recent simulation passed: populated stale/scoped workspaces, idempotent warm-start, preserved live evidence and decisions, bounded chart retention, advancing feed, and authoritative API history.');
