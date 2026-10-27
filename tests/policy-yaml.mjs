import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import ts from 'typescript';

const dir=new URL('../.sites-runtime/policy-yaml-tests/',import.meta.url);
await mkdir(dir,{recursive:true});
await writeFile(new URL('models.mjs',dir),await readFile(new URL('../lib/models.mjs',import.meta.url)));
for(const name of ['policy-config','policy-yaml','definitions','end-to-end-demo','mock-data']){
 const source=await readFile(new URL(`../lib/governance/${name}.ts`,import.meta.url),'utf8');
 const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
 await writeFile(new URL(name+'.mjs',dir),outputText.replace("from '../models.mjs'","from './models.mjs'").replace(/from '\.\/(policy-config|policy-yaml|definitions|end-to-end-demo|mock-data)'/g,"from './$1.mjs'"));
}
const {parsePolicyYaml,stringifyPolicyYaml}=await import(new URL('policy-yaml.mjs',dir));
const {createDefaultGlobalPolicies}=await import(new URL('policy-config.mjs',dir));
const {createSeed}=await import(new URL('mock-data.mjs',dir));
const global={scope:'global'},agent={scope:'agent',agentId:'a-support'};
const rule={id:'review-outbound',name:'Review outbound actions',description:'Require review before sending an external message.',enabled:true,stage:'Tool',action:'Require approval',severity:'High'};
const seed=createSeed();
for(const definition of seed.definitions){
 const target={scope:'agent',agentId:definition.agentId};
 assert.deepEqual(parsePolicyYaml(stringifyPolicyYaml(target,definition.guardrails),target),definition.guardrails);
}
const defaultGlobal=createDefaultGlobalPolicies().rules;
assert.deepEqual(parsePolicyYaml(stringifyPolicyYaml(global,defaultGlobal),global),defaultGlobal);
assert.deepEqual(parsePolicyYaml(stringifyPolicyYaml(global,[]),global),[]);
assert.deepEqual(parsePolicyYaml(stringifyPolicyYaml(agent,[]),agent),[]);
const before=structuredClone([rule]);
const yaml=stringifyPolicyYaml(agent,before);
assert.equal(stringifyPolicyYaml(agent,before),yaml);
assert.deepEqual(before,[rule]);
assert(yaml.startsWith('# Lumen policy configuration\n'));
assert(!yaml.includes('revision:'));
assert(yaml.indexOf('version:')<yaml.indexOf('scope:'));
assert(yaml.indexOf('scope:')<yaml.indexOf('agent_id:'));
const edited=yaml.replace('enabled: true','enabled: false').replace('severity: High','severity: Critical');
assert.deepEqual(parsePolicyYaml(edited,agent),[{...rule,enabled:false,severity:'Critical'}]);
const unicode={...rule,id:'01',name:'true',description:'Line one: "Quoted" # text\nSecond line — مراجعة 🔎\n',enabled:false};
assert.deepEqual(parsePolicyYaml(stringifyPolicyYaml(agent,[unicode]),agent),[unicode]);
const document=(policies='[]',extra='')=>`version: 1\nscope: global\n${extra}policies: ${policies}\n`;
const rejected=(source,target=global,pattern)=>assert.throws(()=>parsePolicyYaml(source,target),pattern);

// File scope cannot silently apply rules to a different target.
rejected(yaml,global,/scope/);
rejected(yaml,{scope:'agent',agentId:'a-finance'},/agent_id/);
rejected(yaml.replace('agent_id: a-support\n',''),agent,/agent_id/);
rejected(document('[]','agent_id: a-support\n'),global,/agent_id/);
rejected(document('[]','agent_id: null\n'),global,/agent_id/);
rejected(document().replace('version: 1','version: "1"'),global,/version/);
rejected(document().replace('version: 1','version: 2'),global,/version/);
rejected(document().replace('scope: global','scope: workspace'),global,/scope/);
rejected('[]',global,/mapping/);
rejected('version: 1\nscope: global\n',global,/policies/);
rejected(document('{}'),global,/list/);
rejected(document('null'),global,/list/);
rejected(document('[null]'),global,/mapping/);

