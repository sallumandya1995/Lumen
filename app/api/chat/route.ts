import {parseSettings} from '../../../lib/chat-settings.mjs';
import {answerTokens} from '../../../lib/answer-tokens.mjs';
import {DEFAULT_MODEL,modelConfig} from '../../../lib/models.mjs';
import {appendImageContext} from '../../../lib/image-context';
import {systemMessage,chatUsage} from '../../../lib/chat-experiment-request.mjs';
import { env } from 'cloudflare:workers';
export async function POST(request: Request) {
 try {
 const body:any = await request.json();
 if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 60 || body.messages.some((m: any) => !m || !['user','assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 16000 || (m.role==='assistant'&&m.images!==undefined))) return Response.json({error:'Please send a shorter conversation. Images can only be attached to your messages.'},{status:400});
 let messages;
 try{messages=[...systemMessage(body.systemPrompt),...body.messages.map((m:any)=>({role:m.role,content:m.role==='user'?appendImageContext(m.content,m.images):m.content}))]}catch(error){return Response.json({error:error instanceof Error?error.message:'The request context is invalid.'},{status:400})}
 const model = body.model ?? DEFAULT_MODEL;
 const config = typeof model === 'string' ? modelConfig(model) : null;
 if (!config?.chat) return Response.json({error:'Choose Nemotron or DeepSeek Flash for chat.'},{status:400});
 let parameters;
 try { parameters=parseSettings(body.parameters); } catch(e:any) { return Response.json({error:e.message},{status:400}); }
 const key = (env as any).NEBIUS_API_KEY;
 if (!key) return Response.json({error:'The API key has not been configured.'},{status:503});
 const result = await fetch(config.baseUrl+'chat/completions', {method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({model,messages,logprobs:true,top_logprobs:10,...parameters,stream:false}),signal:AbortSignal.any([request.signal, AbortSignal.timeout(120000)])});
 if (!result.ok) return Response.json({error: result.status===401 ? 'Nebius rejected the API key. Check or replace your key.' : `Nebius returned an error (${result.status}). Please try again or check model availability.`},{status:502});
 const data = await result.json() as any;
 const choice = data.choices?.[0];
 if (typeof choice?.message?.content !== 'string' || !choice.message.content) return Response.json({error:'The model returned an empty response.'},{status:502});
 const logprobs = answerTokens(choice.logprobs?.content ?? [],choice.message.content,model);
 return Response.json({content:choice.message.content,model,logprobs,usage:chatUsage(data.usage),finishReason:typeof choice.finish_reason==='string'?choice.finish_reason:null,warning:logprobs.length && logprobs.every((t:any)=>Array.isArray(t.top_logprobs)&&t.top_logprobs.length) ? null : 'Nebius did not return alternatives for some tokens, even with top_logprobs=10.'},{headers:{'Cache-Control':'no-store'}});
 } catch { return Response.json({error:'Could not reach the model. Please try again.'},{status:502}); }
}
