import type {ExecutionEvent,ExecutionRequest,ExecutionResult,NodeExecution} from './types';
import {agentBaseUrl} from '../models.mjs';

/** Live inference uses the Site's server secret. The server permits only
 * approved Nebius endpoints; the separate governance service stores results. */
export async function runAgentExecution(request:ExecutionRequest,options:{signal?:AbortSignal;onEvent?:(event:ExecutionEvent)=>void}={}):Promise<ExecutionResult> {
 let id=`RUN-${crypto.randomUUID()}`,at=new Date().toISOString(),started=false,completed:ExecutionResult|undefined;
 const nodes:NodeExecution[]=[];
 const partial=(status:'Failed'|'Cancelled',message:string):ExecutionResult=>({
  id,agentId:request.agent.id,configurationRevision:request.definition.revision,...(request.globalPolicies?{globalPolicyRevision:request.globalPolicies.revision}:{}),mode:request.nodeId?'node':'agent',...(request.nodeId?{nodeId:request.nodeId}:{}),
  input:request.input,output:'',status,at,duration:Math.max(0,Date.now()-Date.parse(at)),tokens:nodes.reduce((n,s)=>n+s.tokens,0),cost:nodes.reduce((n,s)=>n+s.cost,0),costKnown:false,model:request.definition.model.name,baseUrl:agentBaseUrl(request.definition.model)||undefined,nodes:[...nodes],policies:[],warnings:[message,'Partial run. Completed node outputs are retained; the workflow did not finish.','Interrupted calls may have consumed tokens that the provider has not reported.'],
 });
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try{
  if(options.signal?.aborted)return partial('Cancelled','Run stopped before it started.');
  const response=await fetch('/api/agent-run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:options.signal});
  if(!response.ok){const data:any=await response.json().catch(()=>({}));throw new Error(data.error||`Agent execution failed (${response.status}).`)}
  if(!response.body)throw new Error('The execution service did not return a run stream.');
  reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';
  const accept=(line:string)=>{
   if(!line.trim())return;
   if(options.signal?.aborted)throw new DOMException('Execution cancelled.','AbortError');
   const event=JSON.parse(line) as ExecutionEvent;
   if(!event||typeof event!=='object'||typeof event.type!=='string')throw new Error('The execution service returned an invalid event.');
   if(event.type==='start'){
    if(started||typeof event.id!=='string'||!Number.isFinite(Date.parse(event.at)))throw new Error('The run stream has an invalid start record.');
    started=true;id=event.id;at=event.at;
   }else if(event.type==='node-result'){
    if(!event.node||typeof event.node.nodeId!=='string')throw new Error('The run stream has an invalid node result.');
    const previous=nodes.findIndex(n=>n.nodeId===event.node.nodeId);if(previous>=0)nodes[previous]=event.node;else nodes.push(event.node);
   }else if(event.type==='complete'){
    const r=event.result;
    if(!started||!r||r.id!==id||r.agentId!==request.agent.id||r.configurationRevision!==request.definition.revision||r.globalPolicyRevision!==request.globalPolicies?.revision||r.mode!==(request.nodeId?'node':'agent')||r.nodeId!==request.nodeId||!Array.isArray(r.nodes)||!Array.isArray(r.policies))throw new Error('The returned run does not match this agent configuration.');
    completed=r;
   }else if(event.type==='error')throw new Error(event.message||'Agent execution failed.');
   else if(event.type!=='node-start')throw new Error('The execution service returned an unknown event.');
   options.onEvent?.(event);
  };
  while(true){
   const chunk=await reader.read();if(options.signal?.aborted)return partial('Cancelled','Run stopped. No further nodes were requested.');
   buffer+=decoder.decode(chunk.value,{stream:!chunk.done});
   if(buffer.length>2_000_000)throw new Error('The execution event exceeded the supported size.');
   const lines=buffer.split('\n');buffer=lines.pop()||'';for(const line of lines)accept(line);
   if(chunk.done){accept(buffer);break}
  }
  if(!completed)throw new Error('The run connection ended before completion.');
  return completed;
 }catch(error:any){
  if(options.signal?.aborted||error?.name==='AbortError')return partial('Cancelled','Run stopped. No further nodes were requested.');
  if(started)return partial('Failed',error.message||'The run connection failed.');
  throw error;
 }finally{await reader?.cancel().catch(()=>{});reader?.releaseLock()}
}
