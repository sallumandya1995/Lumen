import {ensureWorkspace,workspaceIdentity,sameOrigin,replyError,jsonBody,mutateWorkspace,HttpError} from '../../../../lib/governance/server-store';
import {createMockService,isUsableSnapshot} from '../../../../lib/governance/store-core';
import {upgradeSnapshot} from '../../../../lib/governance/definitions';
import {sanitize} from '../../../../lib/governance/sanitize';
export async function GET(request:Request){try{
 sameOrigin(request);const identity=await workspaceIdentity(request,true),opened=await ensureWorkspace(identity.id);
 const current=await mutateWorkspace(identity.id,'system','Workspace maintenance','workspace',async s=>{
  await createMockService(s,undefined,{simulation:false}).load();
  for(const run of s.runs){const timeout=s.definitions.find(d=>d.agentId===run.agentId)?.limits.timeoutSeconds||120;
   if(run.provenance==='studio'&&run.status==='Running'&&Date.now()-Date.parse(run.at)>Math.max(300000,timeout*1000+60000)){
    run.status='Failed';run.executionStatus='Failed';run.warnings=[...(run.warnings||[]),'The executor did not deliver a final receipt before its timeout. Completed steps are preserved; final outcome and token usage may be incomplete.'];
    s.audit.unshift({id:'AU-'+crypto.randomUUID(),actorId:'system',action:'Incomplete run recovered',target:run.id,agentId:run.agentId,at:new Date().toISOString(),outcome:'No final receipt received; retained completed steps'});s.updatedAt=new Date().toISOString();
   }
  }
 });
 return Response.json({store:current.store,revision:current.row.revision,fresh:opened.row.revision===1,identity:identity.authenticated?'ChatGPT account':'Private browser workspace'},{headers:{'Cache-Control':'no-store',...(identity.cookie?{'Set-Cookie':identity.cookie}:{})}});
 }catch(e){return replyError(e)}}
export async function POST(request:Request){try{
 sameOrigin(request);const identity=await workspaceIdentity(request),body=await jsonBody(request),allowed=['decide','assign','resolve','testConnector','saveConnector','setAgentStatus','setAvailability','saveAgentConfiguration','saveGlobalPolicies','tick','migrate'];
 if(!allowed.includes(body?.action))throw new HttpError(400,'Unknown governance action.');
 const {value,store,row}=await mutateWorkspace(identity.id,'workspace-owner',body.action,String(body.args?.[0]||'workspace').slice(0,200),async s=>{
  if(body.action==='migrate'){
   if(s.audit.some(x=>x.action==='Browser workspace imported')||s.runs.some(x=>x.source==='live'))return;
   const incoming=upgradeSnapshot(sanitize(body.snapshot));if(!isUsableSnapshot(incoming))throw new HttpError(400,'The previous browser workspace is not valid.');
   for(const run of incoming.runs)if(run.source==='live'){(run as any).provenance='browser-import';run.warnings=[...(run.warnings||[]),'Imported browser record; execution was not verified by this server.']}
   incoming.audit.unshift({id:'AU-'+crypto.randomUUID(),actorId:incoming.users.find(x=>x.role==='Owner')!.id,action:'Browser workspace imported',target:'workspace',at:new Date().toISOString(),outcome:'Legacy receipts are marked as browser imports.'});Object.assign(s,incoming);return;
  }
  if(!Array.isArray(body.args)||body.args.length>5)throw new HttpError(400,'Invalid action arguments.');
  if(body.action==='tick')return;
  const service=createMockService(s,undefined,{simulation:false}),args=body.args.slice(),owner=s.users.find(x=>x.role==='Owner')!.id;
  const arity:Record<string,number>={decide:4,assign:4,resolve:3,testConnector:2,saveConnector:2,setAgentStatus:3,setAvailability:3,saveAgentConfiguration:3,saveGlobalPolicies:2,tick:0};
  if(args.length!==arity[body.action])throw new HttpError(400,'Invalid action arguments.');
  if(args.length)args[args.length-1]=owner;
  try{return await (service as any)[body.action](...args)}catch(e:any){throw new HttpError(409,e.message||'The action could not be applied.')}
 });return Response.json({ok:true,result:value,updatedAt:store.updatedAt,revision:row.revision},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return replyError(e)}}
