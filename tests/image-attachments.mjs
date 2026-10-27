import assert from 'node:assert/strict';
import {imageContexts,storedImageContexts,restoreImageContexts,prepareImages,MAX_IMAGE_CONTEXT_LENGTH} from '../lib/image-attachments.ts';
import {editedConversation} from '../lib/chat-settings.mjs';

const first={id:'image-one',name:'Screenshot.png',dataUrl:'data:image/png;base64,aGVsbG8='};
const second={...first,id:'image-two',name:'Chart.png'};
const ready={...first,context:'The screenshot shows an approval queue with three pending reviews.',visionModel:'nvidia/Nemotron-3.5-Super-VL'};
const reply=image=>Response.json({id:image.id,context:`Visible details for ${image.name}.`,model:ready.visionModel});

// Already read images never trigger vision again, and pixels never go to chat/persistence.
let calls=[];
assert.deepEqual(await prepareImages([ready],{fetcher:()=>{throw Error('Unexpected vision call')}}),[ready]);
assert.deepEqual(imageContexts([ready]),[{id:ready.id,name:ready.name,context:ready.context,visionModel:ready.visionModel}]);
assert(!('dataUrl'in storedImageContexts([ready])[0]));
assert.deepEqual(storedImageContexts([first,ready]),imageContexts([ready]));
assert.deepEqual(restoreImageContexts(JSON.parse(JSON.stringify(storedImageContexts([ready])))),imageContexts([ready]));
assert.deepEqual(restoreImageContexts(undefined),[]);
for(const broken of [{},[first],[{...ready,context:''}],[{...ready,visionModel:''}],[ready,ready]])assert.throws(()=>restoreImageContexts(broken),/attach the images again/);
assert.throws(()=>imageContexts([first]),/needs to be read/);

const progress=[],prepared=[];
const result=await prepareImages([ready,second],{onProgress:text=>progress.push(text),onPrepared:image=>prepared.push(image),fetcher:async(url,request)=>{calls.push({url,request});const image=JSON.parse(request.body);return reply(image)}});
assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/images/describe');assert.equal(JSON.parse(calls[0].request.body).id,second.id);
assert.equal(result[0],ready);assert.equal(result[1].dataUrl,second.dataUrl);assert.equal(result[1].visionModel,ready.visionModel);assert.equal(prepared.length,1);assert.equal(progress.length,1);assert.equal(second.context,undefined);

// A later failure exposes the error and preserves successful contexts via onPrepared.
const retained=[];
await assert.rejects(prepareImages([first,second],{onPrepared:image=>retained.push(image),fetcher:async(url,request)=>{const image=JSON.parse(request.body);return image.id===first.id?reply(image):Response.json({error:'The image reader is unavailable.'},{status:503})}}),/reader is unavailable/);
assert.equal(retained.length,1);assert.equal(retained[0].id,first.id);assert(retained[0].context);

// Cancellation cannot produce late contexts or continue to the next image.
const cancelled=new AbortController();cancelled.abort();
await assert.rejects(prepareImages([first],{signal:cancelled.signal,fetcher:()=>{throw Error('Unexpected request')}}),{name:'AbortError'});
const midflight=new AbortController();let notified=false;
await assert.rejects(prepareImages([first],{signal:midflight.signal,onPrepared:()=>{notified=true},fetcher:async()=>{midflight.abort();return reply(first)}}),{name:'AbortError'});
assert.equal(notified,false);
const between=new AbortController();let betweenCalls=0;
await assert.rejects(prepareImages([first,second],{signal:between.signal,onPrepared:()=>between.abort(),fetcher:async()=>{betweenCalls++;return reply(first)}}),{name:'AbortError'});
assert.equal(betweenCalls,1);

for(const data of [{id:'wrong',context:'Visible details',model:ready.visionModel},{id:first.id,context:'',model:ready.visionModel},{id:first.id,context:'x'.repeat(MAX_IMAGE_CONTEXT_LENGTH+1),model:ready.visionModel},{id:first.id,context:'visible',model:7}]){
 await assert.rejects(prepareImages([first],{fetcher:async()=>Response.json(data)}),/usable context/);
}
await assert.rejects(prepareImages([{...first,dataUrl:'https://example.com/image.png'}]),/Attach Screenshot.png again/);
await assert.rejects(prepareImages([first,first]),/up to three/);
await assert.rejects(prepareImages([first],{fetcher:async()=>new Response('<html>Error</html>')}),/invalid response/);

// Editing a user message retains image context; future answers after it are discarded.
const conversation=[{role:'user',content:'What is this?',images:[ready]},{role:'assistant',content:'An approval queue.'}];
const edited=editedConversation(conversation,0,'How many reviews are pending?');
assert.equal(edited.length,1);assert.equal(edited[0].content,'How many reviews are pending?');assert.deepEqual(edited[0].images,[ready]);
assert.equal(conversation.length,2);assert.equal(conversation[0].content,'What is this?');
console.log('Image attachments passed: context reuse, safe persistence, partial success, cancellation, invalid responses, and edit/resend preservation.');
