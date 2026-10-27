import {db,jsonBody,replyError,HttpError,mutateWorkspace} from '../../../../../lib/governance/server-store';
import {sha256} from '../../../../../lib/governance/integrity';
import {normalizeOtlp,ingestSpans} from '../../../../../lib/governance/telemetry';
export async function POST(request:Request){try{
 const bearer=request.headers.get('authorization')?.match(/^Bearer (lum_([a-f0-9]{24})\.[a-f0-9]{64})$/);
 if(!bearer)throw new HttpError(401,'A Lumen agent connector key is required.');
 const key=await db().prepare('SELECT * FROM governance_keys WHERE id=? AND hash=? AND revoked_at IS NULL AND expires_at>?').bind(bearer[2],await sha256(bearer[1]),new Date().toISOString()).first<any>();
 if(!key)throw new HttpError(401,'Connector key is invalid, revoked, or expired.');
 if(!request.headers.get('content-type')?.includes('application/json'))throw new HttpError(415,'Use OTLP/HTTP JSON, not binary protobuf.');
 let spans;try{spans=normalizeOtlp(await jsonBody(request,256000),key.agent_id)}catch(e:any){throw new HttpError(400,e.message)}
 const result=await mutateWorkspace(key.workspace,'connector:'+key.id,'Telemetry ingested',key.agent_id,async store=>{
  const active=await db().prepare('SELECT id FROM governance_keys WHERE id=? AND revoked_at IS NULL AND expires_at>?').bind(key.id,new Date().toISOString()).first();if(!active)throw new HttpError(401,'Connector key was revoked or expired.');
  try{return ingestSpans(store,key.agent_id,key.id,spans)}catch(e:any){throw new HttpError(409,e.message)}
 });
 await db().prepare('UPDATE governance_keys SET last_seen=? WHERE id=?').bind(new Date().toISOString(),key.id).run();
 return Response.json({partialSuccess:{},lumen:result.value},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return replyError(e)}}
