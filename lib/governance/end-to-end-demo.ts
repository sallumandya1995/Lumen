import type {Agent,AgentDefinition,Connector,Store} from './types';
import {DEFAULT_MODEL,DEFAULT_AGENT_BASE_URL} from '../models.mjs';

export const END_TO_END_DEMO_ID='a-lumen-demo';
export const END_TO_END_DEMO_INPUT='A customer says they were charged $29 twice for this month’s subscription. Review the available account information and prepare an internal triage memo covering the known facts, missing details, and recommended next steps. Have a second specialist check the memo for clarity and unsupported claims, then return the final version here.';

/** A separate, read-only example. Existing agents keep their approval rules. */
export function createEndToEndDemo(at=new Date().toISOString(),ownerId='u-owner'):{agent:Agent;definition:AgentDefinition;connector:Connector}{
 const agent:Agent={id:END_TO_END_DEMO_ID,name:'Lumen · End-to-end workflow',description:'Turn a support request into an internally reviewed memo. A read-only account lookup and two writing roles complete without an approval pause.',framework:'Custom',environment:'Staging',status:'Active',ownerId,risk:'Low',connectorId:'c-lumen-demo',reviewerIds:[],policies:[],tools:['crm_lookup'],lastActive:at};
 const definition:AgentDefinition={agentId:agent.id,revision:1,updatedAt:at,updatedBy:ownerId,
  model:{provider:'Nebius',name:DEFAULT_MODEL,baseUrl:DEFAULT_AGENT_BASE_URL,temperature:.2,maxTokens:8192},
  prompt:{system:'You are a read-only support assistant using locally supplied sample account records. These records are not retrieved from an external CRM. Produce an internal memo, never perform or claim an external action. Never send a message, create a ticket, approve a refund, or alter an account. Do not wait for human approval: the only deliverable is the completed internal memo. Distinguish supplied facts from missing information and recommendations. Return the useful result only, with no hidden reasoning.',goal:'Complete the input, tool, agent, specialist, run-memory, and output workflow by returning a concise reviewed internal triage memo.',outputFormat:'A concise memo with: Case summary; Known facts; Missing information; Recommended next step. Distinguish reported information from verified findings. Keep the final memo under 220 words.'},
  memory:{enabled:true,strategy:'Session',scope:'Run',retentionDays:0,maxItems:100,redactPII:true},
  limits:{maxSteps:12,timeoutSeconds:240,retries:1,budgetUsd:.25,requireApproval:false},
  nodes:[
   {id:'input',label:'Support case',kind:'Input',description:'Accept the support request and its account context.',prompt:'Prepare an internal support memo from the supplied information.',enabled:true},
   {id:'crm-context',label:'Read account context',kind:'Tool',description:'Return the account record from the local lookup function.',prompt:'Use the built-in read-only crm_lookup function.',enabled:true,toolName:'crm_lookup'},
   {id:'triage-memo',label:'Prepare triage memo',kind:'Agent',description:'Combine the original task and local account context into an internal triage memo.',prompt:'Use only the original task and supplied local account record. Do not invent transaction details or confirmed duplicate charges. Identify unknowns. Write a concise internal memo, without asking for approval or proposing an external tool action.',enabled:true},
   {id:'review-memo',label:'Review and refine memo',kind:'Sub-agent',description:'A second model role checks the memo and returns a polished final version.',prompt:'Review the preceding memo for unsupported factual claims and clarity. Preserve its useful facts; correct or remove assumptions not supported by the original request and local account record. Return the complete refined memo, not a review verdict. Do not require a person to approve it; no external action will occur.',enabled:true},
   {id:'memory',label:'Keep run context',kind:'Memory',description:'Pass the reviewed memo through run-scoped memory with identifier redaction.',prompt:'Keep only this run context; no persistent memory backend is used.',enabled:true},
   {id:'output',label:'Completed memo',kind:'Output',description:'Return the reviewed memo to the user and complete the workflow.',prompt:'Return the final memo in this interface only.',enabled:true}
  ],
  edges:[['input','crm-context','Read account context'],['crm-context','triage-memo','Prepare memo'],['triage-memo','review-memo','Specialist review'],['review-memo','memory','Keep reviewed context'],['memory','output','Return final memo']].map(([source,target,label],i)=>({id:`demo-edge-${i}`,source,target,label})),
  guardrails:[]};
 const connector:Connector={id:agent.connectorId,name:'Local account lookup',type:'Custom',framework:'Custom',agentId:agent.id,status:'Healthy',lastCheck:at,tools:['crm_lookup'],endpoint:'https://demo.example.invalid/read-only-fixture',createdById:ownerId};
 return {agent,definition,connector};
}

