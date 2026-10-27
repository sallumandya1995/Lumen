import {DEFAULT_MODEL,modelConfig} from './models.mjs';
import {parseSettings} from './chat-settings.mjs';
import type {TokenProbability} from '../app/token-probabilities';

export const MAX_VARIANTS=6;
export type Variant={id:string;label:string;model:string;temperature:string;topP:string;maxTokens:string;systemPrompt:string;inputRate:string;outputRate:string};
export type VariantSnapshot={id:string;label:string;model:string;systemPrompt:string;parameters:Record<string,number>;pricing:{inputPerMillion:number;outputPerMillion:number}|null};
export type Usage={inputTokens:number|null;outputTokens:number|null;totalTokens:number|null};
export type ExperimentResult={variant:VariantSnapshot;status:'queued'|'running'|'success'|'error'|'cancelled';content?:string;logprobs?:TokenProbability[];usage?:Usage;durationMs?:number;error?:string;warning?:string|null;finishReason?:string|null};
export type ExperimentRun={id:string;createdAt:string;prompt:string;results:ExperimentResult[]};
export type ExperimentResponse={content:string;logprobs?:TokenProbability[];usage?:Usage;warning?:string|null;finishReason?:string|null};

export function newVariant(index:number,source?:Variant):Variant{
 return {model:DEFAULT_MODEL,temperature:'0.2',topP:'0.95',maxTokens:'2048',systemPrompt:'You are a helpful assistant. Answer clearly and accurately.',inputRate:'',outputRate:'',...source,id:crypto.randomUUID(),label:`Variant ${index}`};
}
export function initialVariants(){
 const first=newVariant(1),second=newVariant(2),third=newVariant(3);
 second.temperature='0.8';second.topP='1';second.systemPrompt='You are a helpful teacher. Explain clearly with a vivid analogy when useful.';
 third.temperature='0.5';
 return [first,second,third];
}
export function snapshotVariant(variant:Variant):VariantSnapshot{
 if(!variant.label.trim()||variant.label.length>60)throw Error('Give each variant a name of up to 60 characters.');
 if(!modelConfig(variant.model)?.chat)throw Error(`${variant.label}: choose a supported chat model.`);
 if(typeof variant.systemPrompt!=='string'||variant.systemPrompt.length>8000)throw Error(`${variant.label}: keep the system prompt below 8,000 characters.`);
 const number=(text:string,key:string)=>{if(text.trim()==='')throw Error(`${variant.label}: enter ${key}.`);return Number(text)};
 let parameters;
 try{parameters=parseSettings({temperature:number(variant.temperature,'temperature'),top_p:number(variant.topP,'Top P'),max_tokens:number(variant.maxTokens,'max tokens')})}catch(error){throw Error(`${variant.label}: ${error instanceof Error?error.message:'check the settings.'}`)}
 let pricing:VariantSnapshot['pricing']=null;
 if(variant.inputRate.trim()!==''||variant.outputRate.trim()!==''){
  const inputPerMillion=number(variant.inputRate,'both pricing rates'),outputPerMillion=number(variant.outputRate,'both pricing rates');
  if(![inputPerMillion,outputPerMillion].every(value=>Number.isFinite(value)&&value>=0&&value<=1e6))throw Error(`${variant.label}: pricing rates must be between 0 and 1,000,000 USD per million tokens.`);
  pricing={inputPerMillion,outputPerMillion};
 }
 return {id:variant.id,label:variant.label.trim(),model:variant.model,systemPrompt:variant.systemPrompt,parameters,pricing};
}
export function experimentSnapshots(prompt:string,variants:Variant[]){
 if(!prompt.trim()||prompt.length>16000)throw Error('Enter a shared prompt of up to 16,000 characters.');
 if(variants.length<2||variants.length>MAX_VARIANTS||new Set(variants.map(v=>v.id)).size!==variants.length)throw Error('Compare two to six distinct variants.');
 return variants.map(snapshotVariant);
}
const validCount=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
export function resultMetrics(result:ExperimentResult){
 const tokens=result.logprobs||[],valid=tokens.filter(t=>Number.isFinite(t.logprob)&&t.logprob<=0&&t.logprob>-9999);
 const averageLogprob=valid.length===tokens.length&&valid.length?valid.reduce((sum,t)=>sum+t.logprob,0)/valid.length:null;
 const usage=result.usage,pricing=result.variant.pricing;
 const estimatedCostUsd=result.status==='success'&&pricing&&validCount(usage?.inputTokens)&&validCount(usage?.outputTokens)?(usage.inputTokens*pricing.inputPerMillion+usage.outputTokens*pricing.outputPerMillion)/1e6:null;
 return {averageLogprob,visibleTokens:tokens.length,estimatedCostUsd,outputTokens:validCount(usage?.outputTokens)?usage.outputTokens:null,totalTokens:validCount(usage?.totalTokens)?usage.totalTokens:null};
}

