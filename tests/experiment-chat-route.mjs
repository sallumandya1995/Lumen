import assert from 'node:assert/strict';
import ts from 'typescript';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

const dir=new URL('../.sites-runtime/experiment-route-tests/',import.meta.url);await mkdir(dir,{recursive:true});
let source=await readFile(new URL('../app/api/chat/route.ts',import.meta.url),'utf8');
source=source.replace("import {appendImageContext} from '../../../lib/image-context';","const appendImageContext=(text:string)=>text;")
 .replace("import { env } from 'cloudflare:workers';","const env={NEBIUS_API_KEY:'test-fixture-only'};")
 .replace(/from '\.\.\/\.\.\/\.\.\/lib\/([^']+)'/g,(_,path)=>`from '${new URL('../lib/'+path,import.meta.url).href}'`);
await writeFile(new URL('route.mjs',dir),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {POST}=await import(new URL('route.mjs',dir));
const original=globalThis.fetch,calls=[];
globalThis.fetch=async(url,options)=>{
 calls.push({url,body:JSON.parse(options.body)});
 return Response.json({choices:[{message:{content:'YES'},finish_reason:'stop',logprobs:{content:[{token:'YES',logprob:-.1,top_logprobs:[{token:'YES',logprob:-.1}]}]}}],usage:{prompt_tokens:8,completion_tokens:2,total_tokens:10}});
};
async function request(body){const response=await POST(new Request('https://lumen.test/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));return {response,data:await response.json()}}
try{
 const user={role:'user',content:'Reply to this request.'};
 let {response,data}=await request({messages:[user],systemPrompt:'Respond only YES.',parameters:{temperature:.2,top_p:.95}});
 assert.equal(response.status,200);assert.equal(data.content,'YES');
 assert.deepEqual(calls.at(-1).body.messages,[{role:'system',content:'Respond only YES.'},user]);
 assert.deepEqual(data.usage,{inputTokens:8,outputTokens:2,totalTokens:10});assert.equal(data.finishReason,'stop');assert.equal(data.logprobs.length,1);
 assert.equal(calls.at(-1).body.temperature,.2);assert.equal(calls.at(-1).body.top_p,.95);assert.equal(calls.at(-1).body.top_logprobs,10);
 assert.equal(calls.at(-1).body.model,'nvidia/Nemotron-3-Ultra-550b-a55b');
 for(const [temperature,top_p] of [[0,.5],[.7,.95],[2,1]]){
  const variation=await request({messages:[user],parameters:{temperature,top_p}});
  assert.equal(variation.response.status,200);
  assert.equal(calls.at(-1).body.model,'nvidia/Nemotron-3-Ultra-550b-a55b');
  assert.equal(calls.at(-1).body.temperature,temperature);assert.equal(calls.at(-1).body.top_p,top_p);
 }
 await request({messages:[user]});assert.deepEqual(calls.at(-1).body.messages,[user]);
 await request({messages:[user],systemPrompt:'  '});assert.deepEqual(calls.at(-1).body.messages,[user]);
 const before=calls.length;
 for(const systemPrompt of [{bad:true},'a'.repeat(8001)])assert.equal((await request({messages:[user],systemPrompt})).response.status,400);
 assert.equal((await request({messages:[{role:'system',content:'not a conversation role'}]})).response.status,400);
 assert.equal(calls.length,before);
 console.log('Experiment chat route passed: separate bounded system prompt, unchanged ordinary chat payload, actual usage metadata, finish reason, model parameters, and validation before provider calls.');
}finally{globalThis.fetch=original}
