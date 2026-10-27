import ts from 'typescript';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir=new URL('../.sites-runtime/execution-record-tests/',import.meta.url);await mkdir(dir,{recursive:true});
for(const name of ['types','policy-config','end-to-end-demo','definitions','mock-data','recent-simulation','service']){const source=await readFile(new URL(`../lib/governance/${name==='service'?'store-core':name}.ts`,import.meta.url),'utf8');const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});await writeFile(new URL(name+'.mjs',dir),outputText.replace("from '../models.mjs'","from './models.mjs'").replace(/from '\.\/(mock-data|recent-simulation|types|policy-config|end-to-end-demo|definitions)'/g,"from './$1.mjs'"))}
await writeFile(new URL('models.mjs',dir),await readFile(new URL('../lib/models.mjs',import.meta.url)));
const {createMockService,createFastApiService,isUsableSnapshot,scopeStore}=await import(new URL('service.mjs',dir));
const service=createMockService(),initial=await service.load(),at=new Date().toISOString();
const agent=initial.agents.find(a=>a.id==='a-support'),definition=initial.definitions.find(d=>d.agentId===agent.id);
const node=(kind='Agent',overrides={})=>({nodeId:'coordinator',label:'Customer Care Crew',kind,status:'Success',input:'Explain the case.',output:'The case is ready for review.',summary:'Prepared a concise case response.',at,duration:420,tokens:30,cost:0,...overrides});
const receipt=(id,overrides={})=>({id,agentId:agent.id,configurationRevision:definition.revision,mode:'agent',input:'Explain the case.',output:'The case is ready for review.',status:'Success',at,duration:600,tokens:30,cost:0,costKnown:false,model:'nvidia/Nemotron-3-Ultra-550b-a55b',nodes:[node()],policies:[],warnings:['Tools use demo adapters.'],...overrides});
const first=receipt('RUN-live-1');await service.recordExecution(first,'u-owner');
let s=await service.load(),run=s.runs.find(r=>r.id===first.id);assert(run);assert.equal(run.source,'live');assert.equal(run.executionMode,'agent');assert.equal(run.duration,600);assert.equal(run.steps[0].duration,420);assert.equal(run.steps[0].nodeId,'coordinator');assert.equal(run.steps[0].output,first.nodes[0].output);assert.equal(run.steps[0].input,first.nodes[0].input);assert.equal(run.costKnown,false);assert.equal(run.output,first.output);assert.equal(run.configurationRevision,definition.revision);assert(isUsableSnapshot(s));
assert(s.audit.some(a=>a.target===first.id&&a.action==='Live agent run recorded'));
const auditCount=s.audit.length;await service.recordExecution({...first},'u-owner');s=await service.load();assert.equal(s.runs.filter(r=>r.id===first.id).length,1);assert.equal(s.audit.length,auditCount);
assert.equal(run.baseUrl,undefined);assert.equal(run.steps[0].baseUrl,undefined,'Old receipts must not acquire a guessed historical endpoint.');
assert.equal(run.globalPolicyRevision,undefined,'Legacy receipts must not acquire a guessed global policy revision.');
await assert.rejects(()=>service.recordExecution({...first,output:'different'},'u-owner'),/different result/);
await assert.rejects(()=>service.recordExecution(receipt('RUN-sme'),'u-sme'),/admin access/);
await assert.rejects(()=>service.recordExecution(receipt('RUN-scope',{agentId:'a-finance'}),'u-admin'),/admin access/);
await assert.rejects(()=>service.recordExecution(receipt('RUN-future',{configurationRevision:999}),'u-owner'),/unknown configuration revision/);
const beforeInvalid=JSON.stringify(await service.load());
for(const changed of [{tokens:NaN},{duration:-1},{nodes:[node(),node()]},{nodes:[node('Tool',{toolName:'arbitrary_system',toolMode:'demo'})]},{warnings:[1]},{nodes:[node('Tool',{toolName:'crm_lookup'})]}])await assert.rejects(()=>service.recordExecution(receipt('RUN-invalid',changed),'u-owner'),/invalid/);
assert.equal(JSON.stringify(await service.load()),beforeInvalid);

