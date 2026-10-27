import type {Alternative} from './guided-autoplay';

export type GuidedSelection={source:'custom'|'model'|'legacy';text:string;logprob?:number;alternatives?:Alternative[];model?:string};

const validLogprob=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value<=0;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const endTokens=new Set(['<|im_end|>','<|endoftext|>','<｜end▁of▁sentence｜>','</s>','<|eot_id|>']);
const protocolToken=(token:string)=>endTokens.has(token)||/^<\|.*\|>$|^<｜.*｜>$|^<\/?think>$/.test(token);
function alternativesFrom(value:unknown):Alternative[]{
 if(!Array.isArray(value))return [];
 return value.filter((item):item is Record<string,unknown>=>object(item)&&typeof item.token==='string'&&item.token.length>0&&item.token.length<=16000&&validLogprob(item.logprob))
  .map(item=>({token:item.token as string,logprob:item.logprob as number,end:item.end===true||endTokens.has(item.token as string),control:item.control===true,
   ...(typeof item.id==='number'&&Number.isSafeInteger(item.id)&&item.id>=0?{id:item.id}:{}),
   ...(Array.isArray(item.bytes)&&item.bytes.length<=64000&&item.bytes.every(b=>Number.isInteger(b)&&b>=0&&b<=255)?{bytes:[...item.bytes] as number[]}:{}),
  })).sort((a,b)=>b.logprob-a.logprob).slice(0,20);
}
const legacySelection=(text:string):GuidedSelection=>({source:'legacy',text});

/** Manual text is provenance, not a model prediction. Never assign a probability
 * to a sentence added by the user, even if its text matches a model candidate. */
export function customSelection(text:string):GuidedSelection{return {source:'custom',text}}

/** Capture the candidate distribution at selection time, before the next request
 * replaces it. Defensive fallback keeps text without inventing probabilities. */
export function modelSelection(choice:Alternative,alternatives:Alternative[],model:string):GuidedSelection{
 const text=typeof choice?.token==='string'?choice.token:'';
 const captured=alternativesFrom(alternatives);
 if(!text||choice.end||choice.control||protocolToken(text)||!validLogprob(choice.logprob)||!captured.some(item=>item.token===text&&item.logprob===choice.logprob&&!item.end&&!item.control))return legacySelection(text);
 return {source:'model',text,logprob:choice.logprob,alternatives:captured,...(typeof model==='string'&&model.length>0&&model.length<=200?{model}:{})};
}

function restoreSelection(raw:unknown,text:string):GuidedSelection{
 if(!object(raw)||raw.text!==text)return legacySelection(text);
 if(raw.source==='custom')return customSelection(text);
 if(raw.source!=='model'||!validLogprob(raw.logprob)||raw.model!==undefined&&(typeof raw.model!=='string'||!raw.model.length||raw.model.length>200))return legacySelection(text);
 return modelSelection({token:text,logprob:raw.logprob,end:false,control:false},alternativesFrom(raw.alternatives),typeof raw.model==='string'?raw.model:'');
}

/** Upgrade legacy increments and cumulative snapshots without guessing their
 * source. Invalid metadata affects only its own piece; text history stays intact. */
export function restoreGuidedHistory(saved:any,limit=16000):{steps:string[];selections:GuidedSelection[]}{
 if(!Array.isArray(saved?.steps))return {steps:[],selections:[]};
 const max=Number.isSafeInteger(limit)&&limit>=0?limit:16000;
 let previous='';const steps:string[]=[],selections:GuidedSelection[]=[];
 for(const [index,value] of saved.steps.slice(0,max).entries()){
  if(typeof value!=='string')break;
  const snapshot=saved.version>=2?value:previous+value;
  if(snapshot.length>max||!snapshot.startsWith(previous))break;
  if(snapshot===previous)continue;
  const text=snapshot.slice(previous.length);
  steps.push(snapshot);
  selections.push(saved.version>=5&&Array.isArray(saved.selections)?restoreSelection(saved.selections[index],text):legacySelection(text));
  previous=snapshot;
 }
 return {steps,selections};
}
