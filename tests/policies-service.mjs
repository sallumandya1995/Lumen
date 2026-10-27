import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import ts from 'typescript';

const dir=new URL('../.sites-runtime/policies-service-tests/',import.meta.url);
await mkdir(dir,{recursive:true});
for(const name of ['types','policy-config','end-to-end-demo','definitions','mock-data','recent-simulation','service']){
 const source=await readFile(new URL(`../lib/governance/${name==='service'?'store-core':name}.ts`,import.meta.url),'utf8');
 const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
 await writeFile(new URL(name+'.mjs',dir),outputText.replace("from '../models.mjs'","from './models.mjs'").replace(/from '\.\/(mock-data|recent-simulation|types|policy-config|end-to-end-demo|definitions)'/g,"from './$1.mjs'"));
}
await writeFile(new URL('models.mjs',dir),await readFile(new URL('../lib/models.mjs',import.meta.url)));
const {createSeed}=await import(new URL('mock-data.mjs',dir));
const {createDefaultGlobalPolicies,validatePolicyRules,withGlobalPolicyDefaults,effectivePolicyRules}=await import(new URL('policy-config.mjs',dir));
const {upgradeSnapshot,configurationFrom}=await import(new URL('definitions.mjs',dir));
const {createMockService,createFastApiService,isUsableSnapshot,scopeStore}=await import(new URL('service.mjs',dir));

const at='2026-10-21T10:00:00.000Z',defaults=createDefaultGlobalPolicies(at,'u-owner'),seed=createSeed();
assert.equal(defaults.revision,1);assert.equal(defaults.updatedAt,at);assert.equal(defaults.updatedBy,'u-owner');
assert.deepEqual(defaults.rules.map(r=>[r.id,r.stage,r.action]),[['protect-credentials','Input','Block'],['tenant-isolation','Tool','Block'],['review-external-actions','Tool','Require approval']]);
assert(defaults.rules.every(r=>r.enabled&&r.severity==='High'));assert.match(defaults.rules[2].description,/Read-only lookups, drafts, and internal summaries do not require approval/);
assert.equal(seed.globalPolicies.rules.length,3);assert(isUsableSnapshot(seed));

// Migrate only missing global configuration, preserving saved local edits and history.
const legacy=structuredClone(seed);delete legacy.globalPolicies;
legacy.definitions[0].guardrails=[{...defaults.rules[0],id:'my-local',name:'My custom policy',enabled:false}];
legacy.definitions[0].prompt.system='Preserve my saved instructions.';
legacy.definitions[0].revision=19;
const before=structuredClone(legacy),migrated=upgradeSnapshot(legacy);
assert.deepEqual(legacy,before);assert.deepEqual(migrated.globalPolicies,createDefaultGlobalPolicies(legacy.updatedAt,'u-owner'));
for(const key of ['agents','definitions','runs','toolCalls','policies','approvals','audit','assignments'])assert.deepEqual(migrated[key],before[key]);
assert.deepEqual(upgradeSnapshot(migrated),migrated);assert(isUsableSnapshot(migrated));
const empty={...seed,globalPolicies:{revision:7,updatedAt:at,updatedBy:'u-owner',rules:[]}};
assert.equal(withGlobalPolicyDefaults(empty),empty);assert.deepEqual(upgradeSnapshot(empty).globalPolicies,empty.globalPolicies);
const custom={...empty,globalPolicies:{...empty.globalPolicies,rules:legacy.definitions[0].guardrails}};
assert.deepEqual(upgradeSnapshot(custom).globalPolicies,custom.globalPolicies);

const rule=defaults.rules[0];
for(const rules of [null,{},Array.from({length:31},(_,i)=>({...rule,id:`r${i}`,name:`Rule ${i}`})),[{...rule,extra:'unsupported'}],[{...rule,id:''}],[{...rule,id:'x'.repeat(101)}],[{...rule,name:'x'.repeat(121)}],[{...rule,description:'x'.repeat(2001)}],[{...rule,enabled:'true'}],[{...rule,action:'Allow'}],[{...rule,severity:'Severe'}],[{...rule,stage:'Runtime'}],[rule,{...rule,name:'Another'}],[rule,{...rule,id:'other',name:' protect CREDENTIALS '}]])assert.throws(()=>validatePolicyRules(rules));
assert.deepEqual(validatePolicyRules([]),[]);
assert.equal(validatePolicyRules([{...rule,id:' local ',name:' Local name '}])[0].id,'local');
const local={...rule,name:'Local credentials'},effective=effectivePolicyRules([local],[rule]);
assert.deepEqual(effective.map(r=>r.id),['global:protect-credentials','agent:protect-credentials']);
assert.equal(effective[0].name,'Global · Protect credentials');assert.equal(effective[1].name,'Local credentials');assert.equal(rule.id,'protect-credentials');
for(const globalPolicies of [null,[],{...defaults,revision:0},{...defaults,revision:1.5},{...defaults,revision:Number.MAX_SAFE_INTEGER+1},{...defaults,updatedAt:'bad'},{...defaults,updatedBy:''},{...defaults,rules:[{...rule,extra:true}]}])assert.equal(isUsableSnapshot({...seed,globalPolicies}),false);

