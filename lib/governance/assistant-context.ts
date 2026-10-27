import {canManage,scopeStore} from './service';
import type {Store,User} from './types';

export type GovernanceAssistantContext={
 version:1;capturedAt:string;workspaceMode:'mock'|'api';section:string;
 viewer:{id:string;name:string;role:User['role']};
 filters:Record<string,string>;metrics:Record<string,number|string|null>;
 coverage:Record<string,unknown>;records:Record<string,unknown[]>;
 selectedRecord?:{type:string;id:string};
};
type Collection='agents'|'runs'|'toolCalls'|'policies'|'approvals'|'users'|'assignments'|'audit'|'connectors'|'definitions';
export type AssistantView={
 section:string;workspaceMode:'mock'|'api';period:string;filters:Record<string,string>;
 visibleIds?:Partial<Record<Collection,string[]>>;selectedRecord?:{type:string;id:string}|null;
 now?:number;
};

/** Only selected fields from the role-scoped dashboard are sent to the assistant. */
export function buildGovernanceContext(store:Store,viewer:User,view:AssistantView):GovernanceAssistantContext {
 const s=scopeStore(store,viewer),now=view.now??Date.now();
 const duration=view.period==='30m'?1800000:view.period==='2h'?7200000:86400000;
 const inWindow=(at:string)=>Date.parse(at)>=now-duration&&Date.parse(at)<=now;
 const runs=s.runs.filter(r=>inWindow(r.at)),calls=s.toolCalls.filter(t=>inWindow(t.at));
 const completed=runs.filter(r=>!['Running','Awaiting approval'].includes(r.status));
 const pending=s.approvals.filter(a=>a.status==='Pending'),open=s.policies.filter(p=>p.status!=='Resolved');
 const agentIds=new Set(s.agents.map(a=>a.id));
 const people=s.users; // Names/roles match the visible team directory; agent IDs remain intersected below.
 const person=(id:string|null)=>id?s.users.find(u=>u.id===id)?.name||id:'Unassigned';
 const name=(id:string)=>s.agents.find(a=>a.id===id)?.name||id;
 const source=(id:string)=>{const run=s.runs.find(r=>r.id===id);return run?.provenance==='external'?'Authenticated external telemetry; actions reported by the external runtime':run?.provenance==='browser-import'?'Imported browser history; not server-verified execution':run?.source==='live'?'Studio execution; tools are local functions':'Simulated telemetry'};
 const clean=(text:string,max=500)=>text.replace(/<(think|analysis)>[\s\S]*?(?:<\/(?:think|analysis)>|$)/gi,'')
  .replace(/\bBearer\s+[^\s"'<>]+/gi,'Bearer [redacted]')
  .replace(/\b(?:api[_ -]?key|password|secret|access[_ -]?token)\s*[:=]\s*["']?[^\s,"']+/gi,'[credential redacted]')
  .replace(/\bv1\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+/g,'[credential redacted]').slice(0,max);
 const records:GovernanceAssistantContext['records']={};
 const collections:Record<string,unknown>={};
 function add<T extends {id:string}>(key:Collection,items:T[],map:(item:T)=>unknown,limit=18,totalAvailable=items.length,availableItems=items){
  const selectedIds=view.visibleIds?.[key];
  const matches=selectedIds?new Set(selectedIds):null;
  const filtered=matches?items.filter(item=>matches.has(item.id)):items;
  const selected=view.selectedRecord;
  const types:Record<string,Collection>={agent:'agents',run:'runs',tool:'toolCalls',policy:'policies',approval:'approvals',connector:'connectors'};
  const picked=filtered.slice(0,limit);
  const inspected=selected&&types[selected.type]===key?availableItems.find(x=>x.id===selected.id):undefined;
  if(inspected&&!picked.some(x=>x.id===inspected.id)){if(picked.length>=limit)picked.pop();picked.push(inspected)}
  records[key]=picked.map(map);
  collections[key]={availableInScope:totalAvailable,matchingCount:filtered.length,includedCount:picked.length,truncated:filtered.length>limit,filteredToCurrentView:!!matches,inspectedRecordIncluded:!!inspected,inspectedRecordOutsideMatchingView:!!inspected&&!filtered.some(x=>x.id===inspected.id)};
 }
 add('agents',s.agents,a=>({id:a.id,name:clean(a.name,120),description:clean(a.description),framework:a.framework,environment:a.environment,status:a.status,risk:a.risk,owner:person(a.ownerId),reviewers:a.reviewerIds.map(person),tools:a.tools,policies:a.policies,lastActive:a.lastActive}),30);
 // Preserve the table's current sort when a filtered list is supplied.
 const ordered=<T extends {id:string;at:string}>(key:Collection,items:T[])=>{
  const ids=view.visibleIds?.[key];if(!ids)return [...items].sort((a,b)=>b.at.localeCompare(a.at));
  const rank=new Map(ids.map((id,i)=>[id,i]));return [...items].sort((a,b)=>(rank.get(a.id)??1e9)-(rank.get(b.id)??1e9));
 };
 const attention=<T extends {status:string;at:string}>(items:T[])=>[...items].sort((a,b)=>Number(['Resolved','Approved','Rejected','Expired','Changes requested'].includes(a.status))-Number(['Resolved','Approved','Rejected','Expired','Changes requested'].includes(b.status))||b.at.localeCompare(a.at));
 add('runs',ordered('runs',runs),r=>({id:r.id,agentId:r.agentId,agent:name(r.agentId),task:clean(r.task),status:r.executionStatus||r.status,at:r.at,durationMs:r.duration,tokens:r.tokens,costUsd:r.source==='live'&&r.costKnown===false?null:r.cost,source:source(r.id),model:r.model,steps:r.steps.slice(0,6).map(t=>({label:clean(t.label,120),kind:t.kind,summary:clean(t.summary,300),outcome:t.outcome})),warnings:r.warnings?.slice(0,3).map(w=>clean(w,200))}),24,s.runs.length,s.runs);
 add('toolCalls',ordered('toolCalls',calls),t=>({id:t.id,agent:name(t.agentId),agentId:t.agentId,runId:t.runId,name:t.name,at:t.at,status:t.status,latencyMs:t.latency,risk:t.risk,inputSummary:clean(t.input,250),outputSummary:clean(t.output,250),checks:t.checks.slice(0,4).map(c=>clean(c,150)),source:source(t.runId)}),16,s.toolCalls.length,s.toolCalls);
 add('policies',view.visibleIds?.policies?ordered('policies',s.policies):attention(s.policies),p=>({id:p.id,agent:name(p.agentId),agentId:p.agentId,runId:p.runId,rule:clean(p.rule,160),severity:p.severity,action:clean(p.action,250),at:p.at,status:p.status,disposition:p.disposition,context:clean(p.context),notes:clean(p.notes,300),assigneeId:p.assigneeId,reviewer:person(p.assigneeId),source:source(p.runId)}));
 add('approvals',view.visibleIds?.approvals?ordered('approvals',s.approvals):attention(s.approvals),a=>({id:a.id,agent:name(a.agentId),agentId:a.agentId,runId:a.runId,action:clean(a.action,250),risk:a.risk,context:clean(a.context),status:a.status,at:a.at,expiresAt:a.expiresAt,assigneeId:a.assigneeId,reviewer:person(a.assigneeId),note:clean(a.note,250),source:source(a.runId)}));
 add('users',people,u=>({id:u.id,name:u.name,role:u.role,expertise:u.expertise,available:u.available,agentIds:u.agentIds.filter(id=>agentIds.has(id)),pendingReviews:pending.filter(a=>a.assigneeId===u.id).length,openPolicies:open.filter(p=>p.assigneeId===u.id).length}),30);
 add('assignments',ordered('assignments',s.assignments),a=>({id:a.id,reviewId:a.reviewId,from:person(a.fromId),to:person(a.toId),actor:person(a.actorId),at:a.at,note:clean(a.note,250)}),12);
 add('audit',ordered('audit',s.audit.filter(a=>inWindow(a.at))),a=>({id:a.id,actor:person(a.actorId),action:clean(a.action,150),target:a.target,at:a.at,outcome:clean(a.outcome,250)}),16,s.audit.length);
 add('connectors',s.connectors,c=>({id:c.id,name:clean(c.name,120),type:c.type,framework:c.framework,status:c.status,lastCheck:c.lastCheck,tools:c.tools,agentId:c.agentId,connectionMode:view.workspaceMode==='mock'?'Configuration only; health checks simulated':'API-reported connector'}),20);
 add('definitions',s.definitions.map(d=>({...d,id:d.agentId})),d=>({id:d.agentId,revision:d.revision,model:d.model,goal:clean(d.prompt.goal,300),memory:d.memory,limits:d.limits,nodes:d.nodes.slice(0,20).map(n=>({id:n.id,label:clean(n.label,100),kind:n.kind,enabled:n.enabled,toolName:n.toolName})),guardrails:d.guardrails.slice(0,12).map(g=>({name:clean(g.name,120),enabled:g.enabled,action:g.action,severity:g.severity,stage:g.stage}))}),12);
 records.globalPolicies=s.globalPolicies?[{id:'global-policy-configuration',revision:s.globalPolicies.revision,updatedAt:s.globalPolicies.updatedAt,appliesTo:'Every agent in this workspace',rules:s.globalPolicies.rules.slice(0,30).map(rule=>({id:rule.id,name:clean(rule.name,120),description:clean(rule.description,500),enabled:rule.enabled,stage:rule.stage,action:rule.action,severity:rule.severity}))}]:[];
 collections.globalPolicies={availableInScope:s.globalPolicies?1:0,includedCount:s.globalPolicies?1:0,truncated:false};
 records.agentMetrics=s.agents.slice(0,30).map(a=>{
  const items=runs.filter(r=>r.agentId===a.id),done=items.filter(r=>!['Running','Awaiting approval'].includes(r.status));
  return {agentId:a.id,name:a.name,runs:items.length,successful:done.filter(r=>r.status==='Success').length,completed:done.length,failed:items.filter(r=>r.status==='Failed').length,blocked:items.filter(r=>r.status==='Blocked').length,pendingApprovals:pending.filter(r=>r.agentId===a.id).length,openPolicies:open.filter(r=>r.agentId===a.id).length};
 });
 records.toolUsage=Array.from(new Set(calls.map(t=>t.name))).slice(0,30).map(tool=>{const items=calls.filter(t=>t.name===tool);return {tool,calls:items.length,failed:items.filter(t=>t.status==='Failed').length,blocked:items.filter(t=>t.status==='Blocked').length,meanLatencyMs:Math.round(items.reduce((n,t)=>n+t.latency,0)/items.length)}});
 const success=completed.filter(r=>r.status==='Success').length;
 return {version:1,capturedAt:new Date(now).toISOString(),workspaceMode:view.workspaceMode,section:view.section,viewer:{id:viewer.id,name:viewer.name,role:viewer.role},filters:{...view.filters,period:view.period},
  metrics:{activeAgents:s.agents.filter(a=>a.status==='Active').length,agentsInScope:s.agents.length,degradedAgents:s.agents.filter(a=>a.status==='Degraded').length,totalRuns:runs.length,completedRuns:completed.length,successfulRuns:success,successRatePercent:completed.length?Math.round(success/completed.length*1000)/10:0,runningRuns:runs.filter(r=>r.status==='Running').length,failedRuns:runs.filter(r=>r.status==='Failed').length,blockedRuns:runs.filter(r=>r.status==='Blocked').length,policyEventsInWindow:s.policies.filter(p=>inWindow(p.at)).length,openPolicies:open.length,pendingApprovals:pending.length,unassignedReviews:[...pending,...open].filter(x=>!x.assigneeId).length,knownEstimatedCostUsd:runs.reduce((n,r)=>n+(r.source==='live'&&r.costKnown===false?0:r.cost),0),unpricedLiveRuns:runs.filter(r=>r.source==='live'&&r.costKnown===false).length,liveModelRuns:runs.filter(r=>r.source==='live').length,simulatedRuns:runs.filter(r=>r.source!=='live').length},
  coverage:{storeUpdatedAt:s.updatedAt,windowStart:new Date(now-duration).toISOString(),windowEnd:new Date(now).toISOString(),scope:viewer.role==='Owner'?'Full workspace':canManage(viewer)?'Assigned agents and their reviews':'Assigned agents; only reviews delegated to this user',metricScope:'Overview metrics use all role-scoped runs in the selected window, independent of table filters. Pending approvals and open policy totals are all retained records in scope. Success rate excludes running and awaiting approval; no completed runs displays 0%.',details:'Bounded, shortened record samples. Use matchingCount for filtered totals, not the sample length. Other collections provide scoped background. Retained records are not an all-time history.',simulatedActions:view.workspaceMode==='mock',collections},records,
  ...(view.selectedRecord?{selectedRecord:view.selectedRecord}:{})};
}
