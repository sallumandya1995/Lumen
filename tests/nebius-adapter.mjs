import assert from 'node:assert/strict';
import {createNebiusInvoker,ProviderError,visibleAnswer} from '../lib/agent-execution/nebius.ts';
import {DEFAULT_MODEL} from '../lib/models.mjs';

assert.equal(visibleAnswer('<think>private analysis</think>Visible answer'),'Visible answer');
assert.equal(visibleAnswer('private prefix</think>Visible answer'),'Visible answer');
assert.equal(visibleAnswer('<think>unfinished reasoning'),'');
assert.equal(visibleAnswer('<ANALYSIS>private</ANALYSIS> final'),'final');
assert.equal(visibleAnswer('answer <think>private</think> after'),'answer  after');
const originalFetch=globalThis.fetch;
const call={model:DEFAULT_MODEL,system:'A helpful agent.',input:'Answer the task.',temperature:.2,maxTokens:512,signal:new AbortController().signal,purpose:'agent'};
const invoke=createNebiusInvoker('test-key');let captured;
try{
 globalThis.fetch=async(url,options)=>{if(options.redirect==='error')throw new TypeError('Workers does not implement redirect:error');captured={url,options,body:JSON.parse(options.body)};return Response.json({choices:[{finish_reason:'stop',message:{content:'<think>private</think>Done.',reasoning_content:'hidden'}}],usage:{total_tokens:25}})};
 assert.deepEqual(await invoke(call),{text:'Done.',tokens:25});
 assert.equal(captured.url,'https://api.tokenfactory.us-central1.nebius.com/v1/chat/completions');
 assert.equal(captured.body.model,DEFAULT_MODEL);assert.equal(captured.body.max_tokens,512);assert.equal(captured.options.headers.Authorization,'Bearer test-key');
 assert.equal(captured.options.redirect,'manual');assert(!captured.body.messages.some(m=>m.content.includes('test-key')));
 await invoke({...call,model:'deepseek-ai/DeepSeek-V4.1-Flash'});assert.equal(captured.url,'https://api.tokenfactory.us-north1.nebius.com/v1/chat/completions');
 await invoke({...call,model:'my-team/Imported-Chat:review-v2',baseUrl:'https://api.tokenfactory.nebius.com/v1'});
 assert.equal(captured.url,'https://api.tokenfactory.nebius.com/v1/chat/completions');assert.equal(captured.body.model,'my-team/Imported-Chat:review-v2');assert.equal(captured.options.redirect,'manual');
 await invoke({...call,model:'my-team/Imported-Chat',baseUrl:'https://api.tokenfactory.us-north1.nebius.com/v1/'});assert.equal(captured.url,'https://api.tokenfactory.us-north1.nebius.com/v1/chat/completions');
 await invoke({...call,model:'my-team/Imported-Chat'});assert.equal(captured.url,'https://api.tokenfactory.us-central1.nebius.com/v1/chat/completions');
 await invoke({...call,model:'deepseek-ai/DeepSeek-V4-Pro'});assert.equal(captured.body.model,'deepseek-ai/DeepSeek-V4-Pro');
 let count=0;globalThis.fetch=async()=>{count++;return new Response('private server details',{status:429})};
 await assert.rejects(()=>invoke(call),e=>e instanceof ProviderError&&e.retryable&&!e.message.includes('private server details'));assert.equal(count,1);
 await assert.rejects(()=>invoke({...call,model:'https://attacker.example/model'}),/valid Nebius model ID/);assert.equal(count,1);
 for(const baseUrl of ['https://attacker.example/v1/','https://api.tokenfactory.nebius.com.attacker.example/v1/','https://api.tokenfactory.nebius.com/v1/?key=test-key','https://user:test-key@api.tokenfactory.nebius.com/v1/','https://api.tokenfactory.nebius.com/v1/#test-key','http://api.tokenfactory.nebius.com/v1/']){
  await assert.rejects(()=>invoke({...call,baseUrl}),e=>e instanceof ProviderError&&/approved Nebius base URL/.test(e.message)&&!e.message.includes('test-key'));
 }
 assert.equal(count,1,'Unapproved endpoints must be rejected before any fetch.');
 for(const status of [400,404]){
  globalThis.fetch=async()=>new Response('provider-internal diagnostics with test-key',{status});
  await assert.rejects(()=>invoke({...call,model:'my-team/Unknown-Chat'}),e=>e instanceof ProviderError&&!e.retryable&&e.message.includes(String(status))&&/model ID/.test(e.message)&&!e.message.includes('test-key')&&!e.message.includes('provider-internal'));
 }
 let redirectRequests=0;
 globalThis.fetch=async(url,options)=>{
  redirectRequests++;assert.equal(options.redirect,'manual');assert.equal(url,'https://api.tokenfactory.us-central1.nebius.com/v1/chat/completions');
  const response=new Response('private redirect body with test-key',{status:302,headers:{Location:'https://attacker.example/capture'}});
  response.json=async()=>assert.fail('Redirect response body must not be read');response.text=async()=>assert.fail('Redirect response body must not be read');return response;
 };
 await assert.rejects(()=>invoke(call),e=>e instanceof ProviderError&&!e.retryable&&/redirect/.test(e.message)&&!e.message.includes('test-key')&&!e.message.includes('attacker.example'));
 assert.equal(redirectRequests,1,'A redirect must not trigger a second request or forward credentials.');
 globalThis.fetch=async(_url,options)=>{assert.equal(options.redirect,'manual');throw new Error('transport includes test-key')};
 await assert.rejects(()=>invoke(call),e=>e instanceof ProviderError&&!e.message.includes('test-key'));
 globalThis.fetch=async()=>Response.json({choices:[{finish_reason:'length',message:{content:'partial'}}]});
 await assert.rejects(()=>invoke(call),/token limit/);
 globalThis.fetch=async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'<think>hidden</think>',reasoning_content:'never shown'}}]});
 await assert.rejects(()=>invoke(call),/no visible answer/);
 const abort=new AbortController();abort.abort();await assert.rejects(()=>invoke({...call,signal:abort.signal}),{name:'AbortError'});
}finally{globalThis.fetch=originalFetch}
console.log('Nebius adapter passed: configurable models, approved regional endpoints, redirect refusal, secret handling, visible answers, cancellation, retry classification, and incomplete responses.');
