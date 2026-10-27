import {env,waitUntil} from 'cloudflare:workers';
import {executeAgent,validateExecutionRequest} from '../../../lib/agent-execution/engine';
import {createNebiusInvoker} from '../../../lib/agent-execution/nebius';
import type {ExecutionEvent,ExecutionRequest} from '../../../lib/agent-execution/types';
import {workspaceIdentity,sameOrigin,jsonBody,readWorkspace,replyError,HttpError} from '../../../lib/governance/server-store';
import {beginRun,recordNode,finishRun} from '../../../lib/governance/run-recording';

export async function POST(request:Request){
 try{
  sameOrigin(request);const identity=await workspaceIdentity(request),body=await jsonBody(request);
  let payload:ExecutionRequest;try{payload=validateExecutionRequest(body)}catch(error:any){throw new HttpError(400,error?.message||'Invalid agent execution request.')}
  const current=await readWorkspace(identity.id),agent=current?.store.agents.find(a=>a.id===payload.agent.id),definition=current?.store.definitions.find(d=>d.agentId===payload.agent.id);
  if(!current||!agent||!definition)throw new HttpError(404,'Saved agent not found in this workspace.');
  if(definition.revision!==payload.definition.revision||current.store.globalPolicies?.revision!==payload.globalPolicies?.revision)throw new HttpError(409,'The saved configuration or global policies changed. Reload Studio and try again.');
  payload=validateExecutionRequest({agent,definition,globalPolicies:current.store.globalPolicies,references:current.store.definitions.filter(d=>d.agentId!==agent.id).map(d=>({agent:current.store.agents.find(a=>a.id===d.agentId)!,definition:d})),input:payload.input,nodeId:payload.nodeId});
  const key=(env as any).NEBIUS_API_KEY;
  if(!key)return Response.json({error:'The existing Nebius API key is unavailable. Configure NEBIUS_API_KEY in backend secrets.'},{status:503});
  const id='RUN-'+crypto.randomUUID();await beginRun(identity.id,payload,id);
  const controller=new AbortController(),signal=AbortSignal.any([request.signal,controller.signal]),encoder=new TextEncoder();
  let closed=false;
  const stream=new ReadableStream<Uint8Array>({
   start(output){
    const send=(event:ExecutionEvent)=>{if(!closed){try{output.enqueue(encoder.encode(JSON.stringify(event)+'\n'))}catch{closed=true;controller.abort()}}};
    let writes=Promise.resolve();
    const job=executeAgent(payload,{runId:id,signal,invoke:createNebiusInvoker(key),emit:event=>{
     if(event.type==='complete')return;
     if(event.type==='node-result')writes=writes.then(async()=>{await recordNode(identity.id,id,event.node)});
     send(event);
    }}).then(async result=>{await writes.catch(()=>{});await finishRun(identity.id,result);send({type:'complete',result})}).catch(()=>send({type:'error',message:'The run could not be fully recorded. Open Governance to inspect the retained run and completed steps.'})).finally(()=>{if(!closed){closed=true;output.close()}});
    waitUntil(job);
   },
   cancel(){closed=true;controller.abort()}
  });
  return new Response(stream,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }catch(error){return replyError(error)}
}
