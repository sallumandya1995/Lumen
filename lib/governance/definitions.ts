import type {Agent,AgentConfiguration,AgentDefinition,AgentNode,Store,User} from './types';
import {createEndToEndDemo,END_TO_END_DEMO_ID,withEndToEndDemo} from './end-to-end-demo';
import {agentBaseUrl,DEFAULT_MODEL,DEFAULT_AGENT_BASE_URL,validAgentModelId} from '../models.mjs';
import {validatePolicyRules,withGlobalPolicyDefaults} from './policy-config';

export const TOOL_CATALOG=[
 {name:'web_search',label:'Web search',description:'Search approved public sources and return cited summaries.'},
 {name:'crm_lookup',label:'CRM lookup',description:'Read permitted account fields with personal identifiers masked.'},
 {name:'database_query',label:'Database query',description:'Read approved aggregate views within the assigned tenant.'},
 {name:'email_draft',label:'Email draft',description:'Prepare a message for human review; no external delivery.'},
 {name:'ticket_create',label:'Ticket creation',description:'Prepare a scoped incident ticket behind a review gate.'}
];
const specialties:Record<string,[string,string,string,string]>={
 'a-support':['Case triage','Reply specialist','Classify the customer issue using only approved case fields.','Prepare a clear, empathetic reply grounded in the permitted CRM context.'],
 'a-research':['Source researcher','Brief editor','Find relevant, approved public sources and preserve citation links.','Synthesize the sources into a concise brief and label any unresolved claims.'],
 'a-revenue':['Account researcher','Outreach writer','Summarize the account context without exposing contact identifiers.','Draft relevant outreach and hold delivery for the assigned reviewer.'],
 'a-finance':['Ledger analyst','Exception reviewer','Compare approved ledger aggregates and flag discrepancies.','Summarize reconciliation exceptions without changing payment records.'],
 'a-triage':['Signal classifier','Incident coordinator','Group related security signals within the assigned tenant.','Prepare an incident handoff with severity, supporting signals, and next actions.'],
 'a-risk':['Boundary tester','Compliance reviewer','Evaluate masked examples against configured data boundaries.','Record violations with sanitized evidence and a concise remediation summary.']
};
export function createDefinition(agent:Agent,at=new Date().toISOString()):AgentDefinition {
 if(agent.id===END_TO_END_DEMO_ID)return createEndToEndDemo(at,agent.ownerId).definition;
 const [first,second,firstPrompt,secondPrompt]=specialties[agent.id]||['Context specialist','Response reviewer','Collect the permitted context for this request.','Review the proposed result against the task and configured policies.'];
 const node=(id:string,label:string,kind:AgentNode['kind'],description:string,prompt='',extra:Partial<AgentNode>={}):AgentNode=>({id,label,kind,description,prompt,enabled:true,...extra});
 const nodes:AgentNode[]=[
  node('input','Task input','Input','Accept the task and its scoped workspace context.'),
  node('coordinator',agent.name,'Agent',agent.description,'Route work to the smallest necessary set of specialist nodes.'),
  node('specialist',first,'Sub-agent','Analyze the request and gather permitted evidence.',firstPrompt),
  ...agent.tools.map((tool,i)=>node(`tool-${i}`,TOOL_CATALOG.find(t=>t.name===tool)?.label||tool,'Tool','Use this scoped capability in the simulated workflow.','',{toolName:tool})),
  node('memory','Scoped context','Memory','Retain the configured context with personal data redacted.'),
  node('reviewer',second,'Sub-agent','Check the proposed result and prepare a concise recorded summary.',secondPrompt),
  node('guardrail','Policy checkpoint','Guardrail','Evaluate the configured guardrails before producing the result.'),
  node('output','Reviewed result','Output','Return the permitted result or hold it for human approval.')
 ];
 const connections:[string,string,string][]=[['input','coordinator','Route task'],['coordinator','specialist','Delegate analysis'],['coordinator','memory','Recall context'],...agent.tools.map((_,i):[string,string,string]=>['specialist',`tool-${i}`,'Scoped capability']),...agent.tools.map((_,i):[string,string,string]=>[`tool-${i}`,'reviewer','Evidence']),['memory','reviewer','Scoped context'],['reviewer','guardrail','Proposed result'],['guardrail','output','Permitted result']];
 const edges=connections.map(([source,target,label],i)=>({id:`edge-${i}`,source,target,label}));
 return {agentId:agent.id,revision:1,updatedAt:at,updatedBy:agent.ownerId,
  model:{provider:'Nebius',name:DEFAULT_MODEL,baseUrl:DEFAULT_AGENT_BASE_URL,temperature:agent.id==='a-research'?.4:.2,maxTokens:4096},
  prompt:{system:`You are ${agent.name}. ${agent.description} Work only within the assigned tenant and approved tools. Return a concise decision summary with relevant evidence; never include hidden internal reasoning.`,goal:agent.description,outputFormat:agent.id==='a-research'?'Cited brief with key findings, source links, and open questions.':'Structured summary with outcome, evidence references, and next action.'},
  memory:{enabled:true,strategy:agent.framework==='LangGraph'?'Rolling summary':'Session',scope:'Agent',retentionDays:7,maxItems:50,redactPII:true},
  limits:{maxSteps:24,timeoutSeconds:120,retries:2,budgetUsd:.25,requireApproval:true},nodes,edges,
  guardrails:agent.policies.map((name,i)=>({id:`guard-${i}`,name,description:`Enforce ${name.toLowerCase()} for the assigned agent context.`,enabled:true,action:/approval|communications/i.test(name)?'Require approval':'Block',severity:/payment|tenant/i.test(name)?'High':'Medium',stage:/redaction/i.test(name)?'Input':/communications|approval/i.test(name)?'Output':'Tool'}))};
}
export function configurationFrom(agent:Agent,definition:AgentDefinition):AgentConfiguration {
 const {name,description,framework,environment,status,risk,connectorId,reviewerIds,tools}=agent;
 const {agentId,revision,updatedAt,updatedBy,...configuration}=definition;
 return structuredClone({agent:{name,description,framework,environment,status,risk,connectorId,reviewerIds,tools},definition:configuration,expectedRevision:revision});
}
const object=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=(v:any,max:number,required=true)=>typeof v==='string'&&v.length<=max&&(!required||v.trim().length>0);
const number=(v:any,min:number,max:number,integer=false)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max&&(!integer||Number.isInteger(v));
const list=(v:any,max=100)=>Array.isArray(v)&&v.length<=max&&v.every((x:any)=>typeof x==='string')&&new Set(v).size===v.length;
const hasAccess=(u:User,id:string)=>u.role==='Owner'||u.agentIds.includes(id);
function need(ok:any,message:string):asserts ok {if(!ok)throw Error(message)}
export function validateConfiguration(id:string,draft:AgentConfiguration,state:Store,user?:User,relationships=true):AgentConfiguration {
 const current=state.agents.find(a=>a.id===id);need(current,'Agent not found.');
 if(user)need((user.role==='Owner'||user.role==='Admin')&&hasAccess(user,id),'Agent configuration requires assigned admin access.');
 need(object(draft)&&object(draft.agent)&&object(draft.definition),'Agent configuration is incomplete.');
 const a=draft.agent,d=draft.definition;
 need(number(draft.expectedRevision,1,Number.MAX_SAFE_INTEGER,true),'Configuration revision is missing. Reload the agent.');
 need(text(a.name,100)&&text(a.description,2000),'Add an agent name (up to 100 characters) and description (up to 2,000).');
 need(['CrewAI','LangGraph','Custom'].includes(a.framework)&&['Production','Staging'].includes(a.environment)&&['Active','Paused','Degraded'].includes(a.status)&&['Low','Medium','High','Critical'].includes(a.risk),'Choose valid agent framework, environment, status, and risk values.');
 need(text(a.connectorId,200)&&(!relationships||state.connectors.some(c=>c.id===a.connectorId)),'Select an existing connector.');
 if(user&&user.role!=='Owner')need(a.connectorId===current.connectorId||state.connectors.some(c=>c.id===a.connectorId&&(c.createdById===user.id||state.agents.some(other=>other.connectorId===c.id&&hasAccess(user,other.id)))),'The connector is outside your assigned scope.');
 need(list(a.reviewerIds,20)&&(!relationships||a.reviewerIds.every(uid=>state.users.some(u=>u.id===uid&&hasAccess(u,id)))),'Reviewers must be assigned to this agent.');
 need(list(a.tools,20)&&a.tools.length>0&&a.tools.every(t=>TOOL_CATALOG.some(tool=>tool.name===t)),'Select at least one supported tool.');
 need(object(d.model)&&text(d.model.provider,80)&&d.model.provider.trim().toLowerCase()==='nebius'&&text(d.model.name,200)&&number(d.model.temperature,0,2)&&number(d.model.maxTokens,1,32768,true),'Model settings require Nebius, a model ID, temperature 0–2, and a token limit of 1–32,768.');
 const modelName=d.model.name.trim();
 need(validAgentModelId(modelName),'Enter a valid Nebius model ID using letters, numbers, periods, slashes, colons, underscores, or hyphens.');
 const modelBaseUrl=agentBaseUrl({...d.model,name:modelName});
 need(modelBaseUrl,'Select an approved Nebius base URL: US Central, US North, or Global.');
 need(object(d.prompt)&&text(d.prompt.system,16000)&&text(d.prompt.goal,4000)&&text(d.prompt.outputFormat,4000),'Add system instructions, a task goal, and an output format within their character limits.');
 need(object(d.memory)&&typeof d.memory.enabled==='boolean'&&['Session','Rolling summary','Vector store'].includes(d.memory.strategy)&&['Run','Agent','Workspace'].includes(d.memory.scope)&&number(d.memory.retentionDays,0,365,true)&&number(d.memory.maxItems,1,10000,true)&&typeof d.memory.redactPII==='boolean','Memory settings require a valid strategy, scope, retention of 0–365 days, and 1–10,000 items.');
 need(object(d.limits)&&number(d.limits.maxSteps,1,1000,true)&&number(d.limits.timeoutSeconds,1,3600,true)&&number(d.limits.retries,0,10,true)&&number(d.limits.budgetUsd,.001,1000)&&typeof d.limits.requireApproval==='boolean','Execution limits require 1–1,000 steps, 1–3,600 seconds, 0–10 retries, and a budget of $0.001–$1,000.');
 need(Array.isArray(d.nodes)&&d.nodes.length>=3&&d.nodes.length<=40,'Use 3–40 graph nodes.');
 const kinds=['Input','Agent','Sub-agent','Tool','Guardrail','Memory','Output'];
 need(d.nodes.every(n=>object(n)&&text(n.id,100)&&text(n.label,100)&&text(n.description,2000,false)&&text(n.prompt,8000,false)&&kinds.includes(n.kind)&&typeof n.enabled==='boolean'&&(n.toolName===undefined||text(n.toolName,100,false))&&(n.referencedAgentId===undefined||text(n.referencedAgentId,100,false))),'Each graph node needs a unique ID, label, valid kind, and valid text fields.');
 const ids=new Set(d.nodes.map(n=>n.id));need(ids.size===d.nodes.length,'Graph node IDs must be unique.');
 need(d.nodes.some(n=>n.kind==='Input'&&n.enabled)&&d.nodes.some(n=>n.kind==='Output'&&n.enabled)&&d.nodes.some(n=>n.kind==='Agent'&&n.enabled),'Keep an enabled input, primary agent, and output node.');
 for(const n of d.nodes){if(n.kind==='Tool'&&n.enabled)need(!!n.toolName&&a.tools.includes(n.toolName),'Every enabled tool node must use one of this agent’s enabled tools.');if(n.referencedAgentId)need(n.referencedAgentId!==id&&text(n.referencedAgentId,100)&&(!relationships||state.agents.some(a=>a.id===n.referencedAgentId))&&(!user||hasAccess(user,n.referencedAgentId)),'Referenced sub-agents must exist in your scope and cannot reference their parent.');}
 need(Array.isArray(d.edges)&&d.edges.length<=100&&d.edges.every(e=>object(e)&&text(e.id,100)&&ids.has(e.source)&&ids.has(e.target)&&e.source!==e.target&&text(e.label,200,false)),'Connections must join two different existing graph nodes.');
 need(new Set(d.edges.map(e=>e.id)).size===d.edges.length&&new Set(d.edges.map(e=>`${e.source}\u0000${e.target}`)).size===d.edges.length,'Graph connections must be unique.');
 const adjacent=new Map(d.nodes.map(n=>[n.id,d.edges.filter(e=>e.source===n.id).map(e=>e.target)]));
 const visiting=new Set<string>(),visited=new Set<string>();
 function walk(id:string){need(!visiting.has(id),'This prototype supports directed acyclic graphs. Remove the circular connection.');if(visited.has(id))return;visiting.add(id);for(const next of adjacent.get(id)||[])walk(next);visiting.delete(id);visited.add(id)}
 d.nodes.forEach(n=>walk(n.id));
 const reachable=new Set<string>();function visit(id:string){if(reachable.has(id))return;reachable.add(id);for(const next of adjacent.get(id)||[])visit(next)}d.nodes.filter(n=>n.kind==='Input'&&n.enabled).forEach(n=>visit(n.id));
 need(d.nodes.filter(n=>n.kind==='Output'&&n.enabled).every(n=>reachable.has(n.id)),'Every enabled output must be reachable from an input.');
 need(d.nodes.filter(n=>n.enabled).every(n=>reachable.has(n.id)),'Connect every enabled node to an input, or disable unused nodes.');
 const guardrails=validatePolicyRules(d.guardrails);
 return structuredClone({expectedRevision:draft.expectedRevision,agent:{name:a.name.trim(),description:a.description.trim(),framework:a.framework,environment:a.environment,status:a.status,risk:a.risk,connectorId:a.connectorId,reviewerIds:a.reviewerIds,tools:a.tools},definition:{
  model:{provider:'Nebius',name:modelName,baseUrl:modelBaseUrl,temperature:d.model.temperature,maxTokens:d.model.maxTokens},
  prompt:{system:d.prompt.system,goal:d.prompt.goal,outputFormat:d.prompt.outputFormat},
  memory:{enabled:d.memory.enabled,strategy:d.memory.strategy,scope:d.memory.scope,retentionDays:d.memory.retentionDays,maxItems:d.memory.maxItems,redactPII:d.memory.redactPII},
  limits:{maxSteps:d.limits.maxSteps,timeoutSeconds:d.limits.timeoutSeconds,retries:d.limits.retries,budgetUsd:d.limits.budgetUsd,requireApproval:d.limits.requireApproval},
  nodes:d.nodes.map(n=>({id:n.id,label:n.label,kind:n.kind,description:n.description,prompt:n.prompt,enabled:n.enabled,...(n.toolName?{toolName:n.toolName}:{}),...(n.referencedAgentId?{referencedAgentId:n.referencedAgentId}:{})})),
  edges:d.edges.map(e=>({id:e.id,source:e.source,target:e.target,label:e.label})),
  guardrails
 }});
}
/** Add definitions to an existing v1 snapshot without replacing decisions or historical traces. */
export function upgradeSnapshot(raw:any):any {
 if(!object(raw)||raw.version!==1)return raw;
 const s=structuredClone(raw);
 if(Array.isArray(s.users)){const owner=s.users.find((u:any)=>u?.id==='u-owner');if(owner)owner.name='Workspace owner'}
 if(s.definitions===undefined&&Array.isArray(s.agents)&&s.agents.every((a:any)=>a&&typeof a.id==='string'&&Array.isArray(a.tools)&&Array.isArray(a.policies))){s.definitions=s.agents.map((a:Agent)=>createDefinition(a,s.updatedAt));}
 // Only fill an absent runtime endpoint. Explicit choices and historical runs
 // remain unchanged, including receipts that predate endpoint recording.
 if(Array.isArray(s.definitions))for(const definition of s.definitions){
  if(object(definition)&&object(definition.model)&&definition.model.baseUrl===undefined){
   definition.model.baseUrl=agentBaseUrl({...definition.model,name:typeof definition.model.name==='string'?definition.model.name.trim():definition.model.name});
  }
 }
 return Array.isArray(s.agents)&&Array.isArray(s.definitions)&&Array.isArray(s.connectors)&&Array.isArray(s.users)&&s.users.every((u:any)=>u&&Array.isArray(u.agentIds))?withGlobalPolicyDefaults(withEndToEndDemo(s)):s;
}
/** Structural checks for persisted and API definitions, independent of editor permissions. */
export function hasDefinitions(s:any):boolean {
 if(!Array.isArray(s.definitions)||s.definitions.length!==s.agents.length||new Set(s.definitions.map((d:any)=>d?.agentId)).size!==s.agents.length)return false;
 return s.definitions.every((d:any)=>{try{if(!object(d)||!number(d.revision,1,Number.MAX_SAFE_INTEGER,true)||!text(d.updatedBy,200)||!Number.isFinite(Date.parse(d.updatedAt)))return false;const a=s.agents.find((a:Agent)=>a.id===d.agentId);if(!a)return false;validateConfiguration(a.id,configurationFrom(a,d),s,undefined,false);return true}catch{return false}});
}
