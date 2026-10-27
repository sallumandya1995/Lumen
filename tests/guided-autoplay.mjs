import assert from 'node:assert/strict';
import {readGuideResult,playGuidedTokens} from '../lib/guided-autoplay.ts';

const token=(text,lp=-.1,extra={})=>({token:text,logprob:lp,end:false,control:false,...extra});
const result=(...alternatives)=>({alternatives});
const eos=token('<|im_end|>',0,{end:true});
const snapshots=[],prefixes=[],distributions=[];
const responses=[result(token(' wrong',-3),token(' Delhi',-.02)),result(eos,token('.',-8))];
const end=await playGuidedTokens({steps:[],initial:result(token('The',-3),token('New',-.01)),signal:new AbortController().signal,limit:16000,
 request:async prefix=>{prefixes.push(prefix);return responses.shift()},onChoices:choices=>assert(choices[0].logprob>=choices.at(-1).logprob),onSelection:(steps,choice,_ids,candidates)=>{snapshots.push(steps);distributions.push({choice,candidates})}});
assert.equal(end,'end');assert.deepEqual(prefixes,['New','New Delhi']);assert.deepEqual(snapshots,[['New'],['New','New Delhi']]);
assert.deepEqual(distributions.map(d=>({token:d.choice.token,logprob:d.choice.logprob,alternatives:d.candidates.map(t=>t.token)})),[{token:'New',logprob:-.01,alternatives:['New','The']},{token:' Delhi',logprob:-.02,alternatives:[' Delhi',' wrong']}]);

// End markers are never appended; a provider's empty stop also ends cleanly.
let requests=0,selections=0;
assert.equal(await playGuidedTokens({steps:['Done.'],initial:result(eos),signal:new AbortController().signal,limit:100,request:async()=>{requests++;return result()},onChoices:()=>{},onSelection:()=>selections++}),'end');
assert.equal(requests,0);assert.equal(selections,0);
assert.equal(await playGuidedTokens({steps:['Done.'],signal:new AbortController().signal,limit:100,request:async()=>({alternatives:[],completed:true}),onChoices:()=>{},onSelection:()=>selections++}),'end');
assert.equal(selections,0);

// Stop during an in-flight request ignores a late success, even for a transport
// that doesn't honor AbortSignal. Reset and tab-unmount use the same cancellation.
const controller=new AbortController();let resolveRequest;
const lateRequest=new Promise(resolve=>{resolveRequest=resolve});const kept=[];
const pending=playGuidedTokens({steps:['A'],initial:result(token(' B')),signal:controller.signal,limit:100,request:()=>lateRequest,onChoices:()=>{},onSelection:steps=>kept.push(steps)});
controller.abort();resolveRequest(result(token(' stale')));
await assert.rejects(pending,{name:'AbortError'});assert.deepEqual(kept,[['A','A B']]);
let requested='';
assert.equal(await playGuidedTokens({steps:kept[0],signal:new AbortController().signal,limit:100,request:async prefix=>{requested=prefix;return result(eos)},onChoices:()=>{},onSelection:()=>assert.fail('must not duplicate a saved token')}),'end');
assert.equal(requested,'A B');

// Protocol and empty alternatives are ineligible, not invisible empty-loop steps.
const usable=[];let receivedIds;
assert.equal(await playGuidedTokens({steps:[],initial:{alternatives:[token('<think>',0,{control:true}),token('',-.01),token('hello',-.1,{id:42})],prefixTokenIds:[1,2]},signal:new AbortController().signal,limit:100,
 request:async(_prefix,ids)=>{receivedIds=ids;return result(eos)},onChoices:()=>{},onSelection:steps=>usable.push(steps)}),'end');
assert.deepEqual(usable,[['hello']]);assert.deepEqual(receivedIds,[1,2,42]);
await assert.rejects(()=>playGuidedTokens({steps:[],initial:result(token('',0),token('<think>',-.1,{control:true})),signal:new AbortController().signal,limit:100,request:async()=>assert.fail('must stop without another request'),onChoices:()=>{},onSelection:()=>assert.fail('no selectable token')}),/No selectable/);

// Do not clip the top token or substitute a lower-ranked shorter one at the cap.
assert.equal(await playGuidedTokens({steps:['1234'],initial:result(token('56',0),token('x',-9)),signal:new AbortController().signal,limit:5,request:async()=>assert.fail('no request at cap'),onChoices:()=>{},onSelection:()=>assert.fail('no partial token')}),'limit');
assert.equal(await playGuidedTokens({steps:['12345'],signal:new AbortController().signal,limit:5,request:async()=>assert.fail('full draft must not request'),onChoices:()=>{},onSelection:()=>assert.fail('no overflow')}),'limit');

// Errors propagate once with the last successful draft retained; no retry loop.
let failedRequests=0;const beforeFailure=[];
await assert.rejects(()=>playGuidedTokens({steps:[],initial:result(token('saved')),signal:new AbortController().signal,limit:100,request:async()=>{failedRequests++;throw new Error('provider unavailable')},onChoices:()=>{},onSelection:steps=>beforeFailure.push(steps)}),/provider unavailable/);
assert.equal(failedRequests,1);assert.deepEqual(beforeFailure,[['saved']]);
const stopped=new AbortController();stopped.abort();
await assert.rejects(()=>playGuidedTokens({steps:[],signal:stopped.signal,limit:100,request:async()=>assert.fail('cancel before first request'),onChoices:()=>{},onSelection:()=>{}}),{name:'AbortError'});
assert.throws(()=>readGuideResult({alternatives:[]}),/no usable alternatives/);
assert.deepEqual(readGuideResult({alternatives:[],completed:true}).alternatives,[]);
assert.equal(readGuideResult(result(token('x',NaN),token('y',Infinity),token('z',.2),token('ok',-.3))).alternatives[0].token,'ok');
console.log('Guided playback passed: serial top-token selection, EOS/provider completion, stop/reset cancellation, resume, IDs, protocol tokens, draft limit, and errors.');
