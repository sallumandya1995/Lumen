/** Deterministic UTF-8 JSON for ledger entries and detached evidence signatures. */
export function canonical(value:any):string {
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(v=>canonical(v===undefined?null:v)).join(',')+']';
 return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
export async function sha256(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
export const hex=(bytes:ArrayBuffer)=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
export function unhex(value:string){if(!/^(?:[a-f0-9]{2})+$/i.test(value))throw Error('Invalid signature');return Uint8Array.from(value.match(/../g)!,x=>parseInt(x,16))}
export type LedgerEntry={sequence:number;previousHash:string;at:string;actor:string;action:string;target:string;changes:{kind:string;id:string;digest:string|null}[]};
export type EvidenceBundle={schema:'lumen.evidence.v1';createdAt:string;scope:string;records:any;ledger:{entry:LedgerEntry;hash:string}[];checkpoint:{workspace:string;revision:number;head:string;recordsDigest:string;metadataDigest:string;exportedAt:string};publicKey:JsonWebKey;keyFingerprint:string;signature:string;algorithm:'ECDSA-P256-SHA256';limitations:string[]};
export async function verifyEvidence(bundle:EvidenceBundle){
 if(bundle.schema!=='lumen.evidence.v1'||bundle.algorithm!=='ECDSA-P256-SHA256')throw Error('Unsupported evidence format or signature algorithm.');
 if(await sha256(canonical({schema:bundle.schema,scope:bundle.scope,limitations:bundle.limitations}))!==bundle.checkpoint.metadataDigest)throw Error('The evidence scope or trust notes were changed.');
 let head='',sequence=0;
 for(const row of bundle.ledger){if(row.entry.sequence!==++sequence||row.entry.previousHash!==head||await sha256(canonical(row.entry))!==row.hash)throw Error('The audit chain has been changed or is incomplete.');head=row.hash}
 if(bundle.checkpoint.revision!==sequence||bundle.checkpoint.head!==head||bundle.createdAt!==bundle.checkpoint.exportedAt)throw Error('The signed checkpoint does not match the audit chain.');
 if(await sha256(canonical(bundle.records))!==bundle.checkpoint.recordsDigest)throw Error('Evidence records do not match the signed digest.');
 if(await sha256(canonical(bundle.publicKey))!==bundle.keyFingerprint)throw Error('Signing key fingerprint mismatch.');
 const key=await crypto.subtle.importKey('jwk',bundle.publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,unhex(bundle.signature),new TextEncoder().encode(canonical(bundle.checkpoint))))throw Error('The evidence signature is invalid.');
 return {valid:true,entries:sequence,fingerprint:bundle.keyFingerprint};
}
