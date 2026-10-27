export type Alternative = {id?:number;token:string;logprob:number;bytes?:number[];end:boolean;control:boolean};
export type GuideResult = {alternatives:Alternative[];completed?:boolean;prefixTokenIds?:number[]};

export function readGuideResult(data:any):GuideResult {
 const alternatives:Alternative[]=Array.isArray(data?.alternatives)?data.alternatives.filter((t:any)=>t&&typeof t.token==='string'&&Number.isFinite(t.logprob)&&t.logprob<=0).sort((a:Alternative,b:Alternative)=>b.logprob-a.logprob).slice(0,20):[];
 if(!alternatives.length&&data?.completed!==true)throw new Error('The provider returned no usable alternatives for this prefix. Retry, or append your own text to continue.');
 return {alternatives,completed:data?.completed===true&&!alternatives.length,prefixTokenIds:Array.isArray(data?.prefixTokenIds)?data.prefixTokenIds:undefined};
}

/** One serial request per selected token. Cancellation is checked after every await
 * so a response arriving after Stop, Reset, or unmount can never append text. */
export async function playGuidedTokens(options:{
 steps:string[];initial?:GuideResult;signal:AbortSignal;limit:number;
 request:(prefix:string,ids?:number[])=>Promise<GuideResult>;
 onChoices:(choices:Alternative[])=>void;
 onSelection:(steps:string[],choice:Alternative,ids:number[]|undefined,alternatives:Alternative[])=>void;
}) {
 let steps=[...options.steps],current=options.initial,ids=current?.prefixTokenIds;
 const check=()=>{if(options.signal.aborted)throw new DOMException('Cancelled','AbortError')};
 while(true){
  check();
  const prefix=steps[steps.length-1]||'';
  if(prefix.length>=options.limit)return 'limit' as const;
  if(!current)current=await options.request(prefix,ids);
  check();
  if(current.completed)return 'end' as const;
  ids=current.prefixTokenIds;
  const choices=[...current.alternatives].sort((a,b)=>b.logprob-a.logprob);
  options.onChoices(choices);
  // Protocol and empty tokens cannot be added to the visible draft. End tokens
  // remain eligible even though their text must never be inserted.
  const choice=choices.find(t=>Number.isFinite(t.logprob)&&t.logprob<=0&&!t.control&&(t.end||t.token.length>0));
  if(!choice)throw new Error('No selectable next token was returned. Playback stopped; retry or add your own text.');
  if(choice.end)return 'end' as const;
  // Never silently switch to a lower-ranked token just to fit the draft limit.
  if(prefix.length+choice.token.length>options.limit)return 'limit' as const;
  check();
  steps=[...steps,prefix+choice.token];
  ids=choice.id!==undefined&&ids?[...ids,choice.id]:undefined;
  options.onSelection(steps,choice,ids,choices);
  current=undefined;
 }
}
