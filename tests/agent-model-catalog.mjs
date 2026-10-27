import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import ts from 'typescript';
const dir=new URL('../.sites-runtime/agent-model-catalog-tests/',import.meta.url);
await mkdir(new URL('agent-execution/',dir),{recursive:true});
await writeFile(new URL('models.mjs',dir),await readFile(new URL('../lib/models.mjs',import.meta.url)));
const source=await readFile(new URL('../lib/agent-execution/model-catalog.ts',import.meta.url),'utf8');
await writeFile(new URL('agent-execution/model-catalog.mjs',dir),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {fetchAgentModels}=await import(new URL('agent-execution/model-catalog.mjs',dir));
const {DEFAULT_AGENT_BASE_URL,normalizeNebiusBaseUrl,agentBaseUrl,validAgentModelId}=await import('../lib/models.mjs');
assert.equal(agentBaseUrl({name:'nvidia/Nemotron-3-Ultra-550b-a55b'}),DEFAULT_AGENT_BASE_URL);
assert.equal(agentBaseUrl({name:'deepseek-ai/DeepSeek-V4.1-Flash'}),'https://api.tokenfactory.us-north1.nebius.com/v1/');
assert(validAgentModelId('vendor/model-LoRa:adapter-123'));assert(!validAgentModelId('https://example.com/model'));
const original=globalThis.fetch;let captured,calls=0;
try{
 globalThis.fetch=async(url,options)=>{if(options.redirect==='error')throw new TypeError('Cloudflare Workers does not implement this redirect mode');calls++;captured={url,options};return Response.json({data:[{id:'vendor/Z-model'},{id:'vendor/A-model'},{id:'vendor/Z-model'},{id:'bad model'},{id:'https://example.com/model'},{secret:'unrelated'},null]})};
 for(const bad of ['https://example.com/v1/','https://api.tokenfactory.us-central1.nebius.com.attacker.example/v1/','https://api.tokenfactory.us-central1.nebius.com/v1/?q=1','https://user@api.tokenfactory.us-central1.nebius.com/v1/','https://api.tokenfactory.us-central1.nebius.com/v1/../']){
  assert.equal(normalizeNebiusBaseUrl(bad),'');await assert.rejects(()=>fetchAgentModels(bad,'test-secret'),error=>error.status===400);
 }
 await assert.rejects(()=>fetchAgentModels(DEFAULT_AGENT_BASE_URL,''),error=>error.status===503);assert.equal(calls,0);
 const result=await fetchAgentModels(DEFAULT_AGENT_BASE_URL.replace(/\/$/,''),'test-secret');
 assert.equal(captured.url,DEFAULT_AGENT_BASE_URL+'models');assert.equal(captured.options.redirect,'manual');assert.equal(captured.options.headers.Authorization,'Bearer test-secret');
 assert.deepEqual(result,{baseUrl:DEFAULT_AGENT_BASE_URL,models:[{id:'vendor/A-model'},{id:'vendor/Z-model'}],truncated:false});
 assert(!JSON.stringify(result).includes('test-secret'));
 let redirectCalls=0;globalThis.fetch=async()=>{redirectCalls++;return new Response(null,{status:302,headers:{Location:'https://example.invalid/credential-target'}})};
 await assert.rejects(()=>fetchAgentModels(DEFAULT_AGENT_BASE_URL,'test-secret'),/redirected/);assert.equal(redirectCalls,1);
 globalThis.fetch=async()=>Response.json({data:[]});assert.deepEqual((await fetchAgentModels(DEFAULT_AGENT_BASE_URL,'test-secret')).models,[]);
 globalThis.fetch=async()=>Response.json({detail:'test-secret'}, {status:401});await assert.rejects(()=>fetchAgentModels(DEFAULT_AGENT_BASE_URL,'test-secret'),error=>error.status===502&&!error.message.includes('test-secret'));
 globalThis.fetch=async()=>Response.json({data:'invalid'});await assert.rejects(()=>fetchAgentModels(DEFAULT_AGENT_BASE_URL,'test-secret'),/invalid model catalog/);
 globalThis.fetch=async()=>{throw Error('network credentials test-secret')};await assert.rejects(()=>fetchAgentModels(DEFAULT_AGENT_BASE_URL,'test-secret'),error=>error.status===504&&!error.message.includes('test-secret'));
}finally{globalThis.fetch=original}
console.log('Model catalog passed: approved endpoints only, safe credential routing, bounded ID import, regional defaults, empty/error states, and no secret exposure.');
