import type {Store,Run,TraceStep} from './types';
import {safeText} from './sanitize';
import {canonical} from './integrity';
export type TelemetrySpan={traceId:string;spanId:string;parentSpanId:string;name:string;start:string;end:string|null;operation:string;status:'Running'|'Success'|'Failed'|'Blocked'|'Awaiting approval';model?:string;tool?:string;inputTokens:number;outputTokens:number;cost:number|null;summary:string;input:string;output:string;policy?:{rule:string;action:'Block'|'Require approval'|'Flag';severity:'Low'|'Medium'|'High'|'Critical';violated:boolean}};
const id=(v:any,n:number)=>typeof v==='string'&&new RegExp(`^[a-f0-9]{${n}}$`,'i').test(v)&&!/^0+$/.test(v);
function attributes(items:any){const out:Record<string,any>={};if(!Array.isArray(items))return out;if(items.length>100)throw Error('At most 100 attributes per span.');for(const item of items){if(typeof item?.key!=='string'||item.key.length>150)continue;const v=item.value;out[item.key]=v?.stringValue??v?.intValue??v?.doubleValue??v?.boolValue}return out}
function nano(v:any,required=true){if(v===undefined||v==='0'||v===0){if(!required)return null;throw Error('A span start timestamp is required.')}if(!/^\d{1,20}$/.test(String(v)))throw Error('Invalid nanosecond timestamp.');const ms=Number(BigInt(String(v))/BigInt(1000000));if(!Number.isSafeInteger(ms)||ms<946684800000||ms>Date.now()+300000)throw Error('Span timestamps must be between 2000 and five minutes in the future.');return new Date(ms).toISOString()}
const count=(v:any)=>{const n=Number(v??0);if(!Number.isSafeInteger(n)||n<0||n>1e9)throw Error('Invalid token count.');return n};
export function normalizeOtlp(body:any,agentId:string):TelemetrySpan[]{
 if(!Array.isArray(body?.resourceSpans)||body.resourceSpans.length>20)throw Error('Expected OTLP JSON resourceSpans (up to 20 resources).');
 const output:TelemetrySpan[]=[];
 for(const resource of body.resourceSpans){const ra=attributes(resource.resource?.attributes);if(ra['lumen.agent.id']&&ra['lumen.agent.id']!==agentId)throw Error('The connector key is scoped to a different agent.');
  if(!Array.isArray(resource.scopeSpans)||resource.scopeSpans.length>20)throw Error('Expected scopeSpans.');
  for(const scope of resource.scopeSpans){if(!Array.isArray(scope.spans)||scope.spans.length>100)throw Error('At most 100 spans per batch.');for(const item of scope.spans){
   if(output.length>=100)throw Error('At most 100 spans per batch.');
   if(!id(item.traceId,32)||!id(item.spanId,16)||item.parentSpanId&&!id(item.parentSpanId,16)||item.spanId===item.parentSpanId)throw Error('Invalid trace or span identifiers.');
   const a=attributes(item.attributes);if(a['lumen.agent.id']&&a['lumen.agent.id']!==agentId)throw Error('Agent scope mismatch.');
   const start=nano(item.startTimeUnixNano)!,end=nano(item.endTimeUnixNano,false);if(end&&end<start)throw Error('A span cannot end before it starts.');
   const operation=String(a['gen_ai.operation.name']||'invoke_agent');
   const declared=a['lumen.status'];const status=!end?'Running':declared==='Blocked'||declared==='Awaiting approval'?declared:item.status?.code===2||item.status?.code==='STATUS_CODE_ERROR'?'Failed':'Success';
   const name=safeText(item.name||operation,200);if(!name.trim())throw Error('Span name is required.');
   const cost=a['lumen.cost.usd']===undefined?null:Number(a['lumen.cost.usd']);if(cost!==null&&(!Number.isFinite(cost)||cost<0||cost>1e6))throw Error('Invalid cost.');
   const span:TelemetrySpan={traceId:item.traceId.toLowerCase(),spanId:item.spanId.toLowerCase(),parentSpanId:(item.parentSpanId||'').toLowerCase(),name,start,end,operation:safeText(operation,60),status,model:typeof a['gen_ai.request.model']==='string'?safeText(a['gen_ai.request.model'],200):undefined,tool:typeof a['gen_ai.tool.name']==='string'?safeText(a['gen_ai.tool.name'],200):undefined,inputTokens:count(a['gen_ai.usage.input_tokens']),outputTokens:count(a['gen_ai.usage.output_tokens']),cost,summary:safeText(a['lumen.summary']||'Recorded by the authenticated agent connector. Hidden reasoning is not collected.',2000),input:safeText(a['lumen.input.summary']||'',4000),output:safeText(a['lumen.output.summary']||'',8000)};
   if(a['lumen.policy.rule']){const action=a['lumen.policy.action'];if(!['Block','Require approval','Flag'].includes(action))throw Error('Invalid policy disposition.');span.policy={rule:safeText(a['lumen.policy.rule'],200),action,severity:['Low','Medium','High','Critical'].includes(a['lumen.policy.severity'])?a['lumen.policy.severity']:'Medium',violated:a['lumen.policy.violated']===true}}
   output.push(span);
  }}
 }
 if(!output.length)throw Error('At least one span is required.');return output;
}
/** Upsert spans by (workspace, agent, trace, span). Older/replayed updates never regress a completed span. */
export function ingestSpans(store:Store,agentId:string,keyId:string,incoming:TelemetrySpan[]){
 const agent=store.agents.find(a=>a.id===agentId);if(!agent)throw Error('Agent not found.');let accepted=0,duplicates=0;
 for(const traceId of new Set(incoming.map(s=>s.traceId))){
  const acceptedBefore=accepted,runId=`OTEL-${agentId}-${traceId}`,prior=store.runs.find(r=>r.id===runId),map=new Map<string,TelemetrySpan>((prior?.telemetrySpans||[]).map(s=>[s.spanId,s]));
  for(const span of incoming.filter(s=>s.traceId===traceId)){const previous=map.get(span.spanId);if(previous){
   if(previous.start!==span.start||previous.parentSpanId!==span.parentSpanId)throw Error('A span ID was reused with a different start or parent.');
   if(canonical(previous)===canonical(span)||previous.end&&(!span.end||span.end<previous.end)){duplicates++;continue}
   if(previous.end&&span.end)throw Error('A completed span was replayed with conflicting content.');
  }map.set(span.spanId,span);accepted++}
  if(accepted===acceptedBefore)continue;
  if(map.size>500)throw Error('A trace supports at most 500 spans. Split longer workflows into linked traces.');
  const spans=[...map.values()].sort((a,b)=>a.start.localeCompare(b.start)||a.spanId.localeCompare(b.spanId));
  for(const span of spans){let p=span.parentSpanId;const seen=new Set([span.spanId]);while(p&&map.has(p)){if(seen.has(p))throw Error('Cyclic span parent relationship.');seen.add(p);p=map.get(p)!.parentSpanId}}
  const roots=spans.filter(s=>!s.parentSpanId),complete=roots.length>0&&roots.every(s=>!!s.end)&&spans.every(s=>!!s.end);
  const status:Run['status']=!complete?'Running':spans.some(s=>s.status==='Blocked')?'Blocked':spans.some(s=>s.status==='Awaiting approval')?'Awaiting approval':spans.some(s=>s.status==='Failed')?'Failed':'Success';
  const root=roots[0]||spans[0],modelSpans=spans.filter(s=>s.operation==='chat'||s.operation==='text_completion'),costKnown=modelSpans.length>0&&modelSpans.every(s=>s.cost!==null),at=spans[0].start,end=Math.max(...spans.map(s=>Date.parse(s.end||s.start)));
  const steps:TraceStep[]=spans.map(s=>({label:s.name,kind:s.policy?'Policy check':s.tool||s.operation==='execute_tool'?'Tool call':s.parentSpanId?'Handoff':'Decision summary',nodeId:s.spanId,summary:s.summary,duration:Math.max(0,Date.parse(s.end||s.start)-Date.parse(s.start)),outcome:s.status,input:s.input,output:s.output,model:s.model,tokens:s.inputTokens+s.outputTokens}));
  const run:Run={id:runId,agentId,task:root.input||root.name,status,at,duration:end-Date.parse(at),tokens:modelSpans.reduce((n,s)=>n+s.inputTokens+s.outputTokens,0),cost:costKnown?modelSpans.reduce((n,s)=>n+(s.cost||0),0):0,costKnown,risk:agent.risk,steps,source:'live',provenance:'external',traceId,connectorKeyId:keyId,telemetrySpans:spans,model:modelSpans.find(s=>s.model)?.model,output:root.output,warnings:['External telemetry is reported by an authenticated connector. Lumen observes it; policy enforcement and tool execution remain in that agent runtime.']};
  if(prior)Object.assign(prior,run);else store.runs.unshift(run);
  for(const span of spans){if((span.tool||span.operation==='execute_tool')&&span.end){const call={id:`TC-${runId}-${span.spanId}`,agentId,runId,name:span.tool||span.name,at:span.start,status:span.status==='Success'?'Success' as const:span.status==='Blocked'||span.status==='Awaiting approval'?'Blocked' as const:'Failed' as const,latency:Date.parse(span.end)-Date.parse(span.start),risk:agent.risk,input:span.input,output:span.output,permissions:['Reported by authenticated external connector'],checks:span.policy?[`${span.policy.rule}: ${span.policy.violated?'violated':'passed'}`]:['No policy check was reported'],nodeId:span.spanId};const old=store.toolCalls.find(t=>t.id===call.id);if(old)Object.assign(old,call);else store.toolCalls.unshift(call)}
   if(span.policy?.violated){const policy=span.policy,eventId=`POL-${runId}-${span.spanId}`;if(!store.policies.some(p=>p.id===eventId))store.policies.unshift({id:eventId,agentId,runId,rule:policy.rule,severity:policy.severity,action:policy.action,at:span.start,status:'Open',disposition:policy.action==='Block'?'Blocked':'Flagged',context:span.summary,notes:'Reported by the external runtime; review decisions do not resume external execution.',assigneeId:null});
    if(policy.action==='Require approval'&&!store.approvals.some(p=>p.id===`APR-${runId}-${span.spanId}`))store.approvals.unshift({id:`APR-${runId}-${span.spanId}`,agentId,runId,action:policy.rule,risk:policy.severity,context:span.summary,status:'Pending',at:span.start,expiresAt:new Date(Date.now()+86400000).toISOString(),assigneeId:null,note:'External runtime must implement approval/resume separately.'});
   }
  }
  agent.lastActive=new Date().toISOString();
 }
 if(accepted){store.updatedAt=new Date().toISOString();store.audit.unshift({id:'AU-'+crypto.randomUUID(),actorId:'connector:'+keyId,action:'External telemetry received',target:agentId,agentId,at:store.updatedAt,outcome:`${accepted} spans accepted; ${duplicates} duplicates ignored`})}
 return {accepted,duplicates,runIds:[...new Set(incoming.map(s=>`OTEL-${agentId}-${s.traceId}`))]};
}
