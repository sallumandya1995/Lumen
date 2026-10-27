import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import ts from 'typescript';
const dir=new URL('../.sites-runtime/end-to-end-demo-tests/',import.meta.url);
for(const folder of ['agent-execution','governance'])await mkdir(new URL(folder+'/',dir),{recursive:true});
for(const name of ['governance/policy-config','governance/end-to-end-demo','governance/definitions','governance/mock-data','governance/recent-simulation','governance/service','agent-execution/engine']){
 const source=await readFile(new URL('../lib/'+(name==='governance/service'?'governance/store-core':name)+'.ts',import.meta.url),'utf8');
 const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
 await writeFile(new URL(name+'.mjs',dir),outputText.replace(/from '(\.\.?\/(?:governance\/)?(?:end-to-end-demo|definitions|mock-data|recent-simulation|service|policy-config))'/g,"from '$1.mjs'"));
}
await writeFile(new URL('models.mjs',dir),await readFile(new URL('../lib/models.mjs',import.meta.url)));
const {END_TO_END_DEMO_ID,END_TO_END_DEMO_INPUT,createEndToEndDemo}=await import(new URL('governance/end-to-end-demo.mjs',dir));
const {createSeed}=await import(new URL('governance/mock-data.mjs',dir));
const {upgradeSnapshot,configurationFrom,validateConfiguration}=await import(new URL('governance/definitions.mjs',dir));
const {createMockService,createFastApiService,isUsableSnapshot,scopeStore}=await import(new URL('governance/service.mjs',dir));
const {executeAgent}=await import(new URL('agent-execution/engine.mjs',dir));

const seed=createSeed(),example=createEndToEndDemo();
assert(isUsableSnapshot(seed));assert.equal(seed.runs.length,96);
assert.equal(seed.agents.filter(a=>a.id===END_TO_END_DEMO_ID).length,1);
assert(seed.users.filter(u=>['Owner','Admin'].includes(u.role)).every(u=>u.agentIds.includes(END_TO_END_DEMO_ID)));
assert(seed.users.filter(u=>['SME','Sub-admin'].includes(u.role)).every(u=>!u.agentIds.includes(END_TO_END_DEMO_ID)));
assert.deepEqual(example.agent.tools,['crm_lookup']);assert.equal(example.definition.limits.requireApproval,false);assert.deepEqual(example.definition.guardrails,[]);
validateConfiguration(END_TO_END_DEMO_ID,configurationFrom(example.agent,example.definition),seed,seed.users.find(u=>u.role==='Admin'));
const central='https://api.tokenfactory.us-central1.nebius.com/v1/',north='https://api.tokenfactory.us-north1.nebius.com/v1/',global='https://api.tokenfactory.nebius.com/v1/';
assert(seed.definitions.every(d=>d.model.baseUrl===central));
// Missing endpoints migrate by model region. Explicit choices and old execution
// history are never guessed, changed, or backfilled.
const endpointLegacy=structuredClone(seed);
for(const d of endpointLegacy.definitions)delete d.model.baseUrl;
endpointLegacy.definitions[0].model.name='deepseek-ai/DeepSeek-V4.1-Flash';
endpointLegacy.definitions[1].model.name='vendor/custom-7b';
endpointLegacy.definitions[2].model={...endpointLegacy.definitions[2].model,name:'vendor/explicit-7b',baseUrl:global};
const endpointBefore=structuredClone(endpointLegacy),endpointUpgrade=upgradeSnapshot(endpointLegacy);
assert.equal(endpointUpgrade.definitions[0].model.baseUrl,north);
assert.equal(endpointUpgrade.definitions[1].model.baseUrl,central);
assert.deepEqual(endpointUpgrade.definitions[2].model,endpointLegacy.definitions[2].model);
assert.deepEqual(endpointLegacy,endpointBefore);assert.deepEqual(endpointUpgrade.runs,endpointLegacy.runs);
assert(endpointUpgrade.runs.every(r=>r.baseUrl===undefined&&r.steps.every(step=>step.baseUrl===undefined)));
assert.deepEqual(upgradeSnapshot(endpointUpgrade),endpointUpgrade);

