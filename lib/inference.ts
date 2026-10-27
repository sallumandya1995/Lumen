import {modelUnavailableReason} from './models.mjs';
type Options={signal?:AbortSignal,onProgress?:(text:string)=>void,onPartial?:(data:any)=>void};
let configPromise:Promise<any>|null=null;
export function getRuntimeConfig(){
 if(!configPromise)configPromise=fetch('/api/config').then(async r=>r.ok?await r.json():{}).catch(()=>({}));
 return configPromise;
}
export async function runInference(args:any,options:Options={}){
 if(options.signal?.aborted)throw new DOMException('Cancelled','AbortError');
 const config=await getRuntimeConfig();
 if(options.signal?.aborted)throw new DOMException('Cancelled','AbortError');
 const unavailable=modelUnavailableReason(args.model,config);
 if(unavailable)throw new Error(unavailable);
 options.onProgress?.('Waiting for the model…');
 const r=await fetch(args.mode==='guide'?'/api/guide':'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args),signal:options.signal});
 const data:any=await r.json();
 if(!r.ok)throw new Error(data.error||'The model request failed.');
 return data;
}