// Store the policy revision used when execution began, even after the owner
// saves new rules. Unknown future revisions are not valid workspace evidence.
const globalReceipt=receipt('RUN-global-policies',{globalPolicyRevision:initial.globalPolicies.revision});
await service.saveGlobalPolicies({expectedRevision:initial.globalPolicies.revision,rules:initial.globalPolicies.rules},'u-owner');
await service.recordExecution(globalReceipt,'u-owner');s=await service.load();
assert.equal(s.runs.find(r=>r.id===globalReceipt.id).globalPolicyRevision,1);assert.equal(s.globalPolicies.revision,2);
const globalAudit=s.audit.length;await service.recordExecution(globalReceipt,'u-owner');assert.equal((await service.load()).audit.length,globalAudit);
await assert.rejects(()=>service.recordExecution(receipt('RUN-future-global',{globalPolicyRevision:3}),'u-owner'),/unknown global policy revision/);
const beforeBadGlobal=JSON.stringify(await service.load());
for(const globalPolicyRevision of [0,-1,1.5,NaN,null,'1',Number.MAX_SAFE_INTEGER+1])await assert.rejects(()=>service.recordExecution(receipt('RUN-invalid-global',{globalPolicyRevision}),'u-owner'),/invalid/);
assert.equal(JSON.stringify(await service.load()),beforeBadGlobal);
const corruptGlobal=structuredClone(s);corruptGlobal.runs.find(r=>r.id===globalReceipt.id).globalPolicyRevision=0;assert.equal(isUsableSnapshot(corruptGlobal),false);

// Record the actual explicit endpoint at run and model-node level. Allow only
// approved Nebius origins; do not let endpoint metadata carry arbitrary URLs.
const endpointReceipt=receipt('RUN-regional',{model:'vendor/custom-7b',baseUrl:'https://api.tokenfactory.nebius.com/v1',nodes:[node('Agent',{model:'vendor/custom-7b',baseUrl:'https://api.tokenfactory.us-north1.nebius.com/v1/'})]});
await service.recordExecution(endpointReceipt,'u-owner');s=await service.load();const regional=s.runs.find(r=>r.id===endpointReceipt.id);
assert.equal(regional.baseUrl,'https://api.tokenfactory.nebius.com/v1/');assert.equal(regional.steps[0].baseUrl,'https://api.tokenfactory.us-north1.nebius.com/v1/');assert.equal(regional.model,'vendor/custom-7b');assert(isUsableSnapshot(s));
await service.recordExecution(endpointReceipt,'u-owner');assert.equal((await service.load()).runs.filter(r=>r.id===endpointReceipt.id).length,1);
const beforeBadEndpoint=JSON.stringify(await service.load());
for(const baseUrl of ['https://attacker.example/v1/','https://api.tokenfactory.nebius.com.attacker.example/v1/','http://api.tokenfactory.nebius.com/v1/','https://user:secret@api.tokenfactory.nebius.com/v1/','https://api.tokenfactory.nebius.com/v1/?token=secret','https://127.0.0.1/v1/',null,42]){
 await assert.rejects(()=>service.recordExecution(receipt('RUN-bad-region',{baseUrl}),'u-owner'),/invalid/);
 await assert.rejects(()=>service.recordExecution(receipt('RUN-bad-node-region',{nodes:[node('Agent',{baseUrl})]}),'u-owner'),/invalid/);
}
assert.equal(JSON.stringify(await service.load()),beforeBadEndpoint);
const corruptRegion=structuredClone(s);corruptRegion.runs.find(r=>r.id===endpointReceipt.id).steps[0].baseUrl='https://attacker.example/v1/';assert.equal(isUsableSnapshot(corruptRegion),false);