const configuredService=createMockService(),configuredStore=await configuredService.load(),configuredAgent=configuredStore.agents[0];
const configuredDraft=configurationFrom(configuredAgent,configuredStore.definitions.find(d=>d.agentId===configuredAgent.id));
configuredDraft.definition.model={provider:' nebius ',name:' vendor/custom-7b ',baseUrl:' https://api.tokenfactory.nebius.com/v1 ',temperature:.3,maxTokens:2048};
await configuredService.saveAgentConfiguration(configuredAgent.id,configuredDraft,'u-owner');
const configuredSaved=await configuredService.load(),savedModel=configuredSaved.definitions.find(d=>d.agentId===configuredAgent.id).model;
assert.deepEqual(savedModel,{provider:'Nebius',name:'vendor/custom-7b',baseUrl:global,temperature:.3,maxTokens:2048});
assert.deepEqual(configuredSaved.runs,configuredStore.runs);
const freshDraft=configurationFrom(configuredSaved.agents[0],configuredSaved.definitions.find(d=>d.agentId===configuredAgent.id));
for(const model of [{...savedModel,baseUrl:'https://attacker.example/v1/'},{...savedModel,baseUrl:central+'?key=secret'},{...savedModel,name:'https://example.invalid/model'},{...savedModel,name:'bad model id'},{...savedModel,provider:'Other'}]){
 await assert.rejects(()=>configuredService.saveAgentConfiguration(configuredAgent.id,{...freshDraft,definition:{...freshDraft.definition,model}},'u-owner'),/Nebius|model ID|base URL/);
}
assert.deepEqual(await configuredService.load(),configuredSaved);

// Upgrade adds a dedicated example without changing the existing agents, reviews,
// receipts, decisions, graph revisions, or SME scopes, and is idempotent.
const legacy={...structuredClone(seed),agents:seed.agents.filter(a=>a.id!==END_TO_END_DEMO_ID),definitions:seed.definitions.filter(d=>d.agentId!==END_TO_END_DEMO_ID),connectors:seed.connectors.filter(c=>c.id!=='c-lumen-demo'),users:seed.users.map(u=>({...u,agentIds:u.agentIds.filter(id=>id!==END_TO_END_DEMO_ID)}))};
legacy.definitions[0].revision=8;legacy.definitions[0].prompt.system='Retain the saved customer care instructions.';legacy.approvals[0].note='Prior review remains recorded.';
const before=JSON.stringify(legacy),upgraded=upgradeSnapshot(legacy);
assert.equal(JSON.stringify(legacy),before);assert(isUsableSnapshot(upgraded));
for(const key of ['runs','toolCalls','policies','approvals','assignments','audit'])assert.deepEqual(upgraded[key],legacy[key]);
assert.deepEqual(upgraded.agents.slice(0,legacy.agents.length),legacy.agents);
assert.deepEqual(upgraded.definitions.slice(0,legacy.definitions.length),legacy.definitions);
assert.deepEqual(upgradeSnapshot(upgraded),upgraded);
upgraded.definitions.find(d=>d.agentId===END_TO_END_DEMO_ID).prompt.goal='Admin-edited demo goal';
assert.equal(upgradeSnapshot(upgraded).definitions.find(d=>d.agentId===END_TO_END_DEMO_ID).prompt.goal,'Admin-edited demo goal');
const oldWithoutDefinitions=structuredClone(legacy);delete oldWithoutDefinitions.definitions;
assert(isUsableSnapshot(upgradeSnapshot(oldWithoutDefinitions)));
assert(!scopeStore(upgraded,upgraded.users.find(u=>u.role==='SME')).agents.some(a=>a.id===END_TO_END_DEMO_ID));

