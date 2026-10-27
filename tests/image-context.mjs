import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {guidedRequest} from '../lib/guided-request.mjs';
import {DEFAULT_MODEL} from '../lib/models.mjs';

const source=await readFile(new URL('../lib/image-context.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
const code=outputText.replace("'./agent-execution/nebius'",JSON.stringify(new URL('../lib/agent-execution/nebius.ts',import.meta.url).href)).replace("'./models.mjs'",JSON.stringify(new URL('../lib/models.mjs',import.meta.url).href));
const {appendImageContext,describeImage,validateImageContexts,validateImageInput,readImageJson,ImageContextError,VISION_MODEL,VISION_ENDPOINT}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9xkAAAAASUVORK5CYII=';
const input={id:'img-1',name:'Screenshot.png',dataUrl:pixel};
const images=[{id:'img-1',name:'Screenshot.png',context:'A chart labeled Revenue, with an upward line.',visionModel:VISION_MODEL}];
assert.deepEqual(validateImageInput(input),input);
assert.deepEqual(validateImageContexts(undefined),[]);
assert.deepEqual(validateImageContexts(images),images);
assert.equal(appendImageContext('Keep the exact prompt.\n',undefined),'Keep the exact prompt.\n');
const context=appendImageContext('Explain this chart.',images);
assert(context.startsWith('Explain this chart.\n\n'));
assert(context.includes('untrusted visual data'));
assert(context.includes('Revenue'));
assert(!context.includes(pixel));
assert(appendImageContext('',images).startsWith('Describe the attached image.'));
const guided=guidedRequest(DEFAULT_MODEL,context,'The chart');
assert.equal(guided.messages[0].content,context);
assert.equal(guided.messages[1].content,'<think>\n\n</think>\n\nThe chart');
assert.equal(guided.top_logprobs,20);
for(const bad of [null,{},'wrong',[...images,...images],Array(4).fill(images[0]),[{...images[0],context:''}],[{...images[0],context:'a'.repeat(12001)}],[{...images[0],dataUrl:pixel}],[{...images[0],name:'a\nb'}]])assert.throws(()=>validateImageContexts(bad),ImageContextError);
for(const dataUrl of ['https://example.com/a.png','data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,YmFk','data:image/jpeg;base64,'+pixel.split(',')[1],pixel+'!!!'])assert.throws(()=>validateImageInput({...input,dataUrl}),ImageContextError);
assert.throws(()=>validateImageInput({...input,dataUrl:'x'.repeat(3*1024*1024)}),e=>e.status===413);
assert.deepEqual(await readImageJson(new Request('https://example.test/api',{method:'POST',body:JSON.stringify(input)})),input);
await assert.rejects(()=>readImageJson(new Request('https://example.test/api',{method:'POST',body:'{'})),e=>e.status===400);
await assert.rejects(()=>readImageJson(new Request('https://example.test/api',{method:'POST',body:'x',headers:{'content-length':String(4*1024*1024)}})),e=>e.status===413);
const tooLarge=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(3*1024*1024));controller.enqueue(new Uint8Array(1));controller.close()}});
await assert.rejects(()=>readImageJson(new Request('https://example.test/api',{method:'POST',body:tooLarge,duplex:'half'})),e=>e.status===413);

let calls=0,captured;
const signal=new AbortController().signal;
const fake=async(url,options)=>{calls++;captured={url,options,body:JSON.parse(options.body)};return Response.json({choices:[{finish_reason:'stop',message:{content:'<think>hidden reasoning</think>A red square.',reasoning_content:'also hidden'}}]})};
assert.deepEqual(await describeImage(input,'test-key',signal,fake),{id:'img-1',context:'A red square.',model:VISION_MODEL});
assert.equal(captured.url,VISION_ENDPOINT);
assert.equal(captured.body.model,VISION_MODEL);
assert.equal(captured.body.messages[1].content[1].image_url.url,pixel);
assert.equal(captured.body.max_tokens,8192);
assert.equal(captured.options.headers.Authorization,'Bearer test-key');
assert(!('logprobs'in captured.body));assert(!('top_logprobs'in captured.body));assert(!('reasoning_effort'in captured.body));
await assert.rejects(()=>describeImage(input,'',signal,fake),e=>e.status===503);
const aborted=new AbortController();aborted.abort();await assert.rejects(()=>describeImage(input,'test-key',aborted.signal,fake),{name:'AbortError'});assert.equal(calls,1);
for(const status of [401,403,404,429,500]){
 await assert.rejects(()=>describeImage(input,'test-key',signal,async()=>new Response('secret provider output',{status})),e=>e.status===502&&!e.message.includes('secret provider output'));
}
for(const choice of [
 {finish_reason:'length',message:{content:'Partial output'}},
 {finish_reason:'content_filter',message:{content:'Filtered'}},
 {finish_reason:'stop',message:{content:'<think>unfinished reasoning'}},
 {finish_reason:'stop',message:{content:null,reasoning_content:'hidden'}},
 {finish_reason:'stop',message:{content:'x'.repeat(12001)}},
])await assert.rejects(()=>describeImage(input,'test-key',signal,async()=>Response.json({choices:[choice]})),e=>e.status===502);
await assert.rejects(()=>describeImage(input,'test-key',signal,async()=>new Response('not JSON')),e=>e.status===502);
await assert.rejects(()=>describeImage(input,'test-key',signal,async()=>{throw new Error('network secret')}),e=>e.status===502&&!e.message.includes('network secret'));
const lateAbort=new AbortController();await assert.rejects(()=>describeImage(input,'test-key',lateAbort.signal,async()=>{lateAbort.abort();return Response.json({choices:[{message:{content:'Late'}}]})}),{name:'AbortError'});
console.log('Image context passed: bounded uploads, MIME signatures, safe context framing, exact guided prefixes, fixed vision endpoint, hidden reasoning removal, provider errors, and cancellation.');
