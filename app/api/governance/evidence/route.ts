import {db,workspaceIdentity,sameOrigin,readWorkspace,replyError,HttpError,entityKinds} from '../../../../lib/governance/server-store';
import {canonical,sha256,hex,verifyEvidence,type EvidenceBundle} from '../../../../lib/governance/integrity';
import {sanitize} from '../../../../lib/governance/sanitize';
export async function GET(request:Request){try{
 sameOrigin(request);const identity=await workspaceIdentity(request),current=await readWorkspace(identity.id);if(!current)throw new HttpError(404,'Workspace not found.');
 const {row,store}=current,params=new URL(request.url).searchParams,scope=params.get('scope')||'live',runId=params.get('runId');
 if(!['live','all'].includes(scope))throw new HttpError(400,'Invalid evidence scope.');
 const rows=await db().prepare('SELECT entry,hash FROM governance_ledger WHERE workspace=? AND sequence<=? ORDER BY sequence').bind(identity.id,row.revision).all<any>();
 const ledger=rows.results.map(r=>({entry:JSON.parse(r.entry),hash:r.hash}));
 const last=new Map<string,string|null>();for(const l of ledger)for(const c of l.entry.changes)last.set(c.kind+':'+c.id,c.digest);
 // Detect stored record edits that bypassed the append-only mutation service.
 const rawRecords=[...entityKinds.flatMap(kind=>(store[kind] as any[]).map(value=>({kind,id:value.id||value.agentId,value}))),{kind:'meta',id:'state',value:{version:store.version,globalPolicies:store.globalPolicies,sequence:store.sequence,updatedAt:store.updatedAt}}];
 const found=new Set(rawRecords.map(r=>r.kind+':'+r.id));
 for(const r of rawRecords)if(last.get(r.kind+':'+r.id)!==await sha256(canonical(r.value)))throw new HttpError(409,'Stored evidence does not match its audit digests. Export was stopped.');
 for(const [key,digest] of last)if(digest&&!found.has(key))throw new HttpError(409,'An audited record is missing. Export was stopped.');
 const runs=store.runs.filter(r=>runId?r.id===runId:scope==='all'||r.source==='live');if(runId&&!runs.length)throw new HttpError(404,'Run not found.');
 const runIds=new Set(runs.map(r=>r.id)),agentIds=new Set(runs.map(r=>r.agentId));
 const approvals=store.approvals.filter(a=>runIds.has(a.runId)),policies=store.policies.filter(a=>runIds.has(a.runId)),reviewIds=new Set([...approvals,...policies].map(x=>x.id));
 const records=sanitize({agents:store.agents.filter(a=>agentIds.has(a.id)),definitions:store.definitions.filter(d=>agentIds.has(d.agentId)),globalPolicies:store.globalPolicies,runs,toolCalls:store.toolCalls.filter(t=>runIds.has(t.runId)),policyEvents:policies,approvals,assignments:store.assignments.filter(a=>reviewIds.has(a.reviewId)),audit:store.audit.filter(a=>runIds.has(a.target)||reviewIds.has(a.target)||a.agentId&&agentIds.has(a.agentId))});
 const limitations=['The signature authenticates this server snapshot; it does not prove that externally reported actions happened.','Pin the signing-key fingerprint independently. A privileged database operator could replace both the data and signing key.','Seeded simulation and imported browser records are labeled separately. Local tool functions do not contact external systems.','Definitions and global policies are the current configuration; recorded run revision numbers identify the revision used.','Only sanitized recorded output and summaries are exported. Review decisions do not resume held runs.'];
 const createdAt=new Date().toISOString(),publicKey=JSON.parse(row.public_key),checkpoint={workspace:identity.id,revision:row.revision,head:row.head,recordsDigest:await sha256(canonical(records)),metadataDigest:await sha256(canonical({schema:'lumen.evidence.v1',scope:runId||scope,limitations})),exportedAt:createdAt};
 const key=await crypto.subtle.importKey('jwk',JSON.parse(row.private_key),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const signature=hex(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(canonical(checkpoint))));
 const bundle:EvidenceBundle={schema:'lumen.evidence.v1',createdAt,scope:runId||scope,records,ledger,checkpoint,publicKey,keyFingerprint:await sha256(canonical(publicKey)),signature,algorithm:'ECDSA-P256-SHA256',limitations};
 await verifyEvidence(bundle);
 return Response.json(bundle,{headers:{'Cache-Control':'no-store','Content-Disposition':'attachment; filename="lumen-evidence.json"'}});
 }catch(e){return replyError(e)}}
