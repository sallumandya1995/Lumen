import {agentBaseUrl,validAgentModelId} from '../models.mjs';

export type ModelCall={model:string;baseUrl?:string;system:string;input:string;temperature:number;maxTokens:number;signal:AbortSignal;purpose:'agent'|'policy'};
export type ModelAnswer={text:string;tokens:number};

export class ProviderError extends Error {
 readonly retryable:boolean;
 constructor(message:string,retryable=false){super(message);this.name='ProviderError';this.retryable=retryable}
}

/** Return only the visible answer. Providers may put hidden reasoning in a
 * separate field or wrap it in content; neither belongs in execution traces. */
export function visibleAnswer(content:string):string {
 let text=content.replace(/<(think|analysis)(?:\s[^>]*)?>[\s\S]*?<\/\1\s*>/gi,'');
 // Some responses omit the opening marker. Nothing before its closing marker
 // is safe to present as answer text.
 const closings=[...text.matchAll(/<\/(?:think|analysis)\s*>/gi)];
 if(closings.length){const last=closings[closings.length-1];text=text.slice((last.index||0)+last[0].length)}
 // An unclosed reasoning block contains no completed visible answer.
 text=text.replace(/<(?:think|analysis)(?:\s[^>]*)?>[\s\S]*$/gi,'');
 return text.trim();
}

/** Server-only invoker: callers supply a secret from the backend environment.
 * Model IDs are configurable; credentials go only to approved Nebius endpoints. */
export function createNebiusInvoker(key:string):(call:ModelCall)=>Promise<ModelAnswer> {
 if(!key)throw new ProviderError('The Nebius API key is not configured on the server.');
 return async call=>{
  if(call.signal.aborted)throw new DOMException('Execution cancelled.','AbortError');
  if(!validAgentModelId(call.model))throw new ProviderError('Enter a valid Nebius model ID in Runtime.');
  const baseUrl=agentBaseUrl({name:call.model,baseUrl:call.baseUrl});
  if(!baseUrl)throw new ProviderError('Choose an approved Nebius base URL in Runtime.');
  if(!Number.isFinite(call.temperature)||call.temperature<0||call.temperature>2||!Number.isInteger(call.maxTokens)||call.maxTokens<1||call.maxTokens>32768)throw new ProviderError('The model temperature or token limit is invalid.');
  if(typeof call.system!=='string'||typeof call.input!=='string'||call.system.length+call.input.length>200000)throw new ProviderError('This node has too much context. Shorten the task or its instructions.');
  let response:Response;
  try{
   response=await fetch(baseUrl+'chat/completions',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},signal:call.signal,redirect:'manual',
    body:JSON.stringify({model:call.model,messages:[{role:'system',content:call.system+'\nReturn only the requested final result or concise decision summary. Do not include hidden reasoning, analysis, or chain-of-thought.'},{role:'user',content:call.input}],temperature:call.temperature,max_tokens:call.maxTokens,stream:false}),
   });
  }catch{
   if(call.signal.aborted)throw new DOMException('Execution cancelled.','AbortError');
   throw new ProviderError('Could not reach Nebius. The node did not complete.',true);
  }
  if(response.status>=300&&response.status<400)throw new ProviderError('Nebius returned a redirect. The request stopped without following it. Check the regional base URL in Runtime.');
  if(!response.ok){
   if(response.status===401||response.status===403)throw new ProviderError('Nebius rejected the server credentials or model access.');
   if(response.status===429)throw new ProviderError('Nebius is rate limiting this workspace. Try again shortly.',true);
   if(response.status===400)throw new ProviderError('Nebius rejected the model ID or request settings (400). Check the model ID, regional base URL, temperature, and token limit in Runtime.');
   if(response.status===404)throw new ProviderError('The model is not available at this Nebius base URL (404). Check the model ID, region, and account access in Runtime.');
   throw new ProviderError(`Nebius could not complete this node (${response.status}).`,response.status>=500);
  }
  let data:any;
  try{data=await response.json()}catch{throw new ProviderError('Nebius returned an invalid model response.')}
  if(call.signal.aborted)throw new DOMException('Execution cancelled.','AbortError');
  const choice=data?.choices?.[0];
  if(choice?.finish_reason==='length')throw new ProviderError('The node reached its output token limit. Increase Maximum output tokens in Runtime and test again.');
  if(choice?.finish_reason==='content_filter')throw new ProviderError('Nebius stopped this node because of a content filter.');
  if(typeof choice?.message?.content!=='string')throw new ProviderError('Nebius returned no visible answer for this node.');
  const text=visibleAnswer(choice.message.content);
  if(!text)throw new ProviderError('Nebius returned no visible answer. Increase the output token limit or adjust the node instructions.');
  if(text.length>150000)throw new ProviderError('The model response is too large to record. Lower Maximum output tokens.');
  const usage=data?.usage?.total_tokens;
  return {text,tokens:Number.isSafeInteger(usage)&&usage>=0?usage:0};
 };
}