// New node evidence is optional for old receipts, but validated and preserved
// when present. Passed checks are evidence, not policy violations/approvals.
const check={id:`global:${'g'.repeat(100)}`,rule:'PII redaction',stage:'Input',action:'Block',violated:false,summary:'<think>private evaluator reasoning</think>No personal identifiers found.',reasoning_content:'Do not persist this field.'};
const evidence=receipt('RUN-evidence',{mode:'node',nodeId:'input',tokenUsage:{generation:0,policy:30,extra:'not stored'},nodes:[node('Input',{nodeId:'input',tokenUsage:{generation:0,policy:30,extra:'not stored'},policyChecks:[check]})]});
await service.recordExecution(evidence,'u-owner');s=await service.load();const evidenceRun=s.runs.find(r=>r.id===evidence.id),step=evidenceRun.steps[0];
assert.deepEqual(evidenceRun.tokenUsage,{generation:0,policy:30});assert.equal(step.tokens,30);assert.equal(step.nodeKind,'Input');assert.deepEqual(step.tokenUsage,{generation:0,policy:30});
assert.deepEqual(step.policyChecks,[{id:check.id,rule:'PII redaction',stage:'Input',action:'Block',violated:false,summary:'No personal identifiers found.'}]);
assert(!JSON.stringify(step).includes('private evaluator reasoning'));assert(!JSON.stringify(step).includes('Do not persist this field.'));
assert(!s.policies.some(p=>p.runId===evidence.id));assert(!s.approvals.some(p=>p.runId===evidence.id));assert(isUsableSnapshot(s));
const evidenceAudit=s.audit.length;await service.recordExecution(evidence,'u-owner');s=await service.load();assert.equal(s.audit.length,evidenceAudit);
const evidenceVisible=scopeStore(s,s.users.find(u=>u.id==='u-admin')).runs.find(r=>r.id===evidence.id);assert.deepEqual(evidenceVisible.steps[0].policyChecks,step.policyChecks);
const malformedEvidence=[
 {tokenUsage:{generation:0,policy:29}},
 {tokenUsage:{generation:-1,policy:31}},
 {tokenUsage:{generation:0.5,policy:29.5}},
 {tokenUsage:{generation:0,policy:NaN}},
 {tokenUsage:null},
 {tokenUsage:{generation:30,policy:0},nodes:[node('Input',{nodeId:'input',tokenUsage:{generation:0,policy:30}})]},
 {nodes:[node('Input',{tokenUsage:{generation:0,policy:29}})]},
 ...[null,{},[{...check,violated:'false'}],[{...check,stage:'Unknown'}],[{...check,action:'Allow'}],[{...check,id:''}],[{...check,id:'x'.repeat(201)}],[{...check,summary:'x'.repeat(1001)}],Array(101).fill(check)].map(policyChecks=>({nodes:[node('Input',{policyChecks})]}))
];
const beforeBadEvidence=JSON.stringify(s);
for(const changed of malformedEvidence)await assert.rejects(()=>service.recordExecution(receipt('RUN-bad-evidence',changed),'u-owner'),/invalid/);
assert.equal(JSON.stringify(await service.load()),beforeBadEvidence);
const corrupt=structuredClone(s);corrupt.runs.find(r=>r.id===evidence.id).steps[0].tokenUsage.policy=29;assert.equal(isUsableSnapshot(corrupt),false);
const corruptCheck=structuredClone(s);corruptCheck.runs.find(r=>r.id===evidence.id).steps[0].policyChecks[0].violated='false';assert.equal(isUsableSnapshot(corruptCheck),false);
// Mixed old/new evidence remains accepted without inventing missing breakdowns.
await service.recordExecution(receipt('RUN-partial-usage',{tokenUsage:{generation:30,policy:0}}),'u-owner');
assert.equal((await service.load()).runs.find(r=>r.id==='RUN-partial-usage').steps[0].tokenUsage,undefined);

// Tool and policy records link to the same live run, with approval left visible/unassigned.
const gated=receipt('RUN-gated',{status:'Awaiting approval',output:'Held before a sensitive proposal.',nodes:[node(),node('Tool',{nodeId:'tool-1',label:'Email draft',status:'Awaiting approval',toolName:'email_draft',toolMode:'demo',summary:'Held for approval.'})],policies:[{rule:'External action review',severity:'High',action:'Require approval',context:'Review the proposed email before continuing.',nodeId:'tool-1'}]});
await service.recordExecution(gated,'u-admin');s=await service.load();const call=s.toolCalls.find(t=>t.runId===gated.id),policy=s.policies.find(p=>p.runId===gated.id),approval=s.approvals.find(a=>a.runId===gated.id);
assert.equal(call.status,'Blocked');assert.match(call.output,/Demo tool/);assert.equal(call.latency,420);assert.equal(call.nodeId,'tool-1');assert.equal(policy.disposition,'Flagged');assert.equal(approval.status,'Pending');assert.equal(approval.assigneeId,null);assert.equal(approval.agentId,agent.id);assert.match(approval.note,/does not automatically resume/);assert(isUsableSnapshot(s));
const gatedAudit=s.audit.length;await service.recordExecution(gated,'u-admin');s=await service.load();assert.equal(s.audit.length,gatedAudit);assert.equal(s.approvals.filter(a=>a.runId===gated.id).length,1);
const blocked=receipt('RUN-blocked',{status:'Blocked',nodes:[node('Guardrail',{nodeId:'guardrail',status:'Blocked'})],policies:[{rule:'Restricted data',severity:'High',action:'Block',context:'The requested field is restricted.'}]});await service.recordExecution(blocked,'u-owner');s=await service.load();assert.equal(s.policies.find(p=>p.runId===blocked.id).disposition,'Blocked');assert(!s.approvals.some(a=>a.runId===blocked.id));