/** Bounded worker pool. A failure or cancellation cannot replace sibling results. */
export async function runExperiment(prompt:string,variants:VariantSnapshot[],options:{signal:AbortSignal;request:(args:{mode:'chat';model:string;systemPrompt:string;parameters:Record<string,number>;messages:{role:'user';content:string}[]},signal:AbortSignal)=>Promise<ExperimentResponse>;onResult:(index:number,result:ExperimentResult)=>void;now?:()=>number}){
 const snapshots=structuredClone(variants),now=options.now||(()=>performance.now());
 const results:ExperimentResult[]=snapshots.map(variant=>({variant,status:'queued'}));let cursor=0;
 const publish=(index:number,result:ExperimentResult)=>{results[index]=result;options.onResult(index,structuredClone(result))};
 async function worker(){
  while(cursor<snapshots.length){
   const index=cursor++,variant=snapshots[index];
   if(options.signal.aborted){publish(index,{variant,status:'cancelled',error:'Stopped before the request started.'});continue}
   const started=now();publish(index,{variant,status:'running'});
   try{
    const response=await options.request({mode:'chat',model:variant.model,systemPrompt:variant.systemPrompt,parameters:{...variant.parameters},messages:[{role:'user',content:prompt}]},options.signal);
    if(options.signal.aborted)throw new DOMException('Stopped','AbortError');
    if(typeof response.content!=='string'||!response.content.trim())throw Error('The model returned an empty response.');
    publish(index,{variant,status:'success',content:response.content,logprobs:response.logprobs||[],usage:response.usage,durationMs:Math.max(0,now()-started),warning:response.warning,finishReason:response.finishReason});
   }catch(error){publish(index,{variant,status:options.signal.aborted?'cancelled':'error',durationMs:Math.max(0,now()-started),error:options.signal.aborted?'Generation stopped.':error instanceof Error?error.message:'The request failed.'})}
  }
 }
 await Promise.all(Array.from({length:Math.min(3,snapshots.length)},worker));return results;
}

type Unit={text:string;start:number;end:number};
const units=(text:string):Unit[]=>Array.from(text.matchAll(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu),m=>({text:m[0],start:m.index!,end:m.index!+m[0].length}));
export function decodedTokens(tokens:TokenProbability[]){const decoder=new TextDecoder();return tokens.map(t=>Array.isArray(t.bytes)?decoder.decode(new Uint8Array(t.bytes),{stream:true}):t.token)}
/** Align visible text, then map changes back to provider token boundaries. */
export function tokenDifferences(reference:string,content:string,tokens:TokenProbability[]=[]){
 const a=units(reference),b=units(content),matchedA=new Set<number>(),matchedB=new Set<number>();let coarse=false;
 if(a.length*b.length<=1e6){
  const width=b.length+1,matrix=new Uint32Array((a.length+1)*width);
  for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)matrix[i*width+j]=a[i].text===b[j].text?1+matrix[(i+1)*width+j+1]:Math.max(matrix[(i+1)*width+j],matrix[i*width+j+1]);
  let i=0,j=0;while(i<a.length&&j<b.length){if(a[i].text===b[j].text){matchedA.add(i++);matchedB.add(j++)}else if(matrix[(i+1)*width+j]>=matrix[i*width+j+1])i++;else j++}
 }else{
  coarse=true;let start=0;while(start<Math.min(a.length,b.length)&&a[start].text===b[start].text){matchedA.add(start);matchedB.add(start);start++}
  let i=a.length-1,j=b.length-1;while(i>=start&&j>=start&&a[i].text===b[j].text){matchedA.add(i--);matchedB.add(j--)}
 }
 const changed=b.filter((_,i)=>!matchedB.has(i)),removedGroups:string[]=[];let removedGroup='';
 a.forEach((unit,i)=>{if(!matchedA.has(i))removedGroup+=unit.text;else if(removedGroup){removedGroups.push(removedGroup);removedGroup=''}});
 if(removedGroup)removedGroups.push(removedGroup);
 const removedText=removedGroups.join(' […] ');
 const pieces=decodedTokens(tokens),aligned=pieces.length>0&&pieces.join('')===content;
 let offset=0,pointer=0;const indices:number[]=[];
 if(aligned)pieces.forEach((text,index)=>{const end=offset+text.length;while(pointer<changed.length&&changed[pointer].end<=offset)pointer++;if(text&&pointer<changed.length&&changed[pointer].start<end)indices.push(index);offset=end});
 return {indices,removedText,aligned,coarse,segments:b.map((u,i)=>({text:u.text,changed:!matchedB.has(i)}))};
}
