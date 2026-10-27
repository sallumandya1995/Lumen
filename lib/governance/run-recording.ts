import type {ExecutionRequest,ExecutionResult,NodeExecution} from '../agent-execution/types';
import type {Store,TraceStep} from './types';
import {mutateWorkspace,HttpError} from './server-store';
import {createMockService} from './store-core';
import {sanitize,safeText} from './sanitize';
export function liveStep(n:NodeExecution):TraceStep{return sanitize({label:n.label,kind:n.kind==='Tool'?'Tool call':n.kind==='Sub-agent'?'Handoff':n.kind==='Guardrail'?'Policy check':'Decision summary',nodeKind:n.kind,summary:n.summary,duration:n.duration,outcome:n.status,nodeId:n.nodeId,input:n.input,output:n.output,tokens:n.tokens,tokenUsage:n.tokenUsage,policyChecks:n.policyChecks,model:n.model,baseUrl:n.baseUrl})}
export async function beginRun(workspace:string,request:ExecutionRequest,id:string){return mutateWorkspace(workspace,'workspace-owner','Agent run started',id,s=>{
 const agent=s.agents.find(a=>a.id===request.agent.id),definition=s.definitions.find(d=>d.agentId===request.agent.id);
 if(!agent||!definition||definition.revision!==request.definition.revision)throw new HttpError(409,'The saved agent changed. Reload Studio before running it.');
 if(s.runs.some(r=>r.source==='live'&&r.status==='Running'&&Date.now()-Date.parse(r.at)<300000&&r.agentId===agent.id))throw new HttpError(409,'This agent already has an active run. Wait for it to finish.');
 s.runs.unshift({id,agentId:agent.id,task:safeText(request.input),status:'Running',at:new Date().toISOString(),duration:0,tokens:0,cost:0,costKnown:false,risk:agent.risk,steps:[],source:'live',provenance:'studio',configurationRevision:definition.revision,globalPolicyRevision:request.globalPolicies?.revision,executionMode:request.nodeId?'node':'agent',nodeId:request.nodeId,model:definition.model.name,baseUrl:definition.model.baseUrl});s.updatedAt=new Date().toISOString();
 });}
export async function recordNode(workspace:string,id:string,node:NodeExecution){return mutateWorkspace(workspace,'executor','Node completed',id,s=>{const run=s.runs.find(r=>r.id===id);if(!run||run.status!=='Running')return;const i=run.steps.findIndex(n=>n.nodeId===node.nodeId);if(i>=0)run.steps[i]=liveStep(node);else run.steps.push(liveStep(node));run.tokens=run.steps.reduce((n,x)=>n+(x.tokens||0),0);run.duration=Date.now()-Date.parse(run.at);s.updatedAt=new Date().toISOString()})}
export async function finishRun(workspace:string,result:ExecutionResult){return mutateWorkspace(workspace,'executor','Agent run recorded',result.id,async s=>{
 const prior=s.runs.find(r=>r.id===result.id);if(prior?.status==='Running')s.runs=s.runs.filter(r=>r.id!==result.id);
 await createMockService(s).recordExecution(sanitize(result),s.users.find(u=>u.role==='Owner')!.id);
 const run=s.runs.find(r=>r.id===result.id)!;run.provenance='studio';
 });}
