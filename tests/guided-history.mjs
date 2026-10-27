import assert from 'node:assert/strict';
import {customSelection,modelSelection,restoreGuidedHistory} from '../lib/guided-history.ts';

const token=(text,logprob=-.2,extra={})=>({token:text,logprob,end:false,control:false,...extra});
const model='nvidia/Nemotron-3-Ultra-550b-a55b';
const custom=' bangalore.\n\nI added this sentence.\t🙂';
assert.deepEqual(customSelection(custom),{source:'custom',text:custom});

// Snapshot the distribution without normalizing, rounding, or mutating it.
const selected=token(' Delhi',-.8,{bytes:[32,68,101,108,104,105]});
const alternatives=[selected,token(' Mumbai',-3),token(' New Delhi',-.1),token('invalid',Infinity),token('',-.2)];
const selection=modelSelection(selected,alternatives,model);
assert.equal(selection.source,'model');assert.equal(selection.text,' Delhi');assert.equal(selection.logprob,-.8);assert.equal(selection.model,model);
assert.deepEqual(selection.alternatives.map(t=>t.token),[' New Delhi',' Delhi',' Mumbai']);
assert.equal(alternatives[0],selected);assert.equal(alternatives[0].token,' Delhi');
selected.bytes[0]=99;assert.equal(selection.alternatives[1].bytes[0],32);
alternatives[1].logprob=-100;assert.equal(selection.alternatives[2].logprob,-3);
assert.equal(modelSelection(token('made up',-.1),[token('other',-.1)],model).source,'legacy');
for(const invalid of [NaN,Infinity,-Infinity,.1,undefined])assert.deepEqual(modelSelection({...token('word'),logprob:invalid},[{...token('word'),logprob:invalid}],model),{source:'legacy',text:'word'});
assert.equal(modelSelection(token('<|im_end|>',0,{end:true}),[token('<|im_end|>',0,{end:true})],model).source,'legacy');
assert.equal(modelSelection(token('<think>',0),[token('<think>',0)],model).source,'legacy');
assert.equal(modelSelection(token('word',-.2),[token('word',-.2,{control:true})],model).source,'legacy');
assert.equal(modelSelection(token('word',-.2),[token('word',-.2,{end:true})],model).source,'legacy');

// Only the top twenty valid candidates are retained, highest probability first.
const many=Array.from({length:25},(_,i)=>token(`t${i}`,-i));
const capped=modelSelection(many[0],many,model);assert.equal(capped.alternatives.length,20);assert.equal(capped.alternatives[19].token,'t19');

const old=restoreGuidedHistory({version:1,steps:['The',' capital',' of',' India']});
assert.deepEqual(old.steps,['The','The capital','The capital of','The capital of India']);
assert.deepEqual(old.selections.map(s=>s.text),['The',' capital',' of',' India']);assert(old.selections.every(s=>s.source==='legacy'&&s.logprob===undefined));
const v4=restoreGuidedHistory({version:4,steps:['New','New Delhi'],selections:[customSelection('New'),customSelection(' Delhi')]});
assert.deepEqual(v4.steps,['New','New Delhi']);assert(v4.selections.every(s=>s.source==='legacy'));

const first=modelSelection(token('The',-.1),[token('The',-.1),token('A',-2)],model);
const tail=modelSelection(token(' correction',-.6),[token(' correction',-.6),token(' answer',-2)],model);
const pieces=[first,customSelection(custom),tail],snapshots=pieces.map((_,i)=>pieces.slice(0,i+1).map(p=>p.text).join(''));
const roundTrip=restoreGuidedHistory(JSON.parse(JSON.stringify({version:5,steps:snapshots,selections:pieces})));
assert.deepEqual(roundTrip,{steps:snapshots,selections:pieces});
assert.equal(roundTrip.selections.map(s=>s.text).join(''),snapshots.at(-1));

// Invalid metadata never discards draft text or borrows probability from a neighbor.
const wrong=restoreGuidedHistory({version:5,steps:['The','The capital','The capital city'],selections:[first,{...first,text:' capital'},tail]});
assert.equal(wrong.selections[0].source,'model');assert.deepEqual(wrong.selections.slice(1),[{source:'legacy',text:' capital'},{source:'legacy',text:' city'}]);
const badMetadata=[
 {source:'unknown',text:'The',logprob:-.1,alternatives:[token('The',-.1)]},
 {source:'model',text:'The',alternatives:[token('The',-.1)]},
 {source:'model',text:'The',logprob:-.1,alternatives:[]},
 {source:'model',text:'The',logprob:-.1,alternatives:[token('The',-.2)]},
 {source:'model',text:'The',logprob:-.1,alternatives:[token('The',-.1)],model:22},
 null,
];
for(const metadata of badMetadata){const restored=restoreGuidedHistory({version:5,steps:['The'],selections:[metadata]});assert.deepEqual(restored.selections,[{source:'legacy',text:'The'}]);assert.deepEqual(restored.steps,['The'])}
assert.deepEqual(restoreGuidedHistory({version:5,steps:['The'],selections:{0:first}}).selections,[{source:'legacy',text:'The'}]);
assert.deepEqual(restoreGuidedHistory({version:5,steps:['mine'],selections:[{source:'custom',text:'mine',logprob:0,alternatives:[token('mine',0)]}]}).selections,[{source:'custom',text:'mine'}]);

// Duplicated snapshots are skipped, but metadata keeps its original source index.
const duplicate=restoreGuidedHistory({version:5,steps:['The','The','The capital'],selections:[first,{source:'custom',text:'ignored'},customSelection(' capital')]});
assert.deepEqual(duplicate.steps,['The','The capital']);assert.deepEqual(duplicate.selections,[first,customSelection(' capital')]);
assert.deepEqual(restoreGuidedHistory({version:4,steps:['one','oops','oops more']}).steps,['one']);
assert.deepEqual(restoreGuidedHistory({version:4,steps:['one',null,'one more']}).steps,['one']);
assert.deepEqual(restoreGuidedHistory({version:4,steps:['one','one more']},4).steps,['one']);
assert.deepEqual(restoreGuidedHistory({version:4,steps:['one']},0),{steps:[],selections:[]});
assert.deepEqual(restoreGuidedHistory(null),{steps:[],selections:[]});
console.log('Guided history passed: exact text, manual provenance, real distributions, legacy migration, corrupt metadata, clone safety, and snapshot alignment.');
