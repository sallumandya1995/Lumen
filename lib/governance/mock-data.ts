import type {Store,Run,ToolCall,Agent,TraceStep,AgentDefinition} from './types';
import {createDefinition,TOOL_CATALOG} from './definitions';
import {withEndToEndDemo} from './end-to-end-demo';
import {withGlobalPolicyDefaults} from './policy-config';
export const TOOL_NAMES=TOOL_CATALOG.map(t=>t.name);
export function reviewScenario(agent:Agent,definition?:AgentDefinition,status?:Run['status']){
 const scenarios:Record<string,{rule:string;action:string;context:string}>={
  'a-support':{rule:'External communications gate',action:'Send a prepared customer support reply',context:'A reply draft is ready for one verified customer. Recipient identifiers are masked; the draft has not been delivered.'},
  'a-research':{rule:'Public sources only',action:'Include an unverified source in a market brief',context:'One cited source is outside the approved public-source list. The brief is held for source verification; no publication occurred.'},
  'a-revenue':{rule:'External communications gate',action:'Send a prepared account outreach email',context:'A single-account outreach draft is ready. Recipient and account IDs are masked. External delivery is paused for review.'},
  'a-finance':{rule:'Payment approval',action:'Apply a reconciliation exception',context:'A masked ledger discrepancy would change a payment reference. The proposal is recorded; financial data has not been changed.'},
  'a-triage':{rule:'Tenant isolation',action:'Create a priority incident escalation',context:'A priority incident draft contains a masked tenant reference. The destination queue must be verified before a ticket can be created.'},
  'a-risk':{rule:'Tenant isolation',action:'Read a record outside the assigned tenant',context:'The test requested a masked cross-tenant record. The boundary check stopped the read before any record was returned.'}
 };
 const scenario=scenarios[agent.id]||{rule:agent.policies[0]||'Human review gate',action:'Review a sensitive agent action',context:'The action was held for a scoped human review. No side effect occurred.'};
 const action=status==='Blocked'?'Block':status==='Awaiting approval'?'Require approval':undefined;
 const available=definition?.guardrails.filter(g=>g.enabled&&(!action||g.action===action));
 const configured=available?.find(g=>g.name===scenario.rule)||available?.[0];
 if(configured)return {...scenario,rule:configured.name,context:`${configured.description} ${scenario.context}`};
 if(definition&&status==='Awaiting approval')return {...scenario,rule:'Human approval gate',context:`The configured human approval requirement held this action. ${scenario.context}`};
 return scenario;
}
export function makeRun(agent:Agent,index:number,at:string,definition?:AgentDefinition):{run:Run;calls:ToolCall[]}{
 const id=`RUN-${String(index).padStart(5,'0')}`;
 const approval=definition?definition.limits.requireApproval||definition.guardrails.some(g=>g.enabled&&g.action==='Require approval'):true;
 const blocking=definition?definition.guardrails.some(g=>g.enabled&&g.action==='Block'):true;
 const status=index%19===0?'Running':index%13===0&&approval?'Awaiting approval':index%9===0&&blocking?'Blocked':index%11===0?'Failed':'Success';
 const name=agent.tools[Math.floor(index/6)%agent.tools.length];
 const risky=status==='Blocked'||status==='Awaiting approval';
 const latency=180+(index*37)%970;
 const duration=230+latency+340+120+170+500+(index*719)%12000, tokens=Math.min(840+(index*431)%5400,definition?.model.maxTokens||32768);
 const scenario=reviewScenario(agent,definition,status);
 const toolContext:Record<string,{input:string;output:string;permission:string}>={
  web_search:{input:'Query: public market trends · scope: approved public domains · no personal identifiers.',output:'Three public-source summaries with citations returned.',permission:'web:search:public_domains'},
  crm_lookup:{input:'Record ref: CUST-•••42 · fields: account tier and case category. Personal identifiers redacted.',output:'Account tier and case category returned; contact fields excluded.',permission:'crm:read:scoped_accounts'},
  database_query:{input:'Read-only query against approved aggregate views; tenant ref: TEN-•••18.',output:'Twelve aggregated rows returned. Row-level personal data excluded.',permission:'db:read:approved_views'},
  email_draft:{input:'Prepare a reply draft for one masked verified contact. Sending is not authorized by this tool.',output:'Draft saved for human review. No email sent.',permission:'email:draft_only'},
  ticket_create:{input:'Prepare an incident ticket in the approved queue; sanitized case reference: CASE-•••73.',output:'Draft ticket prepared. External creation remains behind the approval gate.',permission:'tickets:prepare_scoped'}
 };
 const context=toolContext[name]||toolContext.database_query;
 const steps:TraceStep[]=[
  {label:'Request received',kind:'Decision summary',summary:'Classified the request and selected the least-privileged workflow.',duration:230,outcome:'Recorded'},
  {label:name,kind:'Tool call',summary:status==='Failed'?'The connector exceeded its response deadline.':status==='Blocked'?'The tool invocation was stopped by the policy gate.':context.output,duration:latency,outcome:status==='Failed'?'Failed':status==='Blocked'?'Blocked':'Success'},
  {label:'Domain review',kind:'Handoff',summary:status==='Failed'?'No downstream handoff occurred after the connector failure.':'Routed the sanitized result to the domain review node.',duration:340,outcome:status==='Failed'?'Skipped':'Recorded'},
  {label:risky?'Sensitive action gate':'Policy evaluation',kind:'Policy check',summary:risky?scenario.context:'Data boundaries and tool scope matched the configured rules.',duration:120,outcome:status==='Blocked'?'Blocked':status==='Awaiting approval'?'Pending':'Passed'},
  {label:status==='Failed'?'Connector timeout':'Final result',kind:'Decision summary',summary:status==='Failed'?'The connector timed out; the operation was not retried.':risky?'Saved the proposal and stopped before any external side effect.':status==='Running'?'The result is still being prepared.':'Saved the result with references to the permitted source records.',duration:170,outcome:status}
 ];
 const gate=steps.splice(3,1)[0];steps.splice(1,0,gate);
 const run:Run={id,agentId:agent.id,task:({'a-support':'Prepare a customer support reply','a-research':'Compile a cited market brief','a-revenue':'Draft an account outreach note','a-finance':'Reconcile approved ledger entries','a-triage':'Create an incident investigation ticket','a-risk':'Validate tenant isolation controls'} as Record<string,string>)[agent.id]||'Review agent request',status,at,duration,tokens,cost:Number((tokens*.0000024).toFixed(4)),risk:risky?'High':agent.risk,steps,...(definition?{configurationRevision:definition.revision}:{})};
 const call:ToolCall={id:`TC-${index}`,agentId:agent.id,runId:id,name,at,status:status==='Blocked'?'Blocked':status==='Failed'?'Failed':'Success',latency,risk:risky?'High':'Low',input:context.input,output:status==='Failed'?'Timed out after the connector deadline. No result retained.':status==='Blocked'?'Invocation blocked. No tool output or external side effect.':context.output,permissions:[context.permission],checks:[...(definition?definition.guardrails.filter(g=>g.enabled).map(g=>`${g.name}: ${risky&&g.name===scenario.rule?status==='Blocked'?'blocked':'approval required':'passed'}`):['PII redaction: passed',risky?`${scenario.rule}: review required`:'Tenant boundary: passed']),'Least privilege: scoped']};
 return {run,calls:[call]};
}
export function createSeed(now=Date.now()):Store{
 const ago=(min:number)=>new Date(now-min*60000).toISOString();
 const users:Store['users']=[
  {id:'u-owner',name:'Workspace owner',role:'Owner',expertise:['Platform governance','All domains'],agentIds:['a-support','a-research','a-revenue','a-finance','a-triage','a-risk'],available:true},
  {id:'u-admin',name:'Jordan Lee',role:'Admin',expertise:['Operations','Customer experience'],agentIds:['a-support','a-research','a-revenue','a-triage'],available:true},
  {id:'u-sme',name:'Priya Shah',role:'SME',expertise:['Privacy','Customer communications'],agentIds:['a-support','a-research','a-revenue'],available:true},
  {id:'u-sub',name:'Sam Rivera',role:'Sub-admin',expertise:['Security','Incident response'],agentIds:['a-triage','a-risk','a-support'],available:true},
  {id:'u-finance',name:'Maya Chen',role:'SME',expertise:['Finance','Compliance'],agentIds:['a-finance','a-risk'],available:false}
 ];
 const agents:Agent[]=[
  {id:'a-support',name:'Customer Care Crew',description:'Triages support cases, retrieves CRM context, and prepares reviewed customer replies.',framework:'CrewAI',environment:'Production',status:'Active',ownerId:'u-admin',risk:'Medium',connectorId:'c-crew',reviewerIds:['u-sme','u-sub'],policies:['External communications gate','PII redaction','Tenant isolation'],tools:['crm_lookup','email_draft','ticket_create'],lastActive:ago(.1)},
  {id:'a-research',name:'Market Intelligence',description:'Finds public sources and builds cited market briefs through a research graph.',framework:'LangGraph',environment:'Production',status:'Active',ownerId:'u-admin',risk:'Low',connectorId:'c-graph',reviewerIds:['u-sme'],policies:['Public sources only','PII redaction'],tools:['web_search','database_query'],lastActive:ago(.3)},
  {id:'a-revenue',name:'Revenue Copilot',description:'Enriches account summaries and prepares outbound drafts with a mandatory review.',framework:'LangGraph',environment:'Staging',status:'Active',ownerId:'u-admin',risk:'High',connectorId:'c-graph',reviewerIds:['u-sme'],policies:['External communications gate','Tenant isolation'],tools:['crm_lookup','email_draft'],lastActive:ago(.6)},
  {id:'a-finance',name:'Finance Reconciler',description:'Reconciles approved ledger views and flags payment changes for a finance reviewer.',framework:'Custom',environment:'Production',status:'Degraded',ownerId:'u-owner',risk:'High',connectorId:'c-custom',reviewerIds:['u-finance'],policies:['Read-only financial access','Payment approval'],tools:['database_query','ticket_create'],lastActive:ago(4)},
  {id:'a-triage',name:'Incident Triage',description:'Groups security signals and opens investigation tickets using scoped context.',framework:'CrewAI',environment:'Production',status:'Active',ownerId:'u-admin',risk:'Medium',connectorId:'c-crew',reviewerIds:['u-sub'],policies:['Credential redaction','Tenant isolation'],tools:['ticket_create','web_search'],lastActive:ago(1)},
  {id:'a-risk',name:'Risk Sentinel',description:'Tests compliance rules against masked records before promotion to production.',framework:'Custom',environment:'Staging',status:'Paused',ownerId:'u-owner',risk:'Critical',connectorId:'c-custom',reviewerIds:['u-sub','u-finance'],policies:['Read-only financial access','Tenant isolation'],tools:['database_query'],lastActive:ago(26)}
 ];
 const definitions=agents.map(a=>createDefinition(a,ago(140)));
 const runs:Run[]=[],toolCalls:ToolCall[]=[];
 for(let i=1;i<=96;i++){const a=agents[(i-1)%agents.length];const pair=makeRun(a,i,ago((97-i)*1.4),definitions.find(d=>d.agentId===a.id));runs.unshift(pair.run);toolCalls.unshift(...pair.calls)}
 agents.forEach(a=>{a.lastActive=runs.find(r=>r.agentId===a.id)!.at});
 const blocked=runs.filter(r=>r.status==='Blocked');
 const policies:Store['policies']=blocked.slice(0,7).map((r,i)=>{const a=agents.find(a=>a.id===r.agentId)!;const scenario=reviewScenario(a,definitions.find(d=>d.agentId===a.id),r.status);return {id:`POL-${104+i}`,agentId:r.agentId,runId:r.id,rule:scenario.rule,severity:i%3===0?'Critical':'High',action:scenario.action,at:r.at,status:i===4?'Resolved':i%2?'In review':'Open',disposition:'Blocked',context:scenario.context,notes:i===4?'Scope corrected and reviewed in the sandbox.':'Review the permitted scope before retrying.',assigneeId:i===0?null:a.reviewerIds[0]}});
 // Include different policy dispositions, linked to matching captured run outcomes.
 for(const [i,r] of runs.filter(r=>r.status==='Awaiting approval'||r.status==='Failed').slice(0,4).entries()){
  const a=agents.find(a=>a.id===r.agentId)!,scenario=reviewScenario(a,definitions.find(d=>d.agentId===a.id),r.status);
  policies.push({id:`POL-S${i}`,agentId:a.id,runId:r.id,rule:r.status==='Failed'?'Connector response deadline':scenario.rule,severity:r.status==='Failed'?'Medium':'High',action:r.status==='Failed'?'Read from a timed-out connector':scenario.action,at:r.at,status:'Open',disposition:r.status==='Failed'?'Flagged':'Allowed with approval',context:r.status==='Failed'?'The scoped connector timed out. No result was retained; retry requires operator review.':scenario.context,notes:'Review the recorded context and document remediation.',assigneeId:null});
 }
 const waiting=runs.filter(r=>r.status==='Awaiting approval');
 const approvals:Store['approvals']=waiting.slice(0,7).map((r,i)=>{const a=agents.find(a=>a.id===r.agentId)!,scenario=reviewScenario(a,definitions.find(d=>d.agentId===a.id),r.status);return {id:`APR-${201+i}`,agentId:r.agentId,runId:r.id,action:scenario.action,risk:'High',context:scenario.context,status:i===4?'Expired':i===5?'Approved':'Pending',at:r.at,expiresAt:new Date(now+(i===4?-5:45+i*5)*60000).toISOString(),assigneeId:i===0?null:a.reviewerIds[0],note:i===5?'Approved after verifying the masked context and permitted scope.':'',...(i===5?{decisionAt:ago(12)}:{})}});
 const assignments:Store['assignments']=[...approvals,...policies].filter(a=>a.assigneeId).map((a,i)=>({id:`AS-${i}`,reviewId:a.id,fromId:null,toId:a.assigneeId!,actorId:'u-owner',at:a.at,note:'Initial domain routing'}));
 const audit:Store['audit']=[...policies.map(p=>({id:`AU-${p.id}`,actorId:'system',action:'Policy evaluated',target:p.id,at:p.at,outcome:p.disposition,agentId:p.agentId})),...approvals.map(p=>({id:`AU-${p.id}`,actorId:'system',action:'Approval requested',target:p.id,at:p.at,outcome:'Pending',agentId:p.agentId})),...assignments.map(a=>({id:`AU-${a.id}`,actorId:a.actorId,action:'Review assigned',target:a.reviewId,at:a.at,outcome:`Assigned to ${users.find(u=>u.id===a.toId)?.name}`,agentId:[...approvals,...policies].find(p=>p.id===a.reviewId)?.agentId})) ,...approvals.filter(a=>a.status==='Approved'||a.status==='Expired').map(a=>({id:`AU-FINAL-${a.id}`,actorId:a.status==='Approved'?'u-owner':'system',action:`Approval ${a.status.toLowerCase()}`,target:a.id,at:a.decisionAt||a.expiresAt,outcome:a.status,agentId:a.agentId}))].sort((a,b)=>b.at.localeCompare(a.at));
 return withGlobalPolicyDefaults(withEndToEndDemo({version:1,agents,definitions,runs,toolCalls,policies,approvals,users,assignments,audit,sequence:96,updatedAt:ago(0),connectors:[
  {id:'c-crew',name:'CrewAI gateway',type:'MCP',framework:'CrewAI',agentId:'a-support',status:'Healthy',lastCheck:ago(.5),tools:['crm_lookup','email_draft','ticket_create'],endpoint:'https://crewai.example.invalid/mcp'},
  {id:'c-graph',name:'LangGraph bridge',type:'MCP',framework:'LangGraph',agentId:'a-research',status:'Healthy',lastCheck:ago(1),tools:['web_search','database_query','email_draft'],endpoint:'https://langgraph.example.invalid/mcp'},
  {id:'c-custom',name:'Internal agent adapter',type:'Custom',framework:'Custom',agentId:'a-finance',status:'Degraded',lastCheck:ago(4),tools:['database_query','ticket_create'],endpoint:'https://agents.example.invalid/events'}]}));
}