// Match only the originally shipped copy. Saved custom instructions, graph
// settings, permissions, and historical receipts remain authoritative.
const legacyCopy={
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

function refreshOriginalCopy(snapshot:Store,example:ReturnType<typeof createEndToEndDemo>):Store{
 // A partial/corrupt definition must still be surfaced by normal validation.
 const definition=snapshot.definitions.find(d=>d.agentId===END_TO_END_DEMO_ID);
 if(!definition||!definition.prompt||!Array.isArray(definition.nodes)||!Array.isArray(definition.edges))return snapshot;
 let changed=false;
 function refresh<T extends object>(saved:T,original:Partial<Record<keyof T,string>>,current:T):T{
  const result={...saved};
  for(const key of Object.keys(original) as (keyof T)[]){
   if(saved[key]===original[key]&&saved[key]!==current[key]){result[key]=current[key];changed=true}
  }
  return result;
 }
 const nextDefinition={...definition,prompt:refresh(definition.prompt,legacyCopy.prompt,example.definition.prompt),
  nodes:definition.nodes.map(node=>{
   const original=legacyCopy.nodes[node.id as keyof typeof legacyCopy.nodes];
   const current=example.definition.nodes.find(n=>n.id===node.id&&n.kind===node.kind);
   return original&&current?refresh(node,original,current):node;
  }),
  edges:definition.edges.map(edge=>edge.id==='demo-edge-0'&&edge.source==='input'&&edge.target==='crm-context'?refresh(edge,{label:'Read synthetic context'},{...edge,label:'Read account context'}):edge)
 };
 const agents=snapshot.agents.map(agent=>agent.id===END_TO_END_DEMO_ID?refresh(agent,legacyCopy.agent,example.agent):agent);
 const connectors=snapshot.connectors.map(connector=>connector.id===example.connector.id&&connector.agentId===END_TO_END_DEMO_ID?refresh(connector,{name:'Read-only demo fixture'},example.connector):connector);
 return changed?{...snapshot,agents,connectors,definitions:snapshot.definitions.map(d=>d===definition?nextDefinition:d)}:snapshot;
}

/** Add the example once and refresh unchanged original wording. Never replace
 * custom configuration or history; external API snapshots do not use this. */
export function withEndToEndDemo(snapshot:Store):Store{
 const at=Number.isFinite(Date.parse(snapshot.updatedAt))?snapshot.updatedAt:new Date().toISOString();
 const owner=snapshot.users.find(u=>u.role==='Owner')?.id||'u-owner';
 const example=createEndToEndDemo(at,owner);
 const hasAgent=snapshot.agents.some(a=>a.id===END_TO_END_DEMO_ID);
 // Do not heal or overwrite a partial saved example; normal snapshot validation
 // should expose corrupt data instead of silently replacing the user's edits.
 if(hasAgent)return refreshOriginalCopy(snapshot,example);
 return {...snapshot,
  agents:[...snapshot.agents,example.agent],definitions:[...snapshot.definitions,example.definition],
  connectors:snapshot.connectors.some(c=>c.id===example.connector.id)?snapshot.connectors:[...snapshot.connectors,example.connector],
  users:snapshot.users.map(u=>(u.role==='Owner'||u.role==='Admin')&&!u.agentIds.includes(END_TO_END_DEMO_ID)?{...u,agentIds:[...u.agentIds,END_TO_END_DEMO_ID]}:u)
 };
}
