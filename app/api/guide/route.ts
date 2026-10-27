import {env} from 'cloudflare:workers';
import {DEFAULT_MODEL,modelConfig} from '../../../lib/models.mjs';
import {guidedRequest} from '../../../lib/guided-request.mjs';
import {normalizeGuidedResponse} from '../../../lib/guided-response.mjs';
import {appendImageContext} from '../../../lib/image-context';
export async function POST(request:Request){
 try{
 const {prompt,prefix='',model=DEFAULT_MODEL,images}=await request.json() as any;
 if(typeof prompt!=='string'||prompt.length>16000||typeof prefix!=='string'||prefix.length>16000)return Response.json({error:'Enter a prompt and keep the draft below 16,000 characters.'},{status:400});
 let contextualPrompt;
 try{contextualPrompt=appendImageContext(prompt,images)}catch(error){return Response.json({error:error instanceof Error?error.message:'The image context is invalid.'},{status:400})}
 if(!contextualPrompt.trim())return Response.json({error:'Enter a prompt or attach an image.'},{status:400});
 const config=typeof model==='string'?modelConfig(model):null;
 if(!config?.guided)return Response.json({error:'Choose Nemotron, DeepSeek V4 Pro, or Qwen3 235B for guided generation.'},{status:400});
 const key=(env as any).NEBIUS_API_KEY;
 if(!key)return Response.json({error:'API key unavailable.'},{status:503});
 const result=await fetch(config.baseUrl+'chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},signal:AbortSignal.any([request.signal,AbortSignal.timeout(90000)]),body:JSON.stringify(guidedRequest(model,contextualPrompt,prefix))});
 if(!result.ok)return Response.json({error:`The model could not return next-token choices (${result.status}). Try again or switch models.`},{status:502});
 const data:any=await result.json();
 try{
  return Response.json({...normalizeGuidedResponse(data),prefix,model},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'The provider returned invalid next-token data.'},{status:502})}
 }catch{return Response.json({error:'Could not fetch the next tokens. Your draft is preserved.'},{status:502})}
}