// Saved copies of the originally shipped workflow receive only exact copy
// replacements. Keep these historical literals independent of current defaults.
const oldCopy={
 agent:{name:'Lumen · End-to-end demo',description:'Turn a synthetic support case into an internally reviewed triage memo. Read-only demo tools and two model roles complete without an approval pause.'},
 prompt:{system:'You are a read-only demonstration assistant working only with fictional support case DEMO-1042 and clearly labeled synthetic fixtures. Produce an internal memo, never perform or claim an external action. Never send a message, create a ticket, approve a refund, or alter an account. Do not wait for human approval: the only deliverable is text returned in this demo. Distinguish supplied facts from missing information and recommendations. Return the useful result only, with no hidden reasoning.',goal:'Demonstrate a complete input, tool, agent, specialist, run-memory, and output workflow by returning a concise reviewed internal triage memo.',outputFormat:'A concise memo with: Demo case; Known facts; Missing information; Recommended next step. Label the evidence as synthetic. Keep the final memo under 220 words.'},
 nodes:{
  input:{label:'Demo support case',description:'Accept the fictional case and the editable demonstration task.',prompt:'Read-only synthetic support memo demonstration.'},
  'crm-context':{label:'Read demo CRM context',description:'Return a fixed synthetic account fixture. No CRM endpoint is contacted.',prompt:'Use the built-in read-only crm_lookup demo fixture only.'},
  'triage-memo':{description:'Combine the original fictional task and synthetic account context into an internal triage memo.',prompt:'Use only the original task and supplied synthetic CRM fixture. Do not invent transaction details or confirmed duplicate charges. Identify unknowns. Write a concise internal memo, without asking for approval or proposing an external tool action.'},
  'review-memo':{prompt:'Review the preceding memo for unsupported factual claims and clarity. Preserve its useful facts; correct or remove assumptions not supported by the original fictional task and synthetic fixture. Return the complete refined memo, not a review verdict. Do not require a person to approve it; no external action will occur.'},
  memory:{prompt:'Keep only this demonstration run context; no persistent memory backend is used.'},
  output:{label:'Completed demo memo',description:'Return the reviewed memo to the user and finish the demonstration.',prompt:'Return the final demo memo in this interface only.'}
 }
};
const savedCopy=structuredClone(seed),savedAgent=savedCopy.agents.find(a=>a.id===END_TO_END_DEMO_ID),savedDefinition=savedCopy.definitions.find(d=>d.agentId===END_TO_END_DEMO_ID),savedConnector=savedCopy.connectors.find(c=>c.id==='c-lumen-demo');
Object.assign(savedAgent,oldCopy.agent);Object.assign(savedDefinition.prompt,oldCopy.prompt);
for(const node of savedDefinition.nodes)Object.assign(node,oldCopy.nodes[node.id]||{});
savedDefinition.edges[0].label='Read synthetic context';savedConnector.name='Read-only demo fixture';
// Non-copy changes intentionally differ from current defaults and must survive.
savedDefinition.revision=9;savedDefinition.updatedAt='2026-10-20T12:30:00.000Z';savedDefinition.updatedBy='u-admin';
savedDefinition.model.temperature=.7;savedDefinition.model.maxTokens=4096;
savedDefinition.limits={maxSteps:21,timeoutSeconds:180,retries:2,budgetUsd:.4,requireApproval:true};
savedDefinition.memory.maxItems=55;savedDefinition.nodes.find(n=>n.id==='memory').enabled=false;
savedDefinition.guardrails=[{id:'retained-rule',name:'Require review',description:'Preserve configured approval policy.',enabled:true,action:'Require approval',severity:'High',stage:'Tool'}];
savedAgent.reviewerIds=['u-admin'];savedAgent.risk='Medium';
savedConnector.endpoint='https://configured.example.invalid/account';
savedCopy.approvals[0].note='Historical review note retained.';
const savedBefore=structuredClone(savedCopy),expectedCopy=structuredClone(savedCopy);
Object.assign(expectedCopy.agents.find(a=>a.id===END_TO_END_DEMO_ID),{name:example.agent.name,description:example.agent.description});
const expectedDefinition=expectedCopy.definitions.find(d=>d.agentId===END_TO_END_DEMO_ID);
Object.assign(expectedDefinition.prompt,example.definition.prompt);
for(const node of expectedDefinition.nodes){const current=example.definition.nodes.find(n=>n.id===node.id);for(const key of Object.keys(oldCopy.nodes[node.id]||{}))node[key]=current[key]}
expectedDefinition.edges[0].label=example.definition.edges[0].label;
expectedCopy.connectors.find(c=>c.id==='c-lumen-demo').name=example.connector.name;
const refreshed=upgradeSnapshot(savedCopy);
assert.deepEqual(savedCopy,savedBefore,'The stored snapshot must not be mutated.');
assert.deepEqual(refreshed,expectedCopy,'Only original copy changes; IDs, model, limits, guardrails, revision, timestamps, history, and all other configuration survive.');
assert.deepEqual(upgradeSnapshot(refreshed),refreshed,'Copy migration is idempotent.');