// Strict YAML and schema: reject ambiguous or executable-looking extensions.
rejected(document('[{'),global,/line \d+, column \d+/i);
rejected('version: 1\nscope: global\nscope: global\npolicies: []\n',global,/unique|duplicate/i);
rejected(document()+`---\n${document()}`,global,/multiple documents|single document/i);
rejected(document('!custom []'),global,/tag|custom/i);
rejected(document('!!js/function function() {}'),global,/tag/i);
rejected(document('!!timestamp 2026-10-21'),global,/tag/i);
rejected('%YAML 1.1\n---\n'+document(),global,/YAML 1.2/);
rejected(document('&rules []'),global,/anchor/i);
rejected('version: 1\nscope: global\npolicies: [*missing]\n',global,/alias/i);
rejected('version: 1\nscope: global\npolicies: &rules [*rules]\n',global,/anchor|alias/i);
rejected(document('[]','__proto__: {polluted: true}\n'),global,/not allowed/);
rejected(document('[]','constructor: {}\n'),global,/not allowed/);
rejected(document('[]','<<: {scope: agent}\n'),global,/not allowed/);
rejected(document('[]','unknown: true\n'),global,/Unknown/);
rejected(document('[]','? [scope, global]\n: true\n'),global,/string keys|complex/i);
rejected(document('['.repeat(20)+'0'+']'.repeat(20)),global,/deeply nested/);

for(const replacement of [
 ['enabled: true','enabled: "true"'],['enabled: true','enabled: yes'],
 ['action: Require approval','action: Execute'],['severity: High','severity: Extreme'],
 ['stage: Tool','stage: tool'],['name: Review outbound actions','name: []'],
 ['description: Require review before sending an external message.','description: {nested: value}'],
 ['id: review-outbound','id: 12'],['id: review-outbound','id: ""']
])rejected(yaml.replace(...replacement),agent,/Invalid policy configuration/);
rejected(yaml.replace('severity: High','severity: High\n    script: run()'),agent,/Unknown|indent|mapping/i);
rejected(yaml.replace('severity: High','severity: High\n    prototype: true'),agent,/not allowed/i);
rejected(yaml.replace('enabled: true','enabled: true\n    enabled: false'),agent,/unique|duplicate/i);
const duplicateIds=JSON.stringify({version:1,scope:'global',policies:[rule,{...rule,name:'Another name'}]});
rejected(duplicateIds,global,/unique/i);
const duplicateNames=JSON.stringify({version:1,scope:'global',policies:[rule,{...rule,id:'other',name:rule.name.toUpperCase()}]});
rejected(duplicateNames,global,/unique/i);
const tooMany=JSON.stringify({version:1,scope:'global',policies:Array.from({length:31},(_,i)=>({...rule,id:`rule-${i}`,name:`Rule ${i}`}))});
rejected(tooMany,global,/30/);
for(const patch of [{id:'i'.repeat(101)},{name:'n'.repeat(121)},{description:'d'.repeat(2001)}])rejected(JSON.stringify({version:1,scope:'global',policies:[{...rule,...patch}]}),global,/Invalid policy configuration/);
rejected('',global,/Enter/);
rejected(document()+'#'+'a'.repeat(65536),global,/64 KiB/);
// Unicode bytes are bounded as well as JavaScript character count.
rejected(document()+'#'+'界'.repeat(22000),global,/64 KiB/);
assert.equal({}.polluted,undefined);
assert.throws(()=>stringifyPolicyYaml({scope:'global',agentId:'a-support'},[]),/cannot specify/);
assert.throws(()=>stringifyPolicyYaml({scope:'agent',agentId:''},[]),/valid agent/);
console.log('Policy YAML passed: all defaults round-trip, scoped imports, edits, strict schemas, duplicate detection, alias/tag/prototype rejection, and size/depth limits.');
