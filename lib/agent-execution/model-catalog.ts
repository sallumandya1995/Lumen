import {normalizeNebiusBaseUrl,validAgentModelId} from '../models.mjs';

export class ModelCatalogError extends Error {
 constructor(message:string,readonly status=502){super(message);this.name='ModelCatalogError'}
}

/** Nebius documents GET /v1/models. Return identifiers only; listing a model
 * does not establish that it supports chat generation or this workspace's run. */
export async function fetchAgentModels(baseUrl:string,key:string,signal?:AbortSignal){
 const endpoint=normalizeNebiusBaseUrl(baseUrl);
 if(!endpoint)throw new ModelCatalogError('Choose a Nebius TokenFactory base URL in US Central, US North, or Global.',400);
 if(!key)throw new ModelCatalogError('The Nebius API key is not configured on the server.',503);
 const timeout=AbortSignal.timeout(15000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
 let response:Response;
 try{
  response=await fetch(endpoint+'models',{headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},redirect:'manual',signal:combined});
 }catch{
  if(signal?.aborted)throw new ModelCatalogError('Model import was cancelled.',499);
  throw new ModelCatalogError(timeout.aborted?'Nebius took too long to list model IDs. Try again.':'Could not reach the Nebius model catalog for this region. Try again.',504);
 }
 if(response.status>=300&&response.status<400)throw new ModelCatalogError('Nebius redirected this catalog request. Choose a direct TokenFactory regional base URL.');
 if(!response.ok){
  if(response.status===401||response.status===403)throw new ModelCatalogError('Nebius did not authorize this model catalog. Check the server credentials and selected region.');
  if(response.status===429)throw new ModelCatalogError('Nebius is rate limiting model imports. Try again shortly.',429);
  throw new ModelCatalogError(`Nebius could not list model IDs for this region (${response.status}).`);
 }
 let data:any;
 try{
  const length=Number(response.headers.get('Content-Length')||0);
  if(length>2000000)throw Error('large');
  const text=await response.text();
  if(text.length>2000000)throw Error('large');
  data=JSON.parse(text);
 }catch{
  throw new ModelCatalogError(combined.aborted?'Model import stopped before the catalog was received. Try again.':'Nebius returned an unreadable model catalog. Try again.');
 }
 if(!data||!Array.isArray(data.data))throw new ModelCatalogError('Nebius returned an invalid model catalog. Try again.');
 const ids=new Set<string>();
 for(const item of data.data.slice(0,2000))if(typeof item?.id==='string'&&validAgentModelId(item.id))ids.add(item.id);
 const all=[...ids].sort((a,b)=>a.localeCompare(b));
 return {baseUrl:endpoint,models:all.slice(0,1000).map(id=>({id})),truncated:data.data.length>2000||all.length>1000};
}
