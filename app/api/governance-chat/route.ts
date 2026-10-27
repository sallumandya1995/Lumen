import {env} from 'cloudflare:workers';
import {answerGovernanceQuestion,GovernanceAssistantError,readAssistantJson} from '../../../lib/governance/assistant-server';

export async function POST(request:Request){
 const signal=AbortSignal.any([request.signal,AbortSignal.timeout(120000)]);
 try{
  const result=await answerGovernanceQuestion(await readAssistantJson(request),(env as any).NEBIUS_API_KEY||'',signal);
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(error){
  const message=signal.aborted?(request.signal.aborted?'Question cancelled.':'Lumen-Agent took too long to answer. Your question is kept; try again.'):error instanceof GovernanceAssistantError?error.message:'Lumen-Agent could not answer this question. Try again.';
  return Response.json({error:message},{status:signal.aborted?(request.signal.aborted?499:504):error instanceof GovernanceAssistantError?error.status:502,headers:{'Cache-Control':'no-store'}});
 }
}
