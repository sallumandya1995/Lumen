import {isAlias,isMap,isScalar,isSeq,LineCounter,parseDocument,stringify,type Node} from 'yaml';
import {validatePolicyRules} from './policy-config';
import type {Guardrail} from './types';

export type PolicyFileScope={scope:'global';agentId?:undefined}|{scope:'agent';agentId:string};
const MAX_FILE_SIZE=64*1024;
const envelopeKeys=new Set(['version','scope','agent_id','policies']);
const ruleKeys=new Set(['id','name','description','enabled','stage','action','severity']);
const forbiddenKeys=new Set(['__proto__','prototype','constructor','<<']);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

function checkTarget(target:PolicyFileScope){
 if(!target||!['global','agent'].includes(target.scope))throw Error('Choose a global or agent policy scope.');
 if(target.scope==='agent'&&(typeof target.agentId!=='string'||!target.agentId.trim()||target.agentId.length>100))throw Error('Choose a valid agent before loading its policy file.');
 if(target.scope==='global'&&target.agentId!==undefined)throw Error('Global policy files cannot specify an agent.');
}
function checkSize(source:string){
 if(typeof source!=='string'||!source.trim())throw Error('Enter a policy YAML document.');
 if(source.length>MAX_FILE_SIZE||new TextEncoder().encode(source).byteLength>MAX_FILE_SIZE)throw Error('Policy YAML must be no larger than 64 KiB.');
}
function schemaError(message:string,node:unknown,lineCounter:LineCounter):never{
 const offset=object(node)&&Array.isArray(node.range)&&typeof node.range[0]==='number'?node.range[0]:undefined;
 const position=offset===undefined?undefined:lineCounter.linePos(offset);
 throw Error(position?`${message} (line ${position.line}, column ${position.col}).`:message);
}
/** Inspect before conversion: no aliases, anchors, complex keys, merge keys,
 * custom objects, or deep structures are needed by this scalar-only schema. */
function inspectDocument(root:Node|null,lineCounter:LineCounter){
 const pending:{node:unknown;depth:number}[]=[{node:root,depth:0}];let count=0;
 while(pending.length){
  const {node,depth}=pending.pop()!;
  if(depth>4||++count>2048)schemaError('The policy YAML structure is too deeply nested or too complex',node,lineCounter);
  if(node===null)continue;
  if(isAlias(node))schemaError('YAML aliases are not supported in policy files',node,lineCounter);
  if(object(node)&&typeof node.anchor==='string')schemaError('YAML anchors are not supported in policy files',node,lineCounter);
  if(isMap(node)){
   for(const pair of node.items){
    if(!isScalar(pair.key)||typeof pair.key.value!=='string')schemaError('Policy field names must be plain string keys',pair.key,lineCounter);
    if(forbiddenKeys.has(pair.key.value))schemaError(`The field “${pair.key.value}” is not allowed`,pair.key,lineCounter);
    pending.push({node:pair.key,depth:depth+1},{node:pair.value,depth:depth+1});
   }
  }else if(isSeq(node))for(const item of node.items)pending.push({node:item,depth:depth+1});
  else if(!isScalar(node))schemaError('Unsupported YAML value in policy file',node,lineCounter);
 }
}

/** Strict import for the currently selected scope. It never saves or applies a file. */
export function parsePolicyYaml(source:string,target:PolicyFileScope):Guardrail[]{
 checkTarget(target);checkSize(source);
 const lineCounter=new LineCounter();
 let doc;
 try{doc=parseDocument(source,{version:'1.2',schema:'core',strict:true,uniqueKeys:true,merge:false,resolveKnownTags:false,customTags:[],lineCounter,prettyErrors:true,logLevel:'error'})}
 catch{throw Error('The policy YAML could not be parsed. Check its structure and indentation.')}
 const diagnostic=doc.errors[0]||doc.warnings[0];
 if(diagnostic)throw Error(`Invalid policy YAML: ${diagnostic.message}`);
 if(doc.directives?.yaml.version!=='1.2')throw Error('Policy files must use YAML 1.2.');
 inspectDocument(doc.contents,lineCounter);
 let value:unknown;
 try{value=doc.toJS({maxAliasCount:0})}catch{throw Error('The policy YAML cannot contain aliases or unsupported values.')}
 if(!object(value)||!isMap(doc.contents))schemaError('The policy file must be a mapping with version, scope, and policies',doc.contents,lineCounter);
 for(const key of Object.keys(value))if(!envelopeKeys.has(key))schemaError(`Unknown policy file field “${key}”`,doc.get(key,true),lineCounter);
 if(value.version!==1)schemaError('Policy file version must be the number 1',doc.get('version',true),lineCounter);
 if(value.scope!==target.scope)schemaError(`This file must have scope: ${target.scope}`,doc.get('scope',true),lineCounter);
 if(target.scope==='agent'&&value.agent_id!==target.agentId)schemaError(`This file must have agent_id: ${target.agentId}`,doc.get('agent_id',true),lineCounter);
 if(target.scope==='global'&&Object.hasOwn(value,'agent_id'))schemaError('Global policy files cannot contain agent_id',doc.get('agent_id',true),lineCounter);
 if(!Array.isArray(value.policies))schemaError('The policies field must be a list',doc.get('policies',true),lineCounter);
 for(const [index,rule] of value.policies.entries()){
  if(!object(rule))schemaError(`Policy ${index+1} must be a mapping`,doc.getIn(['policies',index],true),lineCounter);
  for(const key of Object.keys(rule))if(!ruleKeys.has(key))schemaError(`Unknown field “${key}” in policy ${index+1}`,doc.getIn(['policies',index,key],true),lineCounter);
 }
 try{return validatePolicyRules(value.policies)}catch(error){throw Error(`Invalid policy configuration: ${error instanceof Error?error.message:'Check the policy fields.'}`)}
}

/** Stable field order and ordinary YAML scalars keep downloaded files readable. */
export function stringifyPolicyYaml(target:PolicyFileScope,rules:Guardrail[]):string{
 checkTarget(target);
 const checked=validatePolicyRules(rules);
 const file={version:1,scope:target.scope,...(target.scope==='agent'?{agent_id:target.agentId}:{}),policies:checked.map(rule=>({id:rule.id,name:rule.name,description:rule.description,enabled:rule.enabled,stage:rule.stage,action:rule.action,severity:rule.severity}))};
 const source='# Lumen policy configuration\n# Edit the rules below, then validate before saving.\n# Stages: Input, Tool, Output. Actions: Block, Require approval, Flag.\n'+stringify(file,{version:'1.2',schema:'core',lineWidth:100,aliasDuplicateObjects:false,sortMapEntries:false});
 checkSize(source);
 return source;
}
