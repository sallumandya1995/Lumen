import {db,workspaceIdentity,sameOrigin,jsonBody,replyError,HttpError,hexRandom,mutateWorkspace,readWorkspace} from '../../../../lib/governance/server-store';
import {sha256} from '../../../../lib/governance/integrity';
import {safeText} from '../../../../lib/governance/sanitize';
export async function GET(request:Request){try{sameOrigin(request);const identity=await workspaceIdentity(request);const rows=await db().prepare('SELECT id,agent_id AS agentId,name,created_at AS createdAt,expires_at AS expiresAt,revoked_at AS revokedAt,last_seen AS lastSeen FROM governance_keys WHERE workspace=? ORDER BY created_at DESC').bind(identity.id).all();return Response.json({keys:rows.results},{headers:{'Cache-Control':'no-store'}})}catch(e){return replyError(e)}}
export async function POST(request:Request){try{sameOrigin(request);const identity=await workspaceIdentity(request),body=await jsonBody(request,4000);
 if(body.action==='revoke'){
  const revokedAt=new Date().toISOString();
  await mutateWorkspace(identity.id,'workspace-owner','Connector key revoked',String(body.id),async s=>{
   const active=await db().prepare('SELECT id FROM governance_keys WHERE workspace=? AND id=? AND revoked_at IS NULL').bind(identity.id,String(body.id)).first();if(!active)throw new HttpError(404,'Active connector key not found.');
   s.audit.unshift({id:'AU-'+crypto.randomUUID(),actorId:s.users[0].id,action:'Connector key revoked',target:String(body.id),at:revokedAt,outcome:'Future telemetry requests denied'});s.updatedAt=revokedAt;
  },guard=>[db().prepare(`UPDATE governance_keys SET revoked_at=? WHERE workspace=? AND id=? AND ${guard.sql}`).bind(revokedAt,identity.id,String(body.id),...guard.args)]);return Response.json({ok:true});
 }
 if(body.action!=='create'||typeof body.name!=='string'||!body.name.trim()||body.name.length>80||![7,30,90].includes(body.days))throw new HttpError(400,'Provide a name and a 7, 30 or 90 day expiry.');
 const current=await readWorkspace(identity.id);if(!current?.store.agents.some(a=>a.id===body.agentId))throw new HttpError(400,'Choose a saved agent in this workspace.');
 const id=hexRandom(12),secret=`lum_${id}.${hexRandom(32)}`,createdAt=new Date().toISOString(),expiresAt=new Date(Date.now()+body.days*86400000).toISOString();
 const hash=await sha256(secret);
 await mutateWorkspace(identity.id,'workspace-owner','Connector key created',id,async s=>{
  const count=await db().prepare('SELECT COUNT(*) AS n FROM governance_keys WHERE workspace=? AND revoked_at IS NULL AND expires_at>?').bind(identity.id,new Date().toISOString()).first<any>();if(count.n>=20)throw new HttpError(409,'Revoke an unused connector key before creating another (20 active keys maximum).');
  s.audit.unshift({id:'AU-'+crypto.randomUUID(),actorId:s.users[0].id,action:'Connector key created',target:id,agentId:body.agentId,at:createdAt,outcome:`Agent scoped · expires ${expiresAt}`});s.updatedAt=createdAt;
 },guard=>[db().prepare(`INSERT INTO governance_keys(id,workspace,agent_id,name,hash,created_at,expires_at) SELECT ?,?,?,?,?,?,? WHERE ${guard.sql}`).bind(id,identity.id,body.agentId,safeText(body.name,80),hash,createdAt,expiresAt,...guard.args)]);
 return Response.json({id,secret,agentId:body.agentId,expiresAt},{headers:{'Cache-Control':'no-store','Pragma':'no-cache'}});
 }catch(e){return replyError(e)}}