const realWindow=globalThis.window,realStorage=globalThis.localStorage;
let persisted=JSON.stringify(legacy);globalThis.window={};globalThis.localStorage={getItem:()=>persisted,setItem:(_key,value)=>{persisted=value}};
try{
 const service=createMockService();let state=await service.load();
 assert.deepEqual(state.globalPolicies,migrated.globalPolicies);assert.deepEqual(JSON.parse(persisted).globalPolicies,state.globalPolicies);
 const history=structuredClone({runs:state.runs,policies:state.policies,approvals:state.approvals,definitions:state.definitions});
 const draft={expectedRevision:1,rules:[{...rule,description:'Require masking of credentials in every input.'}]};
 const unchanged=JSON.stringify(state);
 for(const user of state.users.filter(u=>u.role!=='Owner'))await assert.rejects(()=>service.saveGlobalPolicies(draft,user.id),/workspace owner/);
 await assert.rejects(()=>service.saveGlobalPolicies({...draft,rules:[{...rule,unexpected:1}]},'u-owner'),/unsupported/);
 await assert.rejects(()=>service.saveGlobalPolicies({...draft,expectedRevision:0},'u-owner'),/revision/);
 assert.equal(JSON.stringify(await service.load()),unchanged);
 await service.saveGlobalPolicies(draft,'u-owner');state=await service.load();
 assert.equal(state.globalPolicies.revision,2);assert.equal(state.globalPolicies.updatedBy,'u-owner');assert.deepEqual(state.globalPolicies.rules,draft.rules);
 assert(state.audit.some(event=>event.actorId==='u-owner'&&event.action==='Global policies saved'&&event.target==='global-policies'&&event.outcome==='Revision 2 · 1 rules'));
 assert.deepEqual(JSON.parse(persisted).globalPolicies,state.globalPolicies);
 for(const key of Object.keys(history))assert.deepEqual(state[key],history[key]);
 const afterSave=JSON.stringify(state);await assert.rejects(()=>service.saveGlobalPolicies(draft,'u-owner'),/changed after/);assert.equal(JSON.stringify(await service.load()),afterSave);
 for(const user of state.users)assert.deepEqual(scopeStore(state,user).globalPolicies,state.globalPolicies);
 const sme=state.users.find(u=>u.id==='u-sme');assert(scopeStore(state,sme).agents.every(a=>sme.agentIds.includes(a.id)));

 // Parsed agent YAML uses the existing configuration save path, with local rules only.
 const agent=state.agents.find(a=>a.id==='a-support'),definition=state.definitions.find(d=>d.agentId===agent.id),configuration=configurationFrom(agent,definition);
 configuration.definition.guardrails=[{...rule,id:'agent-local',name:'Local saved YAML rule',action:'Flag'}];
 await service.saveAgentConfiguration(agent.id,configuration,'u-admin');state=await service.load();
 assert.deepEqual(state.definitions.find(d=>d.agentId===agent.id).guardrails,configuration.definition.guardrails);
 assert.deepEqual(state.agents.find(a=>a.id===agent.id).policies,['Local saved YAML rule']);
 assert.deepEqual(state.globalPolicies.rules,draft.rules);assert.equal(state.globalPolicies.revision,2);
 await service.saveGlobalPolicies({expectedRevision:2,rules:[]},'u-owner');
 assert.deepEqual((await service.load()).globalPolicies.rules,[]);assert.deepEqual((await createMockService().load()).globalPolicies.rules,[]);
}finally{if(realWindow===undefined)delete globalThis.window;else globalThis.window=realWindow;if(realStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=realStorage}

// External API data is authoritative. Identity is server-derived on writes.
const originalFetch=globalThis.fetch,requests=[];
const collections={'agents':'agents','runs':'runs','tool-calls':'toolCalls','policy-events':'policies','approvals':'approvals','users':'users','assignments':'assignments','audit-events':'audit','connectors':'connectors','agent-definitions':'definitions','global-policies':'globalPolicies'};
try{
 globalThis.fetch=async(url,options)=>{requests.push({url,options});return Response.json(options.method==='POST'?{ok:true}:empty[collections[new URL(url).pathname.split('/').at(-1)]])};
 const api=createFastApiService('https://api.example.test/'),loaded=await api.load();assert.deepEqual(loaded.globalPolicies,empty.globalPolicies);
 await api.saveGlobalPolicies({expectedRevision:7,rules:[rule]},'untrusted-browser-role');
 const posted=requests.at(-1);assert.equal(posted.url,'https://api.example.test/api/global-policies');assert.equal(posted.options.method,'POST');assert.equal(posted.options.credentials,'include');assert.deepEqual(JSON.parse(posted.options.body),{expectedRevision:7,rules:[rule]});
 assert(requests.some(r=>r.url.endsWith('/api/global-policies')&&r.options.method==='GET'));
}finally{globalThis.fetch=originalFetch}
console.log('Policy service passed: defaults, safe migration, strict validation, namespace isolation, Owner permissions, revisions, audit, persistence, scope, local saves, and FastAPI boundary.');
