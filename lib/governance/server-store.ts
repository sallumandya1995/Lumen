import {env} from 'cloudflare:workers';
import {createSeed} from './mock-data';
import {canonical,sha256,type LedgerEntry} from './integrity';
import type {Store} from './types';
export class HttpError extends Error{constructor(public status:number,message:string){super(message)}}
export const db=()=>{const database=(env as any).DB as D1Database;if(!database)throw new HttpError(503,'Governance storage is not available. Please retry.');return database};
export type WorkspaceRow={id:string;revision:number;head:string;mutation:string;private_key:string;public_key:string;created_at:string};
export const entityKinds=['agents','definitions','runs','toolCalls','policies','approvals','users','assignments','audit','connectors'] as const;
function records(s:Store){return [...entityKinds.flatMap(kind=>(s[kind] as any[]).map(item=>({kind,id:item.id||item.agentId,data:canonical(item)}))),{kind:'meta',id:'state',data:canonical({version:s.version,globalPolicies:s.globalPolicies,sequence:s.sequence,updatedAt:s.updatedAt})}]}
export async function workspaceIdentity(request:Request,allowCreate=false){
 const identity=request.headers.get('oai-authenticated-user-id');
 if(identity)return {id:await sha256('chatgpt:'+identity),cookie:undefined as string|undefined,authenticated:true};
 const existing=request.headers.get('cookie')?.match(/(?:^|;\s*)__Host-lumen-workspace=([a-f0-9]{64})(?:;|$)/)?.[1];
 if(!existing&&!allowCreate)throw new HttpError(401,'Open Agent Governance in this browser before connecting or running an agent.');
 const token=existing||hexRandom(32);
 return {id:await sha256('browser:'+token),cookie:existing?undefined:`__Host-lumen-workspace=${token}; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=31536000`,authenticated:false};
}
export function hexRandom(n:number){return [...crypto.getRandomValues(new Uint8Array(n))].map(x=>x.toString(16).padStart(2,'0')).join('')}
export function sameOrigin(request:Request){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')throw new HttpError(403,'This action requires the workspace origin.')}
export async function jsonBody(request:Request,max=1000000){if(Number(request.headers.get('content-length')||0)>max)throw new HttpError(413,'Request is too large.');const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'JSON body required.');let bytes=0,text='';const decoder=new TextDecoder();try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>max){await reader.cancel();throw new HttpError(413,'Request is too large.')}text+=decoder.decode(part.value,{stream:true})}text+=decoder.decode();return JSON.parse(text)}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'Invalid JSON body.')}finally{reader.releaseLock()}}
export function replyError(error:unknown){return Response.json({error:error instanceof HttpError?error.message:'The governance request could not be completed. Please retry.'},{status:error instanceof HttpError?error.status:500,headers:{'Cache-Control':'no-store'}})}
export async function readWorkspace(id:string){
 const [metadata,items]=await db().batch([db().prepare('SELECT * FROM governance_workspaces WHERE id=?').bind(id),db().prepare('SELECT kind,id,data FROM governance_records WHERE workspace=?').bind(id)]);
 const row=metadata.results[0] as WorkspaceRow|undefined;if(!row)return null;
 const store:any={};for(const kind of entityKinds)store[kind]=[];
 for(const r of items.results as any[]){if(r.kind==='meta')Object.assign(store,JSON.parse(r.data));else if(entityKinds.includes(r.kind))store[r.kind].push(JSON.parse(r.data))}
 for(const key of ['runs','toolCalls','policies','approvals','assignments','audit'])store[key].sort((a:any,b:any)=>b.at.localeCompare(a.at)||a.id.localeCompare(b.id));
 store.users.sort((a:any,b:any)=>(a.role==='Owner'?-1:b.role==='Owner'?1:a.name.localeCompare(b.name)));
 return {row,store:store as Store};
}
export async function ensureWorkspace(id:string){
 let current=await readWorkspace(id);if(current?.row.revision)return current;
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const privateKey=canonical(await crypto.subtle.exportKey('jwk',pair.privateKey)),publicKey=canonical(await crypto.subtle.exportKey('jwk',pair.publicKey));
 await db().prepare('INSERT OR IGNORE INTO governance_workspaces(id,private_key,public_key,created_at) VALUES(?,?,?,?)').bind(id,privateKey,publicKey,new Date().toISOString()).run();
 await mutateWorkspace(id,'system','Workspace initialized','workspace',s=>{if(!s.version)Object.assign(s,createSeed())});
 return (await readWorkspace(id))!;
}
/** CAS and all guarded writes run in ONE transaction; a losing writer changes nothing. */
export async function mutateWorkspace(id:string,actor:string,action:string,target:string,fn:(store:Store)=>Promise<any>|any,extra?:(guard:{sql:string;args:[string,number,string]})=>D1PreparedStatement[]){
 for(let attempt=0;attempt<6;attempt++){
  const current=await readWorkspace(id);if(!current)throw new HttpError(404,'Workspace not found.');
  const before=records(current.store),next=structuredClone(current.store),value=await fn(next);const after=records(next);
  const old=new Map(before.map(r=>[r.kind+':'+r.id,r.data]));
  const changed=after.filter(r=>old.get(r.kind+':'+r.id)!==r.data);const keys=new Set(after.map(r=>r.kind+':'+r.id));const removed=before.filter(r=>!keys.has(r.kind+':'+r.id));
  if(!changed.length&&!removed.length)return {store:current.store,value,row:current.row};
  const revision=current.row.revision+1,mutation=crypto.randomUUID();
  const changes=await Promise.all(changed.map(async r=>({kind:r.kind,id:r.id,digest:await sha256(r.data)})));
  const entry:LedgerEntry={sequence:revision,previousHash:current.row.head,at:new Date().toISOString(),actor,action,target,changes:[...changes,...removed.map(r=>({kind:r.kind,id:r.id,digest:null}))]};const entryText=canonical(entry),hash=await sha256(entryText);
  const guard='EXISTS(SELECT 1 FROM governance_workspaces WHERE id=? AND revision=? AND mutation=?)';
  const result=await db().batch([
   db().prepare('UPDATE governance_workspaces SET revision=?,head=?,mutation=? WHERE id=? AND revision=?').bind(revision,hash,mutation,id,current.row.revision),
   db().prepare(`INSERT INTO governance_records(workspace,kind,id,data) SELECT ?,json_extract(value,'$.kind'),json_extract(value,'$.id'),json_extract(value,'$.data') FROM json_each(?) WHERE ${guard} ON CONFLICT(workspace,kind,id) DO UPDATE SET data=excluded.data`).bind(id,JSON.stringify(changed),id,revision,mutation),
   db().prepare(`DELETE FROM governance_records WHERE workspace=? AND (kind,id) IN (SELECT json_extract(value,'$.kind'),json_extract(value,'$.id') FROM json_each(?)) AND ${guard}`).bind(id,JSON.stringify(removed),id,revision,mutation),
   db().prepare(`INSERT INTO governance_ledger(workspace,sequence,entry,hash) SELECT ?,?,?,? WHERE ${guard}`).bind(id,revision,entryText,hash,id,revision,mutation),
   ...(extra?.({sql:guard,args:[id,revision,mutation]})||[])
  ]);
  if(result[0].meta.changes===1)return {store:next,value,row:{...current.row,revision,head:hash,mutation}};
 }
 throw new HttpError(409,'The workspace is busy. Retry this action; no partial change was saved.');
}