const customized=structuredClone(savedCopy),customAgent=customized.agents.find(a=>a.id===END_TO_END_DEMO_ID),customDefinition=customized.definitions.find(d=>d.agentId===END_TO_END_DEMO_ID),customConnector=customized.connectors.find(c=>c.id==='c-lumen-demo');
customAgent.name='My support workflow';customAgent.description='Keep my demo description as written.';
customDefinition.prompt.system='Keep my demo instructions exactly.';customDefinition.prompt.goal='My saved goal';customDefinition.prompt.outputFormat='My saved format';
customDefinition.nodes.find(n=>n.id==='input').label='My case input';customDefinition.nodes.find(n=>n.id==='input').prompt='My custom case instructions';
customDefinition.edges[0].label='My route';customConnector.name='My account connector';
// Identical old wording on another agent is not an invitation to edit it.
customized.agents[0].name=oldCopy.agent.name;customized.definitions[0].prompt.system=oldCopy.prompt.system;
const customRefreshed=upgradeSnapshot(customized),customResult=customRefreshed.definitions.find(d=>d.agentId===END_TO_END_DEMO_ID);
assert.deepEqual(customRefreshed.agents.find(a=>a.id===END_TO_END_DEMO_ID),customAgent);
assert.deepEqual(customResult.prompt,customDefinition.prompt);
assert.equal(customResult.nodes.find(n=>n.id==='input').label,'My case input');assert.equal(customResult.nodes.find(n=>n.id==='input').prompt,'My custom case instructions');
assert.equal(customResult.nodes.find(n=>n.id==='input').description,example.definition.nodes.find(n=>n.id==='input').description,'Exact legacy fields update independently of customized neighboring fields.');
assert.deepEqual(customResult.edges,customDefinition.edges);assert.deepEqual(customRefreshed.connectors.find(c=>c.id==='c-lumen-demo'),customConnector);
assert.deepEqual(customRefreshed.agents[0],customized.agents[0]);assert.deepEqual(customRefreshed.definitions[0],customized.definitions[0]);
assert.deepEqual(upgradeSnapshot(customRefreshed),customRefreshed);

// Use the same production execution engine: all six nodes finish, the two model
// roles receive predecessor context, and no policy/approval event is invented.
const calls=[],events=[];
const result=await executeAgent({...example,input:END_TO_END_DEMO_INPUT},{signal:new AbortController().signal,emit:e=>events.push(e),invoke:async call=>{
 calls.push(call);assert.equal(call.purpose,'agent');
 return {text:calls.length===1?'Draft memo using the CASE-1042 local record.':'Reviewed internal memo: CASE-1042 uses local sample data. Confirm transaction details before recommending any account change. No external action performed.',tokens:35};
}});
assert.equal(result.status,'Success');assert.equal(result.nodes.length,6);assert(result.nodes.every(n=>n.status==='Success'));
assert.equal(result.nodes.at(-1).kind,'Output');assert.match(result.output,/Reviewed internal memo/);
assert.equal(calls.length,2);assert.match(calls[0].input,/Local sample data/);assert.match(calls[0].input,/local_function/);assert.match(calls[1].input,/Draft memo using the CASE-1042 local record/);
assert.deepEqual(result.policies,[]);assert.equal(result.nodes.find(n=>n.kind==='Tool').toolMode,'demo');
assert.equal(events.filter(e=>e.type==='node-result').length,6);

const service=createMockService(),initial=await service.load();
for(let i=0;i<12;i++)service.tick();
assert(!(await service.load()).runs.some(r=>r.agentId===END_TO_END_DEMO_ID),'Random telemetry must not manufacture demo runs or failures.');
await service.recordExecution(result,'u-owner');const recorded=await service.load();
assert(recorded.runs.some(r=>r.id===result.id&&r.source==='live'&&r.status==='Success'));
const adminScope=scopeStore(recorded,recorded.users.find(u=>u.role==='Admin'));
assert.equal(adminScope.runs.find(r=>r.id===result.id)?.steps.length,6);
assert.equal(adminScope.runs.find(r=>r.id===result.id)?.status,'Success');
assert(!recorded.approvals.some(a=>a.runId===result.id));assert(!recorded.policies.some(p=>p.runId===result.id));
assert.deepEqual(initial.definitions.find(d=>d.agentId==='a-support').guardrails,seed.definitions.find(d=>d.agentId==='a-support').guardrails);

// External API snapshots remain authoritative; never insert a browser example
// into a backend workspace where it has not been configured.
const originalFetch=globalThis.fetch;
const collections={'agents':'agents','runs':'runs','tool-calls':'toolCalls','policy-events':'policies','approvals':'approvals','users':'users','assignments':'assignments','audit-events':'audit','connectors':'connectors','agent-definitions':'definitions','global-policies':'globalPolicies'};
try{
 globalThis.fetch=async url=>Response.json(legacy[collections[new URL(url).pathname.split('/').at(-1)]]);
 const api=await createFastApiService('https://example.invalid').load();
 assert(!api.agents.some(a=>a.id===END_TO_END_DEMO_ID));
}finally{globalThis.fetch=originalFetch}
console.log('End-to-end demo passed: six completed nodes, two model roles, read-only fixture, no approval pause, preserved upgrades, scoped visibility, live receipts, and untouched API snapshots.');