// Node-only results and cancellations are retained without pretending success.
await service.recordExecution(receipt('RUN-node',{mode:'node',nodeId:'coordinator',output:'<think>hidden internal reasoning</think>Public answer',nodes:[node('Agent',{summary:'<think>private</think>Returned public answer.'})]}),'u-owner');
await service.recordExecution(receipt('RUN-cancel',{status:'Cancelled',nodes:[],tokens:0,output:''}),'u-owner');
s=await service.load();const n=s.runs.find(r=>r.id==='RUN-node'),cancel=s.runs.find(r=>r.id==='RUN-cancel');assert.equal(n.executionMode,'node');assert.equal(n.output,'Public answer');assert.equal(n.steps[0].summary,'Returned public answer.');assert.equal(cancel.status,'Failed');assert.equal(cancel.executionStatus,'Cancelled');assert.equal(cancel.steps[0].outcome,'Cancelled');
service.tick();s=await service.load();assert.equal(s.runs.find(r=>r.id==='RUN-cancel').executionStatus,'Cancelled');assert.equal(s.runs.find(r=>r.id==='RUN-gated').status,'Awaiting approval');
const visible=scopeStore(s,s.users.find(u=>u.id==='u-admin'));assert(visible.runs.some(r=>r.id===gated.id));
await service.setAgentStatus(agent.id,'Paused','u-owner');await service.recordExecution(receipt('RUN-old-revision'),'u-owner');s=await service.load();assert.equal(s.runs.find(r=>r.id==='RUN-old-revision').configurationRevision,definition.revision);

// The API boundary sends only the receipt; actor identity remains server-derived.
const realFetch=globalThis.fetch;let posted;
globalThis.fetch=async(url,options)=>{posted={url,options,body:JSON.parse(options.body)};return new Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json'}})};
try{await createFastApiService('https://api.example.test/').recordExecution(first,'untrusted-browser-role');assert.equal(posted.url,'https://api.example.test/api/agent-executions');assert.deepEqual(posted.body,first);assert.equal(posted.options.credentials,'include');assert.equal(posted.body.userId,undefined);await createFastApiService('https://api.example.test/').recordExecution(endpointReceipt,'untrusted-browser-role');assert.deepEqual(posted.body,endpointReceipt);assert.equal(posted.body.baseUrl,endpointReceipt.baseUrl);assert.equal(posted.body.nodes[0].baseUrl,endpointReceipt.nodes[0].baseUrl)}finally{globalThis.fetch=realFetch}
const realWindow=globalThis.window,realStorage=globalThis.localStorage;globalThis.window={};globalThis.localStorage={getItem:()=>null,setItem:()=>{throw new Error('quota')}};
try{const limited=createMockService();await limited.load();const receiptWithQuota=receipt('RUN-quota');await assert.rejects(()=>limited.recordExecution(receiptWithQuota,'u-owner'),/browser storage/);assert((await limited.load()).runs.some(r=>r.id==='RUN-quota'));await assert.rejects(()=>limited.recordExecution(receiptWithQuota,'u-owner'),/browser storage/);assert.equal((await limited.load()).runs.filter(r=>r.id==='RUN-quota').length,1);let recovered='';globalThis.localStorage={getItem:()=>null,setItem:(_key,value)=>{recovered=value}};await limited.recordExecution(receiptWithQuota,'u-owner');const stored=JSON.parse(recovered);assert.equal(stored.runs.filter(r=>r.id==='RUN-quota').length,1);assert.equal(stored.audit.filter(a=>a.target==='RUN-quota').length,1)}finally{globalThis.window=realWindow;globalThis.localStorage=realStorage}
console.log('Execution records passed: live runs, node tests, scope/roles, atomic rejection, idempotency, revision history, demo tools, policies, approvals, cancellation, and API boundary.');
