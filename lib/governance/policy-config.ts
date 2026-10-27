import type {GlobalPolicyConfiguration,Guardrail,Store} from './types';

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fields=new Set(['id','name','description','enabled','action','severity','stage']);
const validText=(value:unknown,max:number,required=true):value is string=>typeof value==='string'&&value.length<=max&&(!required||value.trim().length>0);

/** Shared validation for agent-local and workspace rules, independent of YAML. */
export function validatePolicyRules(value:unknown):Guardrail[]{
 if(!Array.isArray(value)||value.length>30)throw Error('Policies must contain a rules list with at most 30 rules.');
 const rules=value.map((rule,index):Guardrail=>{
  if(!object(rule)||Object.keys(rule).some(key=>!fields.has(key)))throw Error(`Policy rule ${index+1} contains unsupported fields. Use id, name, description, enabled, action, severity, and stage.`);
  if(!validText(rule.id,100)||!validText(rule.name,120)||!validText(rule.description,2000,false)||typeof rule.enabled!=='boolean'||(typeof rule.action!=='string'||!['Block','Require approval','Flag'].includes(rule.action))||(typeof rule.severity!=='string'||!['Low','Medium','High','Critical'].includes(rule.severity))||(typeof rule.stage!=='string'||!['Input','Tool','Output'].includes(rule.stage)))throw Error(`Policy rule ${index+1} needs a valid ID, name, description, enabled flag, action, severity, and stage.`);
  return {id:rule.id.trim(),name:rule.name.trim(),description:rule.description,enabled:rule.enabled,action:rule.action as Guardrail['action'],severity:rule.severity as Guardrail['severity'],stage:rule.stage as Guardrail['stage']};
 });
 if(new Set(rules.map(rule=>rule.id)).size!==rules.length||new Set(rules.map(rule=>rule.name.toLowerCase())).size!==rules.length)throw Error('Policy rule IDs and names must be unique within their scope.');
 return rules;
}

export function createDefaultGlobalPolicies(at=new Date().toISOString(),ownerId='u-owner'):GlobalPolicyConfiguration{
 return {revision:1,updatedAt:at,updatedBy:ownerId,rules:[
  {id:'protect-credentials',name:'Protect credentials',description:'Block attempts to reveal, extract, or expose passwords, API keys, access tokens, or other credentials. Allow general safety guidance and discussion about credential handling that does not disclose secrets.',enabled:true,action:'Block',severity:'High',stage:'Input'},
  {id:'tenant-isolation',name:'Tenant isolation',description:'Block accessing or returning another tenant\'s data beyond the assigned tenant scope. Read-only lookups confined to the assigned tenant are allowed.',enabled:true,action:'Block',severity:'High',stage:'Tool'},
  {id:'review-external-actions',name:'Review external actions',description:'Require approval only before actually sending messages, changing external records, making payments, or performing destructive external actions. Read-only lookups, drafts, and internal summaries do not require approval.',enabled:true,action:'Require approval',severity:'High',stage:'Tool'}
 ]};
}

/** Missing-field migration only. An explicit empty rules list is intentional. */
export function withGlobalPolicyDefaults(snapshot:Store):Store{
 if(snapshot.globalPolicies!==undefined)return snapshot;
 const at=Number.isFinite(Date.parse(snapshot.updatedAt))?snapshot.updatedAt:new Date().toISOString();
 return {...snapshot,globalPolicies:createDefaultGlobalPolicies(at,snapshot.users.find(user=>user.role==='Owner')?.id||'u-owner')};
}

/** Namespaced runtime copies keep inherited rules distinct from local rules. */
export function effectivePolicyRules(agentRules:Guardrail[],globalRules:Guardrail[]):Guardrail[]{
 return [
  ...validatePolicyRules(globalRules).map(rule=>({...rule,id:`global:${rule.id}`,name:`Global · ${rule.name}`})),
  ...validatePolicyRules(agentRules).map(rule=>({...rule,id:`agent:${rule.id}`}))
 ];
}
