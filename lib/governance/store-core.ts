import {createSeed} from './mock-data';
import {appendSimulationRun,retainSimulationHistory,simulationAgents,warmRecentSimulation} from './recent-simulation';
import {upgradeSnapshot,hasDefinitions,validateConfiguration,TOOL_CATALOG} from './definitions';
import {validatePolicyRules} from './policy-config';
import {normalizeNebiusBaseUrl} from '../models.mjs';
import type {Store,Service,User,Agent,ConnectorDraft,Decision,Run,TraceStep,ToolCall,PolicyEvent,Approval} from './types';
import type {ExecutionCheck,ExecutionResult,NodeExecution} from '../agent-execution/types';
const KEY='azure-governance-v1';
const nodeKinds=['Input','Agent','Sub-agent','Tool','Guardrail','Memory','Output'];
const safeTokenCount=(value:any)=>Number.isSafeInteger(value)&&value>=0;
const validPolicyRevision=(value:any)=>value===undefined||Number.isSafeInteger(value)&&value>=1;
const validRecordedBaseUrl=(value:any)=>value===undefined||!!normalizeNebiusBaseUrl(value);
const validTokenUsage=(value:any,total:any)=>value===undefined||!!value&&typeof value==='object'&&!Array.isArray(value)&&safeTokenCount(total)&&safeTokenCount(value.generation)&&safeTokenCount(value.policy)&&value.generation+value.policy===total;
const validPolicyChecks=(value:any)=>value===undefined||Array.isArray(value)&&value.length<=100&&value.every((check:any)=>check&&typeof check==='object'&&!Array.isArray(check)&&typeof check.id==='string'&&check.id.trim().length>0&&check.id.length<=200&&typeof check.rule==='string'&&check.rule.trim().length>0&&check.rule.length<=200&&['Input','Tool','Output'].includes(check.stage)&&['Block','Require approval','Flag'].includes(check.action)&&typeof check.violated==='boolean'&&typeof check.summary==='string'&&check.summary.length<=1000);
export function canManage(u:User){return u.role==='Owner'||u.role==='Admin'}
export function canAccess(u:User,agentId:string){return u.role==='Owner'||u.agentIds.includes(agentId)}
export function canReview(u:User,item:{agentId:string;assigneeId:string|null}){return canAccess(u,item.agentId)&&(canManage(u)||item.assigneeId===u.id)}
export function scopeStore(s:Store,u:User):Store{
 const access=(x:{agentId:string})=>canAccess(u,x.agentId);
 const review=(x:{agentId:string;assigneeId:string|null})=>access(x)&&(canManage(u)||x.assigneeId===u.id);
 const approvals=s.approvals.filter(review),policies=s.policies.filter(review),ids=new Set([...approvals,...policies].map(x=>x.id));
 return {...s,agents:s.agents.filter(a=>canAccess(u,a.id)),definitions:s.definitions.filter(access),runs:s.runs.filter(access),toolCalls:s.toolCalls.filter(access),approvals,policies,assignments:s.assignments.filter(a=>ids.has(a.reviewId)),audit:s.audit.filter(a=>u.role==='Owner'||(canManage(u)&&a.actorId===u.id)||(a.agentId&&canAccess(u,a.agentId)&&(canManage(u)||ids.has(a.target)))),connectors:canManage(u)?s.connectors.filter(c=>u.role==='Owner'||c.createdById===u.id||s.agents.some(a=>a.connectorId===c.id&&canAccess(u,a.id))):[]};
}
/** Validate persisted/API records before a partial or stale payload reaches the UI. */
export function isUsableSnapshot(s:any):s is Store {
 if(!s||s.version!==1||!Number.isFinite(s.sequence)||!Number.isFinite(Date.parse(s.updatedAt)))return false;
 const arrays=['agents','runs','toolCalls','policies','approvals','users','assignments','audit','connectors'];
 if(!arrays.every(k=>Array.isArray(s[k])&&s[k].every((x:any)=>x&&typeof x.id==='string')&&new Set(s[k].map((x:any)=>x.id)).size===s[k].length)||!s.users.length)return false;
 const strings=(o:any,keys:string[])=>o&&keys.every(k=>typeof o[k]==='string');
 const list=(v:any)=>Array.isArray(v)&&v.every(x=>typeof x==='string');
 if(s.globalPolicies!==undefined){const g=s.globalPolicies;if(!g||typeof g!=='object'||Array.isArray(g)||!Number.isSafeInteger(g.revision)||g.revision<1||typeof g.updatedAt!=='string'||!Number.isFinite(Date.parse(g.updatedAt))||typeof g.updatedBy!=='string'||!g.updatedBy.trim()||g.updatedBy.length>200)return false;try{validatePolicyRules(g.rules)}catch{return false}}
 if(!s.users.every((u:any)=>strings(u,['name','role'])&&['Owner','Admin','SME','Sub-admin'].includes(u.role)&&list(u.expertise)&&list(u.agentIds)&&typeof u.available==='boolean'))return false;
 if(!s.agents.every((a:any)=>strings(a,['name','description','framework','environment','status','ownerId','risk','connectorId','lastActive'])&&list(a.reviewerIds)&&list(a.policies)&&list(a.tools)))return false;
 if(!s.runs.every((r:any)=>strings(r,['agentId','task','status','at','risk'])&&Number.isFinite(r.duration)&&Number.isFinite(r.tokens)&&validTokenUsage(r.tokenUsage,r.tokens)&&validRecordedBaseUrl(r.baseUrl)&&validPolicyRevision(r.globalPolicyRevision)&&Number.isFinite(r.cost)&&Array.isArray(r.steps)&&r.steps.every((t:any)=>strings(t,['label','kind','summary','outcome'])&&Number.isFinite(t.duration)&&(t.tokens===undefined||safeTokenCount(t.tokens))&&validTokenUsage(t.tokenUsage,t.tokens)&&validRecordedBaseUrl(t.baseUrl)&&validPolicyChecks(t.policyChecks)&&(t.nodeKind===undefined||nodeKinds.includes(t.nodeKind)))))return false;
 if(!s.toolCalls.every((t:any)=>strings(t,['agentId','runId','name','at','status','risk','input','output'])&&Number.isFinite(t.latency)&&list(t.permissions)&&list(t.checks)))return false;
 if(!s.policies.every((p:any)=>strings(p,['agentId','runId','rule','severity','action','at','status','disposition','context','notes'])&&(p.assigneeId===null||typeof p.assigneeId==='string')))return false;
 if(!s.approvals.every((a:any)=>strings(a,['agentId','runId','action','risk','context','status','at','expiresAt','note'])&&Number.isFinite(Date.parse(a.expiresAt))&&(a.assigneeId===null||typeof a.assigneeId==='string')))return false;
 if(!s.assignments.every((a:any)=>strings(a,['reviewId','toId','actorId','at','note'])&&(a.fromId===null||typeof a.fromId==='string')))return false;
 if(!s.audit.every((a:any)=>strings(a,['actorId','action','target','at','outcome'])))return false;
 if(!s.connectors.every((c:any)=>strings(c,['name','type','framework','status','lastCheck','endpoint'])&&list(c.tools)))return false;
 const agents=new Set(s.agents.map((a:any)=>a.id)),runs=new Set(s.runs.map((r:any)=>r.id)),users=new Set(s.users.map((u:any)=>u.id));
 return hasDefinitions(s)&&[...s.runs,...s.toolCalls,...s.policies,...s.approvals].every(x=>agents.has(x.agentId))&&[...s.toolCalls,...s.policies,...s.approvals].every(x=>runs.has(x.runId))&&[...s.policies,...s.approvals].every(x=>!x.assigneeId||users.has(x.assigneeId));
}
const sleep=(ms=240)=>new Promise<void>(r=>setTimeout(r,ms));
const safeRecordText=(text:string,max:number)=>text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi,'').slice(0,max);
/** Ingest a completed receipt, never an instruction to execute a real tool. */
function validateExecutionResult(value:any):ExecutionResult {
 const text=(v:any,max:number,required=false)=>typeof v==='string'&&v.length<=max&&(!required||v.trim().length>0);
 const metric=(v:any,max=Number.MAX_SAFE_INTEGER)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max;
 const date=(v:any)=>text(v,100,true)&&Number.isFinite(Date.parse(v));
 const status=['Success','Failed','Blocked','Awaiting approval','Cancelled'];
 const need=(ok:any)=>{if(!ok)throw Error('The execution receipt is invalid or too large. The result was not recorded.')};
 need(value&&typeof value==='object'&&!Array.isArray(value));
 need(text(value.id,200,true)&&text(value.agentId,100,true)&&Number.isInteger(value.configurationRevision)&&value.configurationRevision>=1);
 need(['agent','node'].includes(value.mode)&&status.includes(value.status)&&text(value.input,16000)&&text(value.output,262144)&&text(value.model,200,true)&&date(value.at));
 need(metric(value.duration,86400000)&&metric(value.tokens)&&Number.isInteger(value.tokens)&&metric(value.cost,100000)&&typeof value.costKnown==='boolean');
 need(validTokenUsage(value.tokenUsage,value.tokens));
 need(validRecordedBaseUrl(value.baseUrl)&&validPolicyRevision(value.globalPolicyRevision));
 need(value.nodeId===undefined||text(value.nodeId,100,true));need(value.mode!=='node'||text(value.nodeId,100,true));
 need(Array.isArray(value.nodes)&&value.nodes.length<=200&&new Set(value.nodes.map((n:any)=>n?.nodeId)).size===value.nodes.length);
 for(const node of value.nodes){
  need(node&&text(node.nodeId,100,true)&&text(node.label,200,true)&&nodeKinds.includes(node.kind)&&[...status,'Skipped'].includes(node.status)&&date(node.at));
  need(text(node.input,262144)&&text(node.output,262144)&&text(node.summary,8000)&&metric(node.duration,86400000)&&metric(node.tokens)&&Number.isInteger(node.tokens)&&metric(node.cost,100000));
  need(node.model===undefined||text(node.model,200,true));need(node.toolName===undefined||TOOL_CATALOG.some(t=>t.name===node.toolName));
  need(validRecordedBaseUrl(node.baseUrl));
  need(node.toolMode===undefined||node.toolMode==='demo');
  need(validTokenUsage(node.tokenUsage,node.tokens)&&validPolicyChecks(node.policyChecks));
  if(node.kind==='Tool'&&node.status!=='Skipped')need(node.toolMode==='demo'&&TOOL_CATALOG.some(t=>t.name===node.toolName));
 }
 if(value.tokenUsage&&value.nodes.every((n:any)=>n.tokenUsage!==undefined)){
  need(value.nodes.reduce((total:number,n:any)=>total+n.tokenUsage.generation,0)===value.tokenUsage.generation&&value.nodes.reduce((total:number,n:any)=>total+n.tokenUsage.policy,0)===value.tokenUsage.policy);
 }
 need(Array.isArray(value.policies)&&value.policies.length<=100&&value.policies.every((p:any)=>p&&text(p.rule,200,true)&&['Low','Medium','High','Critical'].includes(p.severity)&&['Block','Require approval','Flag'].includes(p.action)&&text(p.context,262144)&&(p.nodeId===undefined||text(p.nodeId,100,true))));
 need(Array.isArray(value.warnings)&&value.warnings.length<=100&&value.warnings.every((w:any)=>text(w,4000)));
 need(JSON.stringify(value).length<=8000000);
 // Explicit field selection prevents extra receipt fields becoming workspace data.
 return {id:value.id,agentId:value.agentId,configurationRevision:value.configurationRevision,...(value.globalPolicyRevision!==undefined?{globalPolicyRevision:value.globalPolicyRevision}:{}),mode:value.mode,...(value.nodeId?{nodeId:value.nodeId}:{}),input:value.input,output:value.output,status:value.status,at:value.at,duration:value.duration,tokens:value.tokens,...(value.tokenUsage?{tokenUsage:{generation:value.tokenUsage.generation,policy:value.tokenUsage.policy}}:{}),cost:value.cost,costKnown:value.costKnown,model:value.model,...(value.baseUrl!==undefined?{baseUrl:normalizeNebiusBaseUrl(value.baseUrl)}:{}),
  nodes:value.nodes.map((n:NodeExecution)=>({nodeId:n.nodeId,label:n.label,kind:n.kind,status:n.status,input:n.input,output:n.output,summary:n.summary,at:n.at,duration:n.duration,tokens:n.tokens,...(n.tokenUsage?{tokenUsage:{generation:n.tokenUsage.generation,policy:n.tokenUsage.policy}}:{}),...(n.policyChecks?{policyChecks:n.policyChecks.map((c:ExecutionCheck)=>({id:c.id,rule:c.rule,stage:c.stage,action:c.action,violated:c.violated,summary:c.summary}))}:{}),cost:n.cost,...(n.toolName?{toolName:n.toolName}:{}),...(n.toolMode?{toolMode:n.toolMode}:{}),...(n.model?{model:n.model}:{}),...(n.baseUrl!==undefined?{baseUrl:normalizeNebiusBaseUrl(n.baseUrl)}:{})})),
  policies:value.policies.map((p:any)=>({rule:p.rule,severity:p.severity,action:p.action,context:p.context,...(p.nodeId?{nodeId:p.nodeId}:{})})),warnings:[...value.warnings]};
}
async function executionDigest(result:ExecutionResult){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(result)));return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('')}
export function createMockService(initial?:Store,onPublish?:(state:Store)=>void,options:{simulation?:boolean}={}):Service{
 let state:Store|undefined=initial;const listeners=new Set<()=>void>();let restored=!!initial;
 function db(){if(!state)state=createSeed();if(!restored&&typeof window!=='undefined'){restored=true;try{const stored=upgradeSnapshot(JSON.parse(localStorage.getItem(KEY)||'null'));if(isUsableSnapshot(stored)){state=stored;try{localStorage.setItem(KEY,JSON.stringify(stored))}catch{}}}catch{}}return state!}
 function publish(){const s=db();s.updatedAt=new Date().toISOString();retainSimulationHistory(s);let persisted=true;try{if(typeof window!=='undefined'&&!initial)localStorage.setItem(KEY,JSON.stringify(s))}catch{persisted=false}onPublish?.(s);listeners.forEach(f=>f());return persisted}
 function actor(id:string){const u=db().users.find(x=>x.id===id);if(!u)throw Error('Unknown demo user.');return u}
 function audit(userId:string,action:string,target:string,outcome:string,agentId?:string){db().audit.unshift({id:`AU-${crypto.randomUUID()}`,actorId:userId,action,target,outcome,agentId,at:new Date().toISOString()})}
 function review(id:string,userId:string){const s=db(),u=actor(userId);const item=[...s.approvals,...s.policies].find(x=>x.id===id);if(!item)throw Error('Review not found.');if(!canReview(u,item))throw Error('This review is outside your delegated permissions.');return {s,u,item}}
 function expireApprovals(){const at=Date.now();let changed=false;for(const a of db().approvals){if(a.status==='Pending'&&Date.parse(a.expiresAt)<=at){a.status='Expired';audit('system','Approval expired',a.id,'No action executed',a.agentId);changed=true}}return changed}
 function editable(item:any){return item.status==='Pending'||item.status==='Open'||item.status==='In review'}
 function draftCheck(d:ConnectorDraft){if(!d.name.trim()||d.name.length>80)throw Error('Enter a connector name (up to 80 characters).');try{const url=new URL(d.endpoint);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error()}catch{throw Error('Use an HTTPS placeholder without credentials, query parameters, or fragments. No network request will be made.')}}
 return {mode:'mock',async load(){await sleep();const warmed=options.simulation===false?false:warmRecentSimulation(db());if(expireApprovals()||warmed)publish();return structuredClone(db())},subscribe(f){listeners.add(f);return()=>{listeners.delete(f)}},
 tick(){const s=db(),at=new Date().toISOString();expireApprovals();s.runs.forEach(r=>{if(r.status==='Running'&&r.source!=='live'){r.status='Success';r.steps[r.steps.length-1].outcome='Success';r.steps[r.steps.length-1].summary='Saved the result with references to the permitted source records.'}});const active=simulationAgents(s);if(!active.length){publish();return}appendSimulationRun(s,active[s.sequence%active.length],at);s.connectors.filter(c=>c.status==='Healthy').forEach(c=>c.lastCheck=at);publish()},
 async decide(id:string,decision:Decision,note:string,userId:string){await sleep();const {s,item}=review(id,userId);const a=s.approvals.find(a=>a.id===item.id);if(!a||a.status!=='Pending')throw Error('This approval is no longer pending.');if(new Date(a.expiresAt).getTime()<=Date.now()){expireApprovals();publish();throw Error('This approval has expired.')}if(!note.trim()||note.length>1000)throw Error('Add a review note of 1–1,000 characters.');a.status=decision;a.note=note.trim();a.decisionAt=new Date().toISOString();audit(userId,`Approval ${decision.toLowerCase()}`,id,note.trim(),a.agentId);publish()},
 async assign(id:string,toId:string,note:string,userId:string){await sleep();const {s,u,item}=review(id,userId);if(!canManage(u))throw Error('Only an owner or admin can delegate reviews.');if(expireApprovals())publish();if(note.length>1000)throw Error('Keep assignment notes under 1,000 characters.');if(!editable(item))throw Error('Completed reviews cannot be reassigned.');const to=actor(toId);if(!to.available||!canAccess(to,item.agentId))throw Error('Choose an available reviewer assigned to this agent.');if(item.assigneeId===toId)throw Error('This reviewer is already assigned.');s.assignments.unshift({id:`AS-${crypto.randomUUID()}`,reviewId:id,fromId:item.assigneeId,toId,actorId:userId,at:new Date().toISOString(),note:note.trim()||'Domain review delegated'});item.assigneeId=toId;if('disposition'in item)item.status='In review';audit(userId,'Review assigned',id,`Assigned to ${to.name}`,item.agentId);publish()},
 async resolve(id,note,userId){await sleep();const {s,item}=review(id,userId),p=s.policies.find(p=>p.id===item.id);if(!p||p.status==='Resolved')throw Error('This policy event is already resolved.');if(!note.trim()||note.length>1000)throw Error('Add remediation notes of 1–1,000 characters.');p.notes=note.trim();p.status='Resolved';audit(userId,'Policy review resolved',id,p.notes,p.agentId);publish()},
 async testConnector(d,userId){await sleep(700);if(!canManage(actor(userId)))throw Error('Connector management requires an owner or admin.');draftCheck(d);return d.endpoint.includes('fail')?{ok:false,message:'Simulated health check failed. Try a different placeholder endpoint.'}:{ok:true,message:'Mock test passed. No endpoint was contacted and no real connection was made.'}},
 async saveConnector(d,userId){await sleep();if(!canManage(actor(userId)))throw Error('Connector management requires an owner or admin.');draftCheck(d);const id=`c-${crypto.randomUUID()}`;db().connectors.push({...d,name:d.name.trim(),id,createdById:userId,agentId:null,status:'Not tested',lastCheck:new Date().toISOString(),tools:['web_search','ticket_create']});audit(userId,'Demo connector saved',id,'Configuration only · not connected');publish()},
 async setAgentStatus(id,status,userId){await sleep();const u=actor(userId),a=db().agents.find(a=>a.id===id);if(!a||!canManage(u)||!canAccess(u,id))throw Error('Agent management requires assigned admin access.');a.status=status;const d=db().definitions.find(d=>d.agentId===id);if(d){d.revision++;d.updatedAt=new Date().toISOString();d.updatedBy=userId}audit(userId,'Agent status changed',id,status,id);publish()},
 async setAvailability(id,available,userId){await sleep();if(!canManage(actor(userId)))throw Error('Team management requires an owner or admin.');const u=actor(id);if(u.role==='Owner'||u.role==='Admin')throw Error('Owner and admin access is managed outside this demo.');const admin=actor(userId);if(admin.role!=='Owner'&&!u.agentIds.some(id=>canAccess(admin,id)))throw Error('This reviewer is outside your assigned agent scope.');u.available=available;audit(userId,'Reviewer availability changed',id,available?'Available':'Away');publish()},
 async saveAgentConfiguration(id,draft,userId){await sleep();const s=db(),u=actor(userId);const next=validateConfiguration(id,draft,s,u);const definition=s.definitions.find(d=>d.agentId===id);if(!definition||definition.revision!==next.expectedRevision)throw Error('This agent changed after you opened it. Reload its configuration before saving.');const agent=s.agents.find(a=>a.id===id)!;const delta=(before:{id:string}[],after:{id:string}[])=>`+${after.filter(n=>!before.some(p=>p.id===n.id)).length} / −${before.filter(n=>!after.some(p=>p.id===n.id)).length}`;const graphChange=`nodes ${delta(definition.nodes,next.definition.nodes)} · connections ${delta(definition.edges,next.definition.edges)}`;Object.assign(agent,next.agent,{policies:next.definition.guardrails.filter(g=>g.enabled).map(g=>g.name)});Object.assign(definition,next.definition,{agentId:id,revision:definition.revision+1,updatedAt:new Date().toISOString(),updatedBy:userId});audit(userId,'Agent configuration saved',id,`Revision ${definition.revision} · ${definition.nodes.length} nodes · ${definition.edges.length} connections · ${agent.tools.length} tools · ${graphChange}`,id);publish()},
 async saveGlobalPolicies(draft,userId){
  await sleep();const s=db(),u=actor(userId);if(u.role!=='Owner')throw Error('Only the workspace owner can save global policies.');
  if(!draft||typeof draft!=='object'||Array.isArray(draft)||Object.keys(draft).some(key=>!['expectedRevision','rules'].includes(key))||!Number.isSafeInteger(draft.expectedRevision)||draft.expectedRevision<1)throw Error('Provide the current global policy revision and a valid rules list.');
  const rules=validatePolicyRules(draft.rules),current=s.globalPolicies;if(!current||current.revision!==draft.expectedRevision)throw Error('Global policies changed after you opened them. Reload before saving.');
  if(!Number.isSafeInteger(current.revision+1))throw Error('The global policy revision limit has been reached.');
  s.globalPolicies={revision:current.revision+1,updatedAt:new Date().toISOString(),updatedBy:userId,rules};audit(userId,'Global policies saved','global-policies',`Revision ${s.globalPolicies.revision} · ${rules.length} rules`);
  if(!publish())throw Error('Global policies are saved in this tab, but browser storage is unavailable or full. Export the YAML before closing the tab.');
 },
 async recordExecution(value,userId){
  const result=validateExecutionResult(value),digest=await executionDigest(result),s=db(),u=actor(userId),agent=s.agents.find(a=>a.id===result.agentId),definition=s.definitions.find(d=>d.agentId===result.agentId);
  if(!agent||!definition||!canManage(u)||!canAccess(u,agent.id))throw Error('Recording executions requires assigned admin access.');
  const existing=s.runs.find(r=>r.id===result.id);
  if(existing){if(existing.source==='live'&&existing.executionDigest===digest){if(!publish())throw Error('This result is recorded in this tab, but browser storage is unavailable or full. Download it before closing the tab.');return}throw Error('This run ID is already recorded with a different result.');}
  if(result.configurationRevision>definition.revision)throw Error('The execution refers to an unknown configuration revision. Reload the saved agent.');
  if(result.globalPolicyRevision!==undefined&&(!s.globalPolicies||result.globalPolicyRevision>s.globalPolicies.revision))throw Error('The execution refers to an unknown global policy revision. Reload the workspace policies.');
  const at=result.at,runId=result.id,kind=(n:NodeExecution):TraceStep['kind']=>n.kind==='Tool'?'Tool call':n.kind==='Sub-agent'?'Handoff':n.kind==='Guardrail'?'Policy check':'Decision summary';
  const steps:TraceStep[]=result.nodes.map(n=>({label:safeRecordText(n.label,200),kind:kind(n),nodeKind:n.kind,summary:safeRecordText(n.summary,2000),duration:n.duration,outcome:n.status,nodeId:n.nodeId,input:safeRecordText(n.input,32000),output:safeRecordText(n.output,64000),tokens:n.tokens,...(n.tokenUsage?{tokenUsage:{...n.tokenUsage}}:{}),...(n.policyChecks?{policyChecks:n.policyChecks.map(c=>({...c,rule:safeRecordText(c.rule,200),summary:safeRecordText(c.summary,1000)}))}:{}),...(n.model?{model:n.model}:{}),...(n.baseUrl!==undefined?{baseUrl:normalizeNebiusBaseUrl(n.baseUrl)}:{})}));
  if(!steps.length)steps.push({label:result.mode==='node'?'Node test':'Agent execution',kind:'Decision summary',summary:result.status==='Cancelled'?'Execution was cancelled before a node completed.':'No completed node output was returned.',duration:0,outcome:result.status});
  const run:Run={id:runId,agentId:agent.id,task:safeRecordText(result.input,16000)||`${result.mode==='node'?'Node test':'Agent run'} · ${agent.name}`,status:result.status==='Cancelled'?'Failed':result.status,at,duration:result.duration,tokens:result.tokens,...(result.tokenUsage?{tokenUsage:{...result.tokenUsage}}:{}),cost:result.costKnown?result.cost:0,risk:agent.risk,steps,configurationRevision:result.configurationRevision,...(result.globalPolicyRevision!==undefined?{globalPolicyRevision:result.globalPolicyRevision}:{}),source:'live',executionMode:result.mode,executionStatus:result.status,...(result.nodeId?{nodeId:result.nodeId}:{}),output:safeRecordText(result.output,120000),model:result.model,...(result.baseUrl!==undefined?{baseUrl:result.baseUrl}:{}),costKnown:result.costKnown,warnings:result.warnings.map(w=>safeRecordText(w,4000)),executionDigest:digest};
  const calls:ToolCall[]=result.nodes.filter(n=>n.kind==='Tool'&&n.status!=='Skipped').map((n,i)=>({id:`TC-${runId}-${i}`,agentId:agent.id,runId,name:n.toolName!,nodeId:n.nodeId,at:n.at,status:n.status==='Success'?'Success':n.status==='Blocked'||n.status==='Awaiting approval'?'Blocked':'Failed',latency:n.duration,risk:agent.risk,input:safeRecordText(n.input,16000),output:`Demo tool · no external action executed.\n${safeRecordText(n.output,16000)}`,permissions:['Demo adapter only · no external credentials'],checks:[`Execution outcome: ${n.status}`,'No real connector was contacted']}));
  const policies:PolicyEvent[]=result.policies.map((p,i)=>({id:`POL-${runId}-${i}`,agentId:agent.id,runId,rule:safeRecordText(p.rule,200),severity:p.severity,action:p.action,at,status:'Open',disposition:p.action==='Block'?'Blocked':'Flagged',context:safeRecordText(p.context,16000),notes:p.action==='Require approval'?'Execution is held for review. Approval records a decision; it does not automatically resume this run or execute a tool.':'Review the recorded policy result. No external tool action was executed.',assigneeId:null}));
  const approvals:Approval[]=result.status==='Awaiting approval'?[{id:`APR-${runId}`,agentId:agent.id,runId,action:safeRecordText(result.policies.find(p=>p.action==='Require approval')?.rule||'Review held agent result',200),risk:agent.risk,context:safeRecordText(result.policies.find(p=>p.action==='Require approval')?.context||result.output||result.input,16000),status:'Pending',at,expiresAt:new Date(Math.max(Date.now(),Date.parse(at))+86400000).toISOString(),assigneeId:null,note:'Live model execution held. Tools are demo adapters; approving does not automatically resume execution.'}]:[];
  // All validation and materialization precede mutation so failed ingestion is atomic.
  if(calls.some(c=>s.toolCalls.some(t=>t.id===c.id))||policies.some(p=>s.policies.some(t=>t.id===p.id))||approvals.some(a=>s.approvals.some(t=>t.id===a.id)))throw Error('An execution record ID conflicts with an existing review or tool record.');
  s.runs.unshift(run);s.toolCalls.unshift(...calls);s.policies.unshift(...policies);s.approvals.unshift(...approvals);if(Date.parse(at)>Date.parse(agent.lastActive))agent.lastActive=at;
  audit(userId,result.mode==='node'?'Live node test recorded':'Live agent run recorded',runId,`${result.status} · revision ${result.configurationRevision} · ${result.nodes.length} nodes`,agent.id);
  if(approvals.length)audit(userId,'Approval requested',approvals[0].id,'Execution held · unassigned',agent.id);
  if(!publish())throw Error('This result is recorded in this tab, but browser storage is unavailable or full. Download it before closing the tab.');
 },
 async reset(){state=createSeed();restored=true;publish()}};
}
/** REST boundary: browser identity is demo-only. A real server must derive identity from a verified session. */
export function createFastApiService(base:string):Service{
 const listeners=new Set<()=>void>();
 async function call(path:string,method='GET',body?:unknown):Promise<any>{
  let r:Response;
  try{r=await fetch(`${base.replace(/\/$/,'')}${path}`,{method,credentials:'include',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)})}
  catch(e:any){throw Error(e.name==='TimeoutError'?'The governance API took too long to respond. Try again.':'Could not reach the governance API. Check its address and connection, then retry.')}
  const data:any=await r.json().catch(()=>null);
  if(!r.ok){const detail=data?.detail;const message=typeof detail==='string'?detail:Array.isArray(detail)?detail.map(x=>x.msg||'Invalid value').join('; '):`API request failed (${r.status}).`;throw Error(message)}
  if(data===null)throw Error('The governance API returned an invalid response.');
  return data;
 }
 async function mutate(path:string,body:unknown){await call(path,'POST',body);listeners.forEach(f=>f())}
 return {mode:'api',async load(){const keys=['agents','runs','tool-calls','policy-events','approvals','users','assignments','audit-events','connectors','agent-definitions','global-policies'];const values=await Promise.all(keys.map(k=>call(`/api/${k}`)));const result:Store={version:1,agents:values[0],runs:values[1],toolCalls:values[2],policies:values[3],approvals:values[4],users:values[5],assignments:values[6],audit:values[7],connectors:values[8],definitions:values[9],globalPolicies:values[10],sequence:0,updatedAt:new Date().toISOString()};if(!isUsableSnapshot(result))throw Error('The governance API returned incomplete records. Verify the service contract.');return result},subscribe(f){listeners.add(f);return()=>{listeners.delete(f)}},tick(){listeners.forEach(f=>f())},decide:(id,decision,note)=>mutate(`/api/approvals/${id}/decision`,{decision,note}),assign:(id,toId,note)=>mutate(`/api/reviews/${id}/assign`,{assigneeId:toId,note}),resolve:(id,note)=>mutate(`/api/policy-events/${id}/resolve`,{note}),testConnector:(draft)=>call('/api/connectors/test','POST',draft),saveConnector:(draft)=>mutate('/api/connectors',draft),setAgentStatus:(id,status)=>mutate(`/api/agents/${id}/status`,{status}),setAvailability:(id,available)=>mutate(`/api/users/${id}/availability`,{available}),saveAgentConfiguration:(id,draft)=>mutate(`/api/agents/${id}/configuration`,draft),saveGlobalPolicies:(draft)=>mutate('/api/global-policies',draft),recordExecution:(result)=>mutate('/api/agent-executions',result),async reset(){throw Error('Reset is available only in the local simulation.')}};
}
