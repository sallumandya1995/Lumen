import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import ts from 'typescript';
import {DEFAULT_MODEL,DEFAULT_VISION_MODEL,FEATURE_DEFAULT_MODELS,modelConfig,restoreGuidedModel} from '../lib/models.mjs';
import {initialVariants,newVariant} from '../lib/experiments.ts';

assert(Object.values(FEATURE_DEFAULT_MODELS).every(id=>id.startsWith('nvidia/')));
assert.equal(FEATURE_DEFAULT_MODELS.imageContext,DEFAULT_VISION_MODEL);
assert(initialVariants().every(v=>v.model===DEFAULT_MODEL));
for(let i=1;i<=6;i++)assert.equal(newVariant(i).model,DEFAULT_MODEL);
assert.equal(restoreGuidedModel(undefined),DEFAULT_MODEL);
assert.equal(restoreGuidedModel('removed-model'),DEFAULT_MODEL);
assert.equal(restoreGuidedModel('Qwen/Qwen3-235B-A22B-Instruct-2507'),'Qwen/Qwen3-235B-A22B-Instruct-2507','An active saved draft must keep its selected model');

const dir=new URL('../.sites-runtime/nvidia-default-tests/',import.meta.url);
await mkdir(dir,{recursive:true});
for(const name of ['definitions','end-to-end-demo','policy-config']){
 const input=await readFile(new URL('../lib/governance/'+name+'.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(input,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
  .replace("'../models.mjs'",JSON.stringify(new URL('../lib/models.mjs',import.meta.url).href))
  .replace(/from '\.\/(end-to-end-demo|policy-config)'/g,"from './$1.mjs'");
 await writeFile(new URL(name+'.mjs',dir),code);
}
const {createDefinition}=await import(new URL('definitions.mjs',dir));
const {createEndToEndDemo}=await import(new URL('end-to-end-demo.mjs',dir));
const sample=createEndToEndDemo();
for(const id of ['a-support','a-research','a-revenue','a-finance','a-triage','a-risk','a-lumen-demo','new-agent']){
 const definition=createDefinition({...sample.agent,id});
 assert.equal(definition.model.name,DEFAULT_MODEL,id);
 assert.equal(definition.model.baseUrl,modelConfig(DEFAULT_MODEL).baseUrl,id);
}

let source=await readFile(new URL('../app/api/guide/route.ts',import.meta.url),'utf8');
source=source.replace("import {env} from 'cloudflare:workers';","const env={NEBIUS_API_KEY:'fixture-only'};")
 .replace("import {appendImageContext} from '../../../lib/image-context';","const appendImageContext=(text:string)=>text;")
 .replace(/from '\.\.\/\.\.\/\.\.\/lib\/([^']+)'/g,(_,path)=>`from '${new URL('../lib/'+path,import.meta.url).href}'`);
await writeFile(new URL('guide.mjs',dir),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {POST}=await import(new URL('guide.mjs',dir));
const original=globalThis.fetch;let calls=0;
try{
 globalThis.fetch=async(url,options)=>{
  calls++;const body=JSON.parse(options.body);
  assert.equal(url,modelConfig(DEFAULT_MODEL).baseUrl+'chat/completions');
  assert.equal(body.model,DEFAULT_MODEL);assert.equal(body.top_logprobs,20);assert.equal(body.max_tokens,1);
  assert.equal(body.continue_final_message,true);assert.equal(body.add_generation_prompt,false);
  return Response.json({choices:[{message:{content:'Hello'},finish_reason:'length',logprobs:{content:[{token:'Hello',logprob:-.1,top_logprobs:[{token:'Hi',logprob:-2},{token:'Hello',logprob:-.1}]}]}}]});
 };
 for(const prefix of ['','New','Before confirming a refund, verify','{"tool":','नमस्ते']){
  const response=await POST(new Request('https://lumen.test/api/guide',{method:'POST',body:JSON.stringify({prompt:'Continue the supplied text.',prefix})}));
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.model,DEFAULT_MODEL);assert.equal(data.prefix,prefix);assert.equal(data.alternatives[0].token,'Hello');
 }
 assert.equal(calls,5);
}finally{globalThis.fetch=original}
console.log('NVIDIA defaults passed: eight feature defaults, six experiment variants, eight agent templates, five guided-prefix variants, and saved-session preservation.');
