import assert from 'node:assert/strict';
import {dispatchComparisonPrompt,validateComparisonPrompt} from '../lib/chat-comparison.ts';
import {parseSettings,settingsPayload} from '../lib/chat-settings.mjs';

const prompt={text:'Hi, who are you?',images:[{id:'shared-image',name:'Chart.png',context:'A chart of agent runs.',visionModel:'vision-model'}]};
const records=[],errors=[];
function target(id,settings,behavior=()=>Promise.resolve()){
 return {id,handle:{
  validatePrompt:()=>{try{parseSettings(settingsPayload(settings));return null}catch(error){return error.message}},
  showError:error=>errors.push({id,error}),
  sendPrompt:(received,options)=>{records.push({id,received,options,parameters:parseSettings(settingsPayload(settings))});return behavior(received)},
 }};
}

// Distinct settings survive broadcast, each panel owns its prompt, and only
// the originating composer is cleared. A failed panel does not skip others.
const left=target(1,{temperature:'0.2',top_p:'',max_tokens:'2048'},received=>{received.images[0].context='Changed in the first panel';return Promise.reject(new Error('First model unavailable'))});
const right=target(2,{temperature:'1',top_p:'0.95',max_tokens:'1024'});
const third=target(3,{temperature:'0.7',top_p:'',max_tokens:'512'});
const result=await dispatchComparisonPrompt([left,right,third],2,prompt);
assert.deepEqual(result.map(item=>item.status),['rejected','fulfilled','fulfilled']);
assert.equal(records.length,3);
assert.deepEqual(records.map(item=>item.options.clearComposer),[false,true,false]);
assert.deepEqual(records.map(item=>item.parameters.temperature),[0.2,1,0.7]);
assert.equal(records[1].received.images[0].context,prompt.images[0].context);
assert.equal(records[2].received.images[0].context,prompt.images[0].context);
assert.notEqual(records[0].received,records[1].received);
assert.equal(prompt.images[0].context,'A chart of agent runs.');

// An invalid later panel prevents every send; a changing configuration is
// checked again after asynchronous image preparation and before dispatch.
records.length=0;
const invalid=target(4,{temperature:'9'});
assert.throws(()=>dispatchComparisonPrompt([right,invalid],2,prompt),/Chat 4: Temp/);
assert.equal(records.length,0);
assert.equal(errors.at(-1).id,4);
const changingSettings={temperature:'0.7'};
const changing=target(5,changingSettings);
validateComparisonPrompt([right,changing],prompt);
changingSettings.temperature='9';
assert.throws(()=>dispatchComparisonPrompt([right,changing],2,prompt),/Chat 5: Temp/);
assert.equal(records.length,0);

// Synchronous cancellation/error from one adapter still dispatches siblings.
const throws=target(6,{temperature:'0.5'},()=>{throw new DOMException('Cancelled','AbortError')});
const cancelled=await dispatchComparisonPrompt([throws,right],6,prompt);
assert.equal(cancelled[0].status,'rejected');
assert.equal(cancelled[1].status,'fulfilled');
assert.deepEqual(records.map(item=>item.id),[6,2]);
console.log('Chat comparison passed: independent parameters and prompts, all-panel validation, source-only draft clearing, and isolated failures/cancellation.');
