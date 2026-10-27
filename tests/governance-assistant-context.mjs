import ts from 'typescript';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const dir=new URL('../.sites-runtime/assistant-context-tests/',import.meta.url);
await mkdir(dir,{recursive:true});
await writeFile(new URL('models.mjs',dir),await readFile(new URL('../lib/models.mjs',import.meta.url)));
for(const name of ['types','policy-config','end-to-end-demo','definitions','mock-data','recent-simulation','service','assistant-context']){
 const source=await readFile(new URL(`../lib/governance/${name==='service'?'store-core':name}.ts`,import.meta.url),'utf8');
 const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
 await writeFile(new URL(name+'.mjs',dir),outputText.replace("from '../models.mjs'","from './models.mjs'").replace(/from '\.\/(mock-data|recent-simulation|types|policy-config|end-to-end-demo|definitions|service)'/g,"from './$1.mjs'"));
}
const {createSeed}=await import(new URL('mock-data.mjs',dir));
const {buildGovernanceContext}=await import(new URL('assistant-context.mjs',dir));
const seed=createSeed(),now=Date.now();
const owner=seed.users.find(u=>u.role==='Owner'),admin=seed.users.find(u=>u.role==='Admin'),sme=seed.users.find(u=>u.id==='u-sme');
const view={section:'overview',workspaceMode:'mock',period:'24h',filters:{},now};
const ownerContext=buildGovernanceContext(seed,owner,view);
assert.equal(ownerContext.metrics.agentsInScope,seed.agents.length);
assert.equal(ownerContext.metrics.pendingApprovals,seed.approvals.filter(a=>a.status==='Pending').length);
assert(ownerContext.records.agents.some(a=>a.id==='a-finance'));
for(const user of [admin,sme]){
 const c=buildGovernanceContext(seed,user,view),allowed=new Set(user.agentIds);
 assert(c.records.agents.every(a=>allowed.has(a.id)));
 for(const key of ['runs','toolCalls','policies','approvals','definitions','agentMetrics'])assert(c.records[key].every(a=>allowed.has(a.agentId||a.id)));
 assert(c.records.users.every(u=>u.agentIds.every(id=>allowed.has(id))));
 if(user.role==='SME'){
  assert(c.records.approvals.every(a=>a.assigneeId===user.id));
  assert(c.records.policies.every(p=>p.assigneeId===user.id));
  assert.equal(c.records.connectors.length,0);
 }
 // A caller-supplied filtered ID list cannot put an out-of-scope agent back.
 const injected=buildGovernanceContext(seed,user,{...view,section:'agents',visibleIds:{agents:['a-finance']}});
 if(!allowed.has('a-finance'))assert.equal(injected.records.agents.length,0);
}
const ids=seed.runs.slice(0,2).map(r=>r.id).reverse();
const filtered=buildGovernanceContext(seed,owner,{...view,section:'runs',visibleIds:{runs:ids}});
assert.deepEqual(filtered.records.runs.map(r=>r.id),ids);
assert.equal(filtered.coverage.collections.runs.matchingCount,2);
assert.equal(filtered.metrics.totalRuns,ownerContext.metrics.totalRuns);
assert.equal(filtered.coverage.collections.runs.filteredToCurrentView,true);
const empty=buildGovernanceContext(seed,owner,{...view,section:'runs',visibleIds:{runs:[]}});
assert.equal(empty.records.runs.length,0);
assert.equal(empty.coverage.collections.runs.matchingCount,0);
assert(ownerContext.coverage.collections.runs.truncated);
assert.equal(ownerContext.records.runs.length,24);
assert(ownerContext.coverage.collections.runs.matchingCount>24);

const live=structuredClone(seed.runs[0]);Object.assign(live,{id:'LIVE-UNPRICED',at:new Date(now).toISOString(),source:'live',costKnown:false,cost:99999,task:'<think>private rationale</think>Visible task. api_key=synthetic-secret',output:'Do not send raw output',status:'Success'});
const altered={...seed,runs:[live,...seed.runs]};
const result=buildGovernanceContext(altered,owner,view);
assert.equal(result.records.runs.find(r=>r.id===live.id).costUsd,null);
assert.equal(result.metrics.knownEstimatedCostUsd,ownerContext.metrics.knownEstimatedCostUsd);
assert.equal(result.metrics.unpricedLiveRuns,1);
assert(!JSON.stringify(result).includes('private rationale'));
assert(!JSON.stringify(result).includes('synthetic-secret'));
assert(!JSON.stringify(result).includes('Do not send raw output'));
assert(!('endpoint' in result.records.connectors[0]));
const outOfWindow={...live,id:'OLD-LIVE',at:new Date(now-86400001).toISOString()};
assert.equal(buildGovernanceContext({...seed,runs:[outOfWindow,...seed.runs]},owner,view).metrics.totalRuns,ownerContext.metrics.totalRuns);
const inspected=buildGovernanceContext({...seed,runs:[outOfWindow,...seed.runs]},owner,{...view,selectedRecord:{type:'run',id:outOfWindow.id}});
assert(inspected.records.runs.some(r=>r.id===outOfWindow.id));
assert.equal(inspected.coverage.collections.runs.inspectedRecordOutsideMatchingView,true);
assert.equal(inspected.coverage.collections.runs.matchingCount,ownerContext.coverage.collections.runs.matchingCount);
assert.equal(inspected.metrics.totalRuns,ownerContext.metrics.totalRuns);
assert.equal(buildGovernanceContext(seed,admin,{...view,section:'team',visibleIds:{users:seed.users.map(u=>u.id)}}).coverage.collections.users.matchingCount,seed.users.length);
assert.equal(result.records.agentMetrics.reduce((n,a)=>n+a.runs,0),result.metrics.totalRuns);
assert.equal(result.records.toolUsage.reduce((n,t)=>n+t.calls,0),seed.toolCalls.length);
assert(Buffer.byteLength(JSON.stringify(result))<240*1024);
console.log('Governance assistant context: scoped roles, filters, totals, bounded records, secret stripping, and unknown costs passed.');
