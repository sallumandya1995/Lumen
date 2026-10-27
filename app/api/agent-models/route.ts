import {env} from 'cloudflare:workers';
import {DEFAULT_AGENT_BASE_URL} from '../../../lib/models.mjs';
import {fetchAgentModels,ModelCatalogError} from '../../../lib/agent-execution/model-catalog';

export async function GET(request:Request){
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 try{
  const baseUrl=new URL(request.url).searchParams.get('baseUrl')??DEFAULT_AGENT_BASE_URL;
  const result=await fetchAgentModels(baseUrl,(env as any).NEBIUS_API_KEY||'',request.signal);
  return Response.json(result,{headers});
 }catch(error){
  return Response.json({error:error instanceof ModelCatalogError?error.message:'The model catalog could not be imported.'},{status:error instanceof ModelCatalogError?error.status:502,headers});
 }
}
