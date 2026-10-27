import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import ts from 'typescript';
const dir=new URL('../.sites-runtime/execution-tests/',import.meta.url);
for(const name of ['agent-execution','governance'])await mkdir(new URL(name+'/',dir),{recursive:true});
for(const name of ['agent-execution/engine','governance/definitions','governance/end-to-end-demo','governance/policy-config']){
 const source=await readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8');
 const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
 await writeFile(new URL(name+'.mjs',dir),outputText.replace("from './end-to-end-demo'","from './end-to-end-demo.mjs'").replace("from './policy-config'","from './policy-config.mjs'").replace("from '../governance/definitions'","from '../governance/definitions.mjs'").replace("from '../governance/policy-config'","from '../governance/policy-config.mjs'"));
}
await writeFile(new URL('models.mjs',dir),await readFile(new URL('../lib/models.mjs',import.meta.url)));
const {executeAgent,validateExecutionRequest}=await import(new URL('agent-execution/engine.mjs',dir));
const {createDefinition}=await import(new URL('governance/definitions.mjs',dir));
const baseAgent={id:'test',name:'Test agent',description:'A workflow test.',framework:'Custom',environment:'Staging',status:'Active',ownerId:'owner',risk:'Low',connectorId:'connector',reviewerIds:[],policies:[],tools:['crm_lookup'],lastActive:new Date().toISOString()};
const node=(id,kind,prompt='')=>({id,label:id,kind,prompt,description:'Test '+id,enabled:true});
function request(){const agent=structuredClone(baseAgent),definition=createDefinition(agent);definition.guardrails=[];definition.limits.requireApproval=false;definition.nodes=[node('input','Input'),node('agent','Agent'),node('left','Sub-agent'),node('right','Sub-agent'),node('output','Output')];definition.edges=[['input','agent'],['agent','left'],['agent','right'],['left','output'],['right','output']].map(([source,target],i)=>({id:String(i),source,target,label:'handoff'}));return {agent,definition,input:'Please run the task.'};}
const events=[],calls=[];
const invoke=async call=>{calls.push(call);return {text:'Result for '+call.system.match(/Node role: (.+)/)[1],tokens:12}};
let result=await executeAgent(request(),{signal:new AbortController().signal,invoke,emit:e=>events.push(e)});
assert.equal(result.status,'Success');assert.equal(result.nodes.length,5);assert.equal(result.tokens,36);assert.equal(result.costKnown,false);assert.equal(calls.length,3);assert.match(result.output,/Result for left/);assert.match(result.output,/Result for right/);assert.match(calls[1].input,/Result for agent/);assert.equal(events[0].type,'start');assert.equal(events.at(-1).type,'complete');
assert.deepEqual(result.tokenUsage,{generation:36,policy:0});assert.deepEqual(result.nodes.find(n=>n.nodeId==='agent').tokenUsage,{generation:12,policy:0});
assert(!Object.hasOwn(result,'globalPolicyRevision'),'Legacy requests do not gain a fabricated global-policy revision.');
assert.equal(result.nodes.at(-1).output,result.nodes.at(-1).input);assert.deepEqual(result.nodes.at(-1).tokenUsage,{generation:0,policy:0});assert.match(result.nodes.at(-1).summary,/no additional text was generated/);
// Disabled nodes preserve graph connectivity without invoking a model.
let req=request();req.definition.nodes.find(n=>n.id==='left').enabled=false;calls.length=0;
result=await executeAgent(req,{signal:new AbortController().signal,invoke});assert.equal(calls.length,2);assert.equal(result.nodes.find(n=>n.nodeId==='left').status,'Skipped');assert.equal(result.nodes.find(n=>n.nodeId==='left').output,'Result for agent');
// Isolated node tests execute only the selected role, with the supplied test input.
req=request();req.nodeId='right';calls.length=0;result=await executeAgent(req,{signal:new AbortController().signal,invoke});assert.equal(result.mode,'node');assert.equal(result.nodes.length,1);assert.equal(calls.length,1);assert.match(calls[0].input,/Please run the task/);
// Input is a pass-through operation. Its model usage, if any, is only actual
// configured policy evaluation; the receipt must not imply generated text.
req=request();req.nodeId='input';
result=await executeAgent(req,{signal:new AbortController().signal,invoke:async()=>assert.fail('An Input node without policies does not call the model')});
assert.equal(result.output,req.input);assert.equal(result.tokens,0);assert.deepEqual(result.tokenUsage,{generation:0,policy:0});assert.deepEqual(result.nodes[0].policyChecks,[]);assert.match(result.nodes[0].summary,/input unchanged; no text was generated/);assert.match(result.nodes[0].summary,/No enabled policy rules applied/);
const inputRule={id:'input-scope',name:'Input scope',description:'Check the supplied task scope.',enabled:true,action:'Block',severity:'High',stage:'Input'};
req.definition.guardrails=[inputRule];let policyCalls=0;
result=await executeAgent(req,{signal:new AbortController().signal,invoke:async call=>{policyCalls++;assert.equal(call.purpose,'policy');return {text:JSON.stringify({checks:[{id:'input-scope',violated:false,summary:'Allowed task.\n Contact reviewer@example.test.'}]}),tokens:418}}});
assert.equal(policyCalls,1);assert.equal(result.output,req.input);assert.equal(result.tokens,418);assert.deepEqual(result.tokenUsage,{generation:0,policy:418});assert.deepEqual(result.nodes[0].tokenUsage,{generation:0,policy:418});
assert.deepEqual(result.nodes[0].policyChecks,[{id:'input-scope',rule:'Input scope',stage:'Input',action:'Block',violated:false,summary:'Allowed task. Contact [email redacted].'}]);assert.deepEqual(result.policies,[]);assert.match(result.nodes[0].summary,/1 policy check completed; no violations found/);
// Agent generation and preceding policy calls retain separate usage totals.
req.nodeId='agent';
result=await executeAgent(req,{signal:new AbortController().signal,invoke:async call=>call.purpose==='policy'?{text:'{"checks":[{"id":"input-scope","violated":false,"summary":"Allowed task."}]}',tokens:11}:{text:'A generated response.',tokens:12}});
assert.equal(result.output,'A generated response.');assert.equal(result.tokens,23);assert.deepEqual(result.tokenUsage,{generation:12,policy:11});assert.deepEqual(result.nodes[0].tokenUsage,result.tokenUsage);
// An isolated Guardrail evaluates all enabled stages once, records their
// actual results, and neither modifies context nor invents a pass without rules.
req=request();req.nodeId='left';req.definition.nodes.find(n=>n.id==='left').kind='Guardrail';
req.definition.guardrails=[inputRule,{...inputRule,id:'tool-scope',name:'Tool scope',stage:'Tool',action:'Require approval'},{...inputRule,id:'output-scope',name:'Output scope',stage:'Output',action:'Flag'}];policyCalls=0;
result=await executeAgent(req,{signal:new AbortController().signal,invoke:async call=>{policyCalls++;assert.equal(call.purpose,'policy');const data=JSON.parse(call.input);assert.equal(data.rules.length,3);return {text:JSON.stringify({checks:data.rules.map(r=>({id:r.id,violated:false,summary:'No violation found.'}))}),tokens:30}}});
assert.equal(policyCalls,1);assert.equal(result.status,'Success');assert.equal(result.output,req.input);assert.deepEqual(result.tokenUsage,{generation:0,policy:30});assert.deepEqual(result.nodes[0].policyChecks.map(c=>[c.id,c.stage,c.action]),[['input-scope','Input','Block'],['tool-scope','Tool','Require approval'],['output-scope','Output','Flag']]);assert.match(result.nodes[0].summary,/3 policy checks completed; no violations found/);
req.definition.guardrails=[{...inputRule,action:'Flag'}];
result=await executeAgent(req,{signal:new AbortController().signal,invoke:async()=>({text:'{"checks":[{"id":"input-scope","violated":true,"summary":"Scope concern flagged."}]}',tokens:8})});
assert.equal(result.status,'Success');assert.equal(result.nodes[0].policyChecks[0].violated,true);assert.match(result.nodes[0].summary,/1 violation recorded/);assert.doesNotMatch(result.nodes[0].summary,/no violations|checks passed/);
req.definition.guardrails=[{...inputRule,enabled:false}];
result=await executeAgent(req,{signal:new AbortController().signal,invoke:async()=>assert.fail('No enabled rules means no policy call')});
assert.equal(result.output,req.input);assert.deepEqual(result.nodes[0].policyChecks,[]);assert.deepEqual(result.tokenUsage,{generation:0,policy:0});assert.match(result.nodes[0].summary,/No enabled policy rules applied/);
// Memory describes only transformations actually performed by local code.
req=request();req.nodeId='left';req.definition.nodes.find(n=>n.id==='left').kind='Memory';req.definition.memory={enabled:true,strategy:'Session',scope:'Run',retentionDays:0,maxItems:3,redactPII:true};req.input='Old line\nContact person@example.test\nCard 4111 1111 1111 1111\nKeep this line';
result=await executeAgent(req,{signal:new AbortController().signal,invoke:async()=>assert.fail('Memory transformations are local')});
assert.equal(result.output,'Contact [email redacted]\nCard [identifier redacted]\nKeep this line');assert.deepEqual(result.tokenUsage,{generation:0,policy:0});assert.match(result.nodes[0].summary,/Matching identifiers were redacted/);assert.match(result.nodes[0].summary,/last 3 of 4 lines/);assert.doesNotMatch(result.nodes[0].summary,/passed through unchanged/);
req.input='Keep this line';result=await executeAgent(req,{signal:new AbortController().signal,invoke:async()=>assert.fail('Memory transformations are local')});
assert.equal(result.output,req.input);assert.match(result.nodes[0].summary,/No matching identifiers needed redaction/);assert.match(result.nodes[0].summary,/Retained all 1 line/);assert.match(result.nodes[0].summary,/Text passed through unchanged/);
// Output policies can consume model tokens while the supplied context remains
// the exact output; Output itself does not perform another generation.
req=request();req.nodeId='output';req.definition.guardrails=[{...inputRule,stage:'Output'}];
result=await executeAgent(req,{signal:new AbortController().signal,invoke:async call=>{assert.equal(call.purpose,'policy');return {text:'{"checks":[{"id":"input-scope","violated":false,"summary":"Allowed output."}]}',tokens:14}}});
assert.equal(result.output,req.input);assert.deepEqual(result.tokenUsage,{generation:0,policy:14});assert.equal(result.nodes[0].policyChecks[0].stage,'Output');assert.match(result.nodes[0].summary,/Returned incoming context unchanged; no additional text was generated/);
// Inherited global rules apply before the agent role runs, without mutating or
// copying them into the saved agent definition. Legacy rule IDs stay unchanged.
req=request();req.globalPolicies={revision:4,rules:[inputRule]};const inheritedBefore=structuredClone(req);let inheritedCalls=0;
result=await executeAgent(req,{signal:new AbortController().signal,invoke:async call=>{inheritedCalls++;assert.equal(call.purpose,'policy');assert.deepEqual(JSON.parse(call.input).rules.map(r=>r.id),['global:input-scope']);return {text:'{"checks":[{"id":"global:input-scope","violated":true,"summary":"Protected input blocked."}]}',tokens:7}}});
assert.equal(inheritedCalls,1);assert.equal(result.status,'Blocked');assert.equal(result.globalPolicyRevision,4);assert.equal(result.nodes.length,1);assert.equal(result.nodes[0].output,'');assert.equal(result.nodes[0].policyChecks[0].rule,'Global · Input scope');assert.deepEqual(result.tokenUsage,{generation:0,policy:7});assert.deepEqual(req,inheritedBefore);
// Global approval gates precede tool execution; a Flag records the concern and
// permits the existing local tool operation, without silently elevating either.
req=request();req.nodeId='left';Object.assign(req.definition.nodes.find(n=>n.id==='left'),{kind:'Tool',toolName:'crm_lookup'});req.globalPolicies={revision:5,rules:[{...inputRule,id:'tool-review',stage:'Tool',action:'Require approval'}]};
const globalToolCheck=async call=>{assert.equal(call.purpose,'policy');const context=JSON.parse(call.input);assert.deepEqual(context.node,{id:'left',label:'left',kind:'Tool',toolName:'crm_lookup',executionMode:'local_function'});assert.equal(context.toolsExternalConnected,false);return {text:'{"checks":[{"id":"global:tool-review","violated":true,"summary":"Tool action needs review."}]}',tokens:9}};
result=await executeAgent(req,{signal:new AbortController().signal,invoke:globalToolCheck});assert.equal(result.status,'Awaiting approval');assert.equal(result.nodes[0].output,'');assert.equal(result.nodes[0].policyChecks[0].action,'Require approval');assert.doesNotMatch(result.nodes[0].summary,/function completed/);
req.globalPolicies.rules[0].action='Flag';result=await executeAgent(req,{signal:new AbortController().signal,invoke:globalToolCheck});assert.equal(result.status,'Success');assert.equal(JSON.parse(result.output).execution,'local_function');assert.equal(result.policies[0].action,'Flag');assert.equal(result.globalPolicyRevision,5);
// Namespace collisions cannot replace local rules, and Block takes precedence
// over approval when both independent checks report a violation.
req=request();req.nodeId='input';req.definition.guardrails=[inputRule];req.globalPolicies={revision:6,rules:[{...inputRule,action:'Require approval'}]};
result=await executeAgent(req,{signal:new AbortController().signal,invoke:async call=>{const rules=JSON.parse(call.input).rules;assert.deepEqual(rules.map(r=>r.id),['global:input-scope','agent:input-scope']);return {text:JSON.stringify({checks:rules.map(r=>({id:r.id,violated:true,summary:'Scope rule violated.'}))}),tokens:15}}});
assert.equal(result.status,'Blocked');assert.deepEqual(result.nodes[0].policyChecks.map(c=>[c.id,c.action]),[['global:input-scope','Require approval'],['agent:input-scope','Block']]);assert.equal(result.policies.length,2);
req=request();req.nodeId='input';req.globalPolicies={revision:7,rules:[]};
result=await executeAgent(req,{signal:new AbortController().signal,invoke:async()=>assert.fail('An explicitly empty global configuration adds no model checks')});assert.equal(result.globalPolicyRevision,7);assert.deepEqual(result.nodes[0].policyChecks,[]);
for(const globalPolicies of [null,{revision:0,rules:[]},{revision:1.5,rules:[]},{revision:Number.MAX_SAFE_INTEGER+1,rules:[]},{revision:1},{revision:1,rules:Array.from({length:31},(_,i)=>({...inputRule,id:'rule-'+i}))},{revision:1,rules:[{...inputRule,stage:'Other'}]}]){
 const invalid=request();invalid.globalPolicies=globalPolicies;assert.throws(()=>validateExecutionRequest(invalid),/global|policy|rules|guardrail|revision/i);
}
req=request();req.globalPolicies={revision:8,rules:[inputRule],updatedBy:'owner',yaml:'not part of the execution contract'};assert.deepEqual(validateExecutionRequest(req).globalPolicies,{revision:8,rules:[inputRule]});
// Policy violations stop before an agent/tool runs. Malformed policy JSON fails closed.
req=request();req.definition.guardrails=[{id:'privacy',name:'Privacy rule',description:'Never disclose identifiers.',enabled:true,action:'Block',severity:'High',stage:'Input'}];
result=await executeAgent(req,{signal:new AbortController().signal,invoke:async call=>{assert.equal(call.purpose,'policy');return {text:JSON.stringify({checks:[{id:'privacy',violated:true,summary:'Identifier disclosed.'}]}),tokens:5}}});
assert.equal(result.status,'Blocked');assert.equal(result.nodes.length,1);assert.equal(result.policies[0].rule,'Privacy rule');assert.equal(result.tokens,5);
assert.deepEqual(result.tokenUsage,{generation:0,policy:5});assert.equal(result.nodes[0].policyChecks[0].violated,true);
req.definition.guardrails[0].action='Require approval';result=await executeAgent(req,{signal:new AbortController().signal,invoke:async()=>({text:'{"checks":[{"id":"privacy","violated":true,"summary":"Review needed."}]}',tokens:2})});assert.equal(result.status,'Awaiting approval');
result=await executeAgent(req,{signal:new AbortController().signal,invoke:async()=>({text:'{"checks":[]}',tokens:2})});assert.equal(result.status,'Failed');assert.match(result.output,/omitted a rule/);
assert.deepEqual(result.nodes[0].policyChecks,[]);assert.deepEqual(result.tokenUsage,{generation:0,policy:2});
// Local tool functions report completed execution without claiming an external action.
const originalFetch=globalThis.fetch;
try{
 globalThis.fetch=async()=>assert.fail('Tool functions must not contact an external endpoint');
 for(const tool of ['crm_lookup','database_query','web_search','email_draft','ticket_create']){
  req=request();req.agent.tools=[tool];Object.assign(req.definition.nodes.find(n=>n.id==='left'),{kind:'Tool',toolName:tool});req.nodeId='left';
  result=await executeAgent(req,{signal:new AbortController().signal,invoke:async()=>assert.fail('Local tool function does not call a model')});
  const payload=JSON.parse(result.output);
  assert.equal(result.status,'Success');assert.equal(result.nodes[0].status,'Success');assert.equal(result.nodes[0].toolMode,'demo');
  assert.equal(payload.status,'success');assert.equal(payload.execution,'local_function');assert.equal(payload.runtime,'TypeScript');assert.equal(payload.tool,tool);
  assert.match(result.nodes[0].summary,/^Success — .+ function completed\.$/);
  assert.doesNotMatch(result.output,/\b(?:demo|dummy)\b/i);
  if(tool==='crm_lookup'){assert.equal(payload.record.case,'CASE-1042');assert.equal(payload.source,'Local sample data')}
  if(tool==='database_query')assert.equal(payload.source,'Local sample data');
  if(tool==='web_search')assert.deepEqual(payload.sources,[]);
  if(tool==='email_draft')assert.equal(payload.delivery,'Not sent');
  if(tool==='ticket_create')assert.equal(payload.created,false);
 }
}finally{globalThis.fetch=originalFetch}
// A gated or blocked tool must never claim its function completed.
req=request();req.agent.tools=['ticket_create'];req.definition.nodes.find(n=>n.id==='left').kind='Tool';req.definition.nodes.find(n=>n.id==='left').toolName='ticket_create';req.nodeId='left';req.definition.limits.requireApproval=true;
result=await executeAgent(req,{signal:new AbortController().signal,invoke:async()=>assert.fail('No model needed')});assert.equal(result.status,'Awaiting approval');assert.equal(result.nodes[0].toolMode,'demo');assert.equal(result.nodes[0].output,'');assert.doesNotMatch(result.nodes[0].summary,/Success|function completed/);assert.equal(result.output,'Ticket creation is awaiting approval. No ticket has been created.');
req.definition.limits.requireApproval=false;result=await executeAgent(req,{signal:new AbortController().signal,invoke:async()=>assert.fail('No model needed')});assert.equal(result.status,'Success');assert.equal(JSON.parse(result.output).created,false);
req.definition.guardrails=[{id:'tool-scope',name:'Tool scope',description:'Enforce permitted scope.',enabled:true,action:'Block',severity:'High',stage:'Tool'}];
result=await executeAgent(req,{signal:new AbortController().signal,invoke:async()=>({text:'{"checks":[{"id":"tool-scope","violated":true,"summary":"Outside permitted scope."}]}',tokens:2})});
assert.equal(result.status,'Blocked');assert.equal(result.nodes[0].output,'');assert.doesNotMatch(result.nodes[0].summary,/Success|function completed/);
// Cancelled requests cannot execute another node, even when a transport resolves late.
req=request();const stop=new AbortController();let resolve;let started;
const began=new Promise(r=>{started=r});const waiting=new Promise(r=>{resolve=r});
const ongoing=executeAgent(req,{signal:stop.signal,invoke:async()=>{started();return waiting}});await began;stop.abort();resolve({text:'Late response',tokens:10});result=await ongoing;assert.equal(result.status,'Cancelled');assert.equal(result.nodes.length,2);assert.equal(result.nodes.at(-1).status,'Cancelled');assert(!result.nodes.some(n=>n.nodeId==='right'));
// Retry only errors explicitly marked retryable; limits stop unfinished workflows.
req=request();req.nodeId='agent';let attempts=0;result=await executeAgent(req,{signal:new AbortController().signal,invoke:async()=>{if(++attempts===1)throw Object.assign(new Error('temporary'),{retryable:true});return {text:'Recovered',tokens:4}}});assert.equal(result.status,'Success');assert.equal(attempts,2);
req=request();req.definition.limits.maxSteps=1;result=await executeAgent(req,{signal:new AbortController().signal,invoke});assert.equal(result.status,'Failed');assert.match(result.output,/maximum number of steps/);
req=request();req.definition.edges.push({id:'cycle',source:'output',target:'input',label:''});assert.throws(()=>validateExecutionRequest(req),/acyclic/);
req=request();req.definition.model.name='https://malicious.example/model';assert.throws(()=>validateExecutionRequest(req),/model ID|model name/i);
// Imported chat IDs and approved region selections flow to every actual model
// call; linked roles use their own saved runtime, while policy checks use parent.
req=request();req.nodeId='right';req.definition.model.name='my-team/Imported-Chat:main';req.definition.model.baseUrl='https://api.tokenfactory.us-north1.nebius.com/v1/';req.definition.guardrails=[inputRule];
const linkedAgent={...structuredClone(baseAgent),id:'linked',name:'Linked specialist'};
const linkedDefinition=createDefinition(linkedAgent);linkedDefinition.model.name='my-team/Imported-Chat:specialist';linkedDefinition.model.baseUrl='https://api.tokenfactory.nebius.com/v1/';
req.references=[{agent:linkedAgent,definition:linkedDefinition}];req.definition.nodes.find(n=>n.id==='right').referencedAgentId=linkedAgent.id;
req.globalPolicies={revision:9,rules:[{...inputRule,id:'global-scope'}]};
const routedCalls=[];
result=await executeAgent(req,{signal:new AbortController().signal,invoke:async call=>{routedCalls.push(call);return call.purpose==='policy'?{text:JSON.stringify({checks:JSON.parse(call.input).rules.map(r=>({id:r.id,violated:false,summary:'Allowed task.'}))}),tokens:10}:{text:'Specialist result.',tokens:20}}});
assert.equal(result.status,'Success');assert.deepEqual(routedCalls.map(c=>[c.purpose,c.model,c.baseUrl]),[['policy','my-team/Imported-Chat:main','https://api.tokenfactory.us-north1.nebius.com/v1/'],['agent','my-team/Imported-Chat:specialist','https://api.tokenfactory.nebius.com/v1/']]);
assert.equal(result.baseUrl,req.definition.model.baseUrl);assert.equal(result.model,req.definition.model.name);assert.equal(result.nodes[0].baseUrl,linkedDefinition.model.baseUrl);assert.equal(result.nodes[0].model,linkedDefinition.model.name);
assert.deepEqual(result.nodes[0].policyChecks.map(c=>c.id),['global:global-scope','agent:input-scope']);assert.equal(result.globalPolicyRevision,9);
for(const baseUrl of ['https://attacker.example/v1/','https://api.tokenfactory.nebius.com/v1/?x=1','https://user:secret@api.tokenfactory.nebius.com/v1/']){req=request();req.definition.model.baseUrl=baseUrl;assert.throws(()=>validateExecutionRequest(req),/base URL/i)}
req=request();req.definition.nodes.find(n=>n.id==='left').referencedAgentId='missing';assert.throws(()=>validateExecutionRequest(req),/linked sub-agent is unavailable/);
req=request();req.agent.status='Paused';assert.throws(()=>validateExecutionRequest(req),/paused/);
req=request();req.input='x'.repeat(16001);assert.throws(()=>validateExecutionRequest(req),/16,000/);
console.log('Agent execution passed: DAG branches, disabled bypass, individual tests, guardrails, approvals, truthful local-tool success, cancellation, retries, limits, and validation.');
