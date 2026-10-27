import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const root=resolve('.'),out=resolve('.sites-runtime/governance-server-tests');await mkdir(out,{recursive:true});
const pending=[];globalThis.testWaitUntil=p=>pending.push(p);
const sql=new DatabaseSync(':memory:');sql.exec(await readFile('drizzle/0000_redundant_aaron_stack.sql','utf8'));
function statement(query,values=[]){return {query,values,bind(...next){return statement(query,next)},async first(){return sql.prepare(query).get(...values)||null},async all(){return {results:sql.prepare(query).all(...values)}},async run(){return {meta:sql.prepare(query).run(...values)}}}}
globalThis.testEnv={DB:{prepare:statement,async batch(statements){sql.exec('BEGIN');try{const results=statements.map(s=>{const q=sql.prepare(s.query);if(/^SELECT/i.test(s.query))return {results:q.all(...s.values),meta:{changes:0}};return {results:[],meta:q.run(...s.values)}});sql.exec('COMMIT');return results}catch(e){sql.exec('ROLLBACK');throw e}}},NEBIUS_API_KEY:'fixture-key'};
await writeFile(resolve(out,'cloudflare.mjs'),'export const env=globalThis.testEnv;export const waitUntil=globalThis.testWaitUntil;');
async function compile(path){const output=resolve(out,relative(root,path).replace(/\.ts$/,'.mjs'));await mkdir(dirname(output),{recursive:true});const original=await readFile(path,'utf8');let code=path.endsWith('.ts')?ts.transpileModule(original,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText:original;code=code.replace(/(['"])(\.\.?\/[^'"]+)\1/g,(all,q,p)=>/\.[a-z]+$/.test(p)?all:q+p+'.mjs'+q).replace(/(['"])cloudflare:workers\1/g,JSON.stringify(pathToFileURL(resolve(out,'cloudflare.mjs')).href));await writeFile(output,code);return import(pathToFileURL(output))}
async function tree(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,e.name);if(e.isDirectory())await tree(p);else if(/\.(ts|mjs)$/.test(e.name)){const output=resolve(out,relative(root,p).replace(/\.ts$/,'.mjs'));await mkdir(dirname(output),{recursive:true});let c=await readFile(p,'utf8');if(e.name.endsWith('.ts'))c=ts.transpileModule(c,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;c=c.replace(/(['"])(\.\.?\/[^'"]+)\1/g,(all,q,p)=>/\.[a-z]+$/.test(p)?all:q+p+'.mjs'+q).replace(/(['"])cloudflare:workers\1/g,JSON.stringify(pathToFileURL(resolve(out,'cloudflare.mjs')).href));await writeFile(output,c)}}}
await tree(resolve('lib'));
const workspace=await compile(resolve('app/api/governance/workspace/route.ts')),keys=await compile(resolve('app/api/governance/keys/route.ts')),ingest=await compile(resolve('app/api/telemetry/v1/traces/route.ts')),evidence=await compile(resolve('app/api/governance/evidence/route.ts')),agentRoute=await compile(resolve('app/api/agent-run/route.ts'));
const {mutateWorkspace,workspaceIdentity}=await import(pathToFileURL(resolve(out,'lib/governance/server-store.mjs')));
const {verifyEvidence}=await import(pathToFileURL(resolve(out,'lib/governance/integrity.mjs')));
const req=(path,body,cookie='',extra={})=>new Request('https://lumen.test'+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',origin:'https://lumen.test',...(cookie?{cookie}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
const first=await workspace.GET(req('/api/governance/workspace'));assert.equal(first.status,200);const cookie=first.headers.get('set-cookie').split(';')[0];let store=(await first.json()).store;assert(store.agents.length>=7);
assert.equal((await workspace.POST(req('/api/governance/workspace',{action:'tick',args:[]}))).status,401);
assert.equal((await workspace.GET(req('/api/governance/workspace',undefined,cookie,{origin:'https://evil.test'}))).status,403);
const other=await workspace.GET(req('/api/governance/workspace'));const otherCookie=other.headers.get('set-cookie').split(';')[0];assert.notEqual(cookie,otherCookie);
const keyResult=await keys.POST(req('/api/governance/keys',{action:'create',name:'QA connector',agentId:'a-support',days:7},cookie));assert.equal(keyResult.status,200);const key=await keyResult.json();assert(!JSON.stringify(await (await keys.GET(req('/api/governance/keys',undefined,cookie))).json()).includes(key.secret));
const ns=ms=>String(BigInt(ms)*1000000n),now=Date.now()-1000,attr=(key,value)=>({key,value:typeof value==='number'?{intValue:String(value)}:{stringValue:value}}),trace='a'.repeat(32);
const span=(id,parent='',overrides={})=>({traceId:trace,spanId:id.repeat(16),parentSpanId:parent?parent.repeat(16):'',name:parent?'crm_lookup':'External account review',startTimeUnixNano:ns(now),endTimeUnixNano:ns(now+400),status:{code:1},attributes:[attr('gen_ai.operation.name',parent?'execute_tool':'invoke_agent'),...(parent?[attr('gen_ai.tool.name','crm_lookup')]:[]),attr('lumen.summary','Fetched permitted account context. secret=sk-12345678901234567890')],...overrides});
const envelope=spans=>({resourceSpans:[{resource:{attributes:[attr('lumen.agent.id','a-support')]},scopeSpans:[{spans}]}]});
const send=body=>ingest.POST(req('/api/telemetry/v1/traces',body,'',{authorization:'Bearer '+key.secret}));
assert.equal((await ingest.POST(req('/api/telemetry/v1/traces',envelope([span('1')])))).status,401);
assert.equal((await send(envelope([span('1','',{endTimeUnixNano:undefined})]))).status,200);
assert.equal((await send(envelope([span('2','1')]))).status,200);
assert.equal((await send(envelope([span('1')]))).status,200);
const duplicate=await (await send(envelope([span('1'),span('2','1')]))).json();assert.equal(duplicate.lumen.accepted,0);assert.equal(duplicate.lumen.duplicates,2);
assert.equal((await send(envelope([span('1','',{name:'Changed after completion'})]))).status,409);
assert.equal((await send({resourceSpans:[{resource:{attributes:[attr('lumen.agent.id','a-finance')]},scopeSpans:[{spans:[span('1')]}]}]})).status,400);
store=(await (await workspace.GET(req('/api/governance/workspace',undefined,cookie))).json()).store;
const external=store.runs.find(r=>r.traceId===trace);assert.equal(external.status,'Success');assert.equal(external.steps.length,2);assert.equal(store.toolCalls.filter(t=>t.runId===external.id).length,1);assert(!JSON.stringify(external).includes('sk-123'));
const otherStore=(await (await workspace.GET(req('/api/governance/workspace',undefined,otherCookie))).json()).store;assert(!otherStore.runs.some(r=>r.id===external.id));
// Actual framework callback payloads must satisfy the same authenticated ingestion contract.
try{const python=JSON.parse(await readFile(resolve(out,'python-telemetry.json'),'utf8'));for(const payload of python){const response=await send(payload);assert.equal(response.status,200,await response.clone().text())}}catch(error){if(error.code!=='ENOENT')throw error}
const identity=await workspaceIdentity(req('/',undefined,cookie));
await Promise.all(Array.from({length:4},(_,i)=>mutateWorkspace(identity.id,'test','Concurrent assignment',String(i),async s=>{await new Promise(r=>setTimeout(r,4));s.audit.unshift({id:'concurrent-'+i,actorId:'u-owner',action:'QA concurrent mutation',target:String(i),at:new Date().toISOString(),outcome:'Persisted'})})));
store=(await (await workspace.GET(req('/api/governance/workspace',undefined,cookie))).json()).store;assert.equal(store.audit.filter(a=>a.id.startsWith('concurrent-')).length,4);
// Actual route and engine: isolate the provider with deterministic responses.
globalThis.fetch=async(url,init)=>{const body=JSON.parse(init.body);let content='Account evidence reviewed. Verify both payment references, then draft an empathetic reply.';if(body.messages[0].content.startsWith('You are a policy evaluator')){const context=JSON.parse(body.messages[1].content);content=JSON.stringify({checks:context.rules.map(r=>({id:r.id,violated:false,summary:'No violation in this recorded context.'}))})}return Response.json({choices:[{message:{content},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})};
const agent=store.agents.find(a=>a.id==='a-lumen-demo'),definition=store.definitions.find(d=>d.agentId===agent.id);
const execution=await agentRoute.POST(req('/api/agent-run',{agent,definition,globalPolicies:store.globalPolicies,input:'Review the two $29 subscription charges.'},cookie));assert.equal(execution.status,200);const events=(await execution.text()).trim().split('\n').map(JSON.parse);await Promise.all(pending);const complete=events.find(e=>e.type==='complete');assert(complete,JSON.stringify(events.at(-1)));
store=(await (await workspace.GET(req('/api/governance/workspace',undefined,cookie))).json()).store;const recorded=store.runs.find(r=>r.id===complete.result.id);assert.equal(recorded.provenance,'studio');assert.equal(recorded.status,'Success');assert.equal(recorded.steps.length,complete.result.nodes.length);assert.equal(recorded.tokens,complete.result.tokens);assert.equal(recorded.output,complete.result.output);
assert.equal((await workspace.POST(req('/api/governance/workspace',{action:'recordExecution',args:[complete.result]},cookie))).status,400);
let evidenceResponse=await evidence.GET(req('/api/governance/evidence?scope=live',undefined,cookie));assert.equal(evidenceResponse.status,200,await evidenceResponse.clone().text());const bundle=await evidenceResponse.json();assert((await verifyEvidence(bundle)).valid);assert(bundle.records.runs.some(r=>r.id===recorded.id));
const tampered=structuredClone(bundle);tampered.records.runs[0].status='Changed';await assert.rejects(()=>verifyEvidence(tampered),/digest/);const broken=structuredClone(bundle);broken.ledger[1].entry.action='changed';await assert.rejects(()=>verifyEvidence(broken),/chain/);
assert.equal((await keys.POST(req('/api/governance/keys',{action:'revoke',id:key.id},otherCookie))).status,404);assert.equal((await keys.POST(req('/api/governance/keys',{action:'revoke',id:key.id},cookie))).status,200);assert.equal((await send(envelope([span('3')]))).status,401);
// Cancelling a streaming client still produces a durable cancellation receipt.
const originalFetch=globalThis.fetch;globalThis.fetch=async(_url,init)=>new Promise((resolve,reject)=>{if(init.signal.aborted)reject(new DOMException('Aborted','AbortError'));else init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})});
const controller=new AbortController();const cancelRequest=new Request(req('/api/agent-run',{agent,definition,globalPolicies:store.globalPolicies,input:'Cancel this run after it starts.'},cookie),{signal:controller.signal});const cancelResponse=await agentRoute.POST(cancelRequest);assert.equal(cancelResponse.status,200);controller.abort();const cancelEvents=(await cancelResponse.text()).trim().split('\n').map(JSON.parse);await Promise.all(pending);globalThis.fetch=originalFetch;
const cancelled=cancelEvents.find(e=>e.type==='complete');assert(cancelled,JSON.stringify(cancelEvents));assert.equal(cancelled.result.status,'Cancelled');const cancelStore=(await (await workspace.GET(req('/api/governance/workspace',undefined,cookie))).json()).store;assert.equal(cancelStore.runs.find(r=>r.id===cancelled.result.id).executionStatus,'Cancelled');
await writeFile(resolve(out,'evidence.json'),JSON.stringify(bundle,null,2));
// Studio edits and Governance reads share the exact persisted agent/definition records.
const {configurationFrom}=await import(pathToFileURL(resolve(out,'lib/governance/definitions.mjs')));
const readShared=async()=> (await (await workspace.GET(req('/api/governance/workspace',undefined,cookie))).json()).store;
const saveShared=draft=>workspace.POST(req('/api/governance/workspace',{action:'saveAgentConfiguration',args:['a-lumen-demo',draft,'u-owner']},cookie));
let shared=await readShared();
const config=s=>configurationFrom(s.agents.find(a=>a.id==='a-lumen-demo'),s.definitions.find(d=>d.agentId==='a-lumen-demo'));
const before=config(shared),history=structuredClone(shared.runs.filter(r=>r.agentId==='a-lumen-demo'));
const changed=structuredClone(before),firstEdge=changed.definition.edges[0];
changed.agent.name='Customer resolution workflow';changed.agent.description='Updated in Studio and inspected in Governance.';
changed.definition.model.temperature=.35;changed.definition.prompt.goal='Verify the billing discrepancy and prepare a response.';
changed.definition.memory.maxItems=23;changed.definition.limits.retries=2;
const main=changed.definition.nodes.find(n=>n.kind==='Agent');main.label='Billing investigator';main.prompt='Check payment references before drafting the reply.';
changed.definition.nodes.push({id:'qa-review-node',kind:'Sub-agent',label:'Evidence reviewer',description:'Review account evidence.',prompt:'Identify missing payment references.',enabled:true});
changed.definition.edges=changed.definition.edges.filter(e=>e.id!==firstEdge.id);
changed.definition.edges.push({id:'qa-edge-in',source:firstEdge.source,target:'qa-review-node',label:'Review evidence'},{id:'qa-edge-out',source:'qa-review-node',target:firstEdge.target,label:'Reviewed context'});
let saved=await saveShared(changed);assert.equal(saved.status,200,await saved.clone().text());assert(Number.isInteger((await saved.json()).revision));
shared=await readShared();let actual=config(shared);assert.deepEqual(actual,{...changed,expectedRevision:before.expectedRevision+1});
assert.deepEqual(shared.runs.filter(r=>r.agentId==='a-lumen-demo'),history,'Editing a graph must not rewrite historical execution nodes');
assert.equal((await saveShared(changed)).status,409,'A stale tab cannot overwrite the new revision');
// Label/prompt edits, disabled nodes, and connection labels survive another server read.
let edited=structuredClone(actual);edited.definition.nodes.find(n=>n.id==='qa-review-node').prompt='Verify both charge identifiers.';
edited.definition.nodes.find(n=>n.id==='qa-review-node').enabled=false;edited.definition.edges.find(e=>e.id==='qa-edge-in').label='Bypass disabled reviewer';
assert.equal((await saveShared(edited)).status,200);shared=await readShared();actual=config(shared);
assert.deepEqual(actual,{...edited,expectedRevision:edited.expectedRevision+1});
// Invalid graph mutations fail atomically, including dangling endpoints and cycles.
for(const edge of [{id:'dangling',source:'qa-review-node',target:'deleted-node',label:''},{id:'cycle',source:firstEdge.target,target:firstEdge.source,label:''}]){
 const bad=structuredClone(actual);bad.definition.edges.push(edge);bad.agent.name='Must not be persisted';
 assert.equal((await saveShared(bad)).status,409);assert.deepEqual(config(await readShared()),actual);
}
// Node deletion and incident-edge deletion are saved together, with no resurrection on refresh.
const removed=structuredClone(actual);removed.definition.nodes=removed.definition.nodes.filter(n=>n.id!=='qa-review-node');
removed.definition.edges=removed.definition.edges.filter(e=>e.source!=='qa-review-node'&&e.target!=='qa-review-node');removed.definition.edges.push({...firstEdge,label:'Restored direct route'});
assert.equal((await saveShared(removed)).status,200);shared=await readShared();actual=config(shared);
assert.deepEqual(actual,{...removed,expectedRevision:removed.expectedRevision+1});
assert(!actual.definition.nodes.some(n=>n.id==='qa-review-node'));assert(!actual.definition.edges.some(e=>e.id.startsWith('qa-edge')));
assert(shared.audit.some(a=>a.action==='Agent configuration saved'&&a.outcome.includes('connections')&&a.outcome.includes('−1')));
// Two writers starting at the same revision cannot silently lose an edit.
const left=structuredClone(actual),right=structuredClone(actual);left.agent.name='Concurrent left';right.agent.name='Concurrent right';
const competing=await Promise.all([saveShared(left),saveShared(right)]);assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);
const winner=competing[0].status===200?left:right;shared=await readShared();assert.deepEqual(config(shared),{...winner,expectedRevision:actual.expectedRevision+1});
assert.deepEqual(shared.runs.filter(r=>r.agentId==='a-lumen-demo'),history);
const isolated=(await (await workspace.GET(req('/api/governance/workspace',undefined,otherCookie))).json()).store;
assert.notEqual(config(isolated).agent.name,winner.agent.name);
// Hosted dashboard refresh/tick must not invent additional model activity.
const historyCount=shared.runs.filter(r=>r.source!=='live').length,historySequence=shared.sequence;
assert.equal((await workspace.POST(req('/api/governance/workspace',{action:'tick',args:[]},cookie))).status,200);
const refreshed=await readShared();assert.equal(refreshed.sequence,historySequence);assert.equal(refreshed.runs.filter(r=>r.source!=='live').length,historyCount);
console.log('PASS: workspace isolation, CSRF, scoped/revoked keys, OTLP retries/order/conflicts, concurrent writes, server-recorded execution, signed export, and tamper detection.');
console.log('PASS: Studio → Governance exact configuration mapping; node/edge add/edit/delete; dangling/cyclic graph rejection; atomic concurrent saves; historical runs preserved.');
