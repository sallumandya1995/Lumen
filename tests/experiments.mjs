import assert from 'node:assert/strict';
import {systemMessage,chatUsage} from '../lib/chat-experiment-request.mjs';
import {initialVariants,newVariant,snapshotVariant,experimentSnapshots,resultMetrics,runExperiment,tokenDifferences} from '../lib/experiments.ts';

assert.deepEqual(systemMessage(undefined),[]);
assert.deepEqual(systemMessage('  '),[]);
assert.deepEqual(systemMessage('Respond only in French.'),[{role:'system',content:'Respond only in French.'}]);
assert.throws(()=>systemMessage({role:'system'}),/system prompt/);
assert.throws(()=>systemMessage('x'.repeat(8001)),/system prompt/);
assert.deepEqual(chatUsage({prompt_tokens:12,completion_tokens:20}),{inputTokens:12,outputTokens:20,totalTokens:32});
assert.deepEqual(chatUsage({prompt_tokens:-1,completion_tokens:'10',total_tokens:NaN}),{inputTokens:null,outputTokens:null,totalTokens:null});

const variants=initialVariants();
assert(variants.every(variant=>variant.model==='nvidia/Nemotron-3-Ultra-550b-a55b'),'All new experiment variants default to NVIDIA');
assert.equal(new Set(variants.map(v=>v.id)).size,3);
const duplicate=newVariant(4,variants[0]);assert.notEqual(duplicate.id,variants[0].id);assert.equal(duplicate.systemPrompt,variants[0].systemPrompt);
const input=structuredClone(variants);input[0].inputRate='0.5';input[0].outputRate='1.5';
const frozen=experimentSnapshots('One shared prompt.',input);
assert.equal(frozen[0].parameters.temperature,.2);assert.equal(frozen[1].parameters.temperature,.8);
assert.notEqual(frozen[0].systemPrompt,frozen[1].systemPrompt);
input[0].temperature='1.5';assert.equal(frozen[0].parameters.temperature,.2);
assert.throws(()=>experimentSnapshots('   ',variants),/shared prompt/);
assert.throws(()=>experimentSnapshots('OK',[variants[0],variants[0]]),/distinct/);
assert.throws(()=>snapshotVariant({...variants[0],temperature:''}),/temperature/);
assert.throws(()=>snapshotVariant({...variants[0],topP:'1.1'}),/Top P/);
assert.throws(()=>snapshotVariant({...variants[0],maxTokens:'2.5'}),/Max tokens/);
assert.throws(()=>snapshotVariant({...variants[0],inputRate:'1',outputRate:''}),/pricing rates/);
assert.throws(()=>snapshotVariant({...variants[0],inputRate:'-1',outputRate:'2'}),/pricing rates/);
assert.throws(()=>snapshotVariant({...variants[0],model:'deepseek-ai/DeepSeek-V4-Pro'}),/supported chat/);

const response={content:'New Delhi',logprobs:[{token:'New',logprob:-.2},{token:' Delhi',logprob:-.4}],usage:{inputTokens:100,outputTokens:10,totalTokens:110}};
let active=0,maxActive=0;const calls=[],updates=[];
const six=[...frozen,...[4,5,6].map(i=>snapshotVariant(newVariant(i)))];
const results=await runExperiment('One shared prompt.',six,{signal:new AbortController().signal,onResult:(index,result)=>updates.push({index,result}),request:async args=>{
 active++;maxActive=Math.max(maxActive,active);calls.push(structuredClone(args));const callIndex=calls.length;
 await new Promise(resolve=>setTimeout(resolve,5));active--;
 if(callIndex===3)throw Error('Provider unavailable');
 args.messages[0].content='Mutated by a test adapter';args.parameters.temperature=99;
 return structuredClone(response);
}});
assert.equal(maxActive,3);assert.equal(calls.length,6);assert(calls.every(c=>c.messages[0].content==='One shared prompt.'));
assert.deepEqual(calls.slice(0,3).map(c=>c.systemPrompt),frozen.map(v=>v.systemPrompt));
assert.equal(results[2].status,'error');assert.equal(results.filter(r=>r.status==='success').length,5);
assert.equal(results[0].variant.parameters.temperature,.2);
assert.equal(updates.filter(u=>u.result.status==='running').length,6);
const metrics=resultMetrics(results[0]);assert(Math.abs(metrics.averageLogprob+.3)<1e-12);assert.equal(metrics.outputTokens,10);assert.equal(metrics.estimatedCostUsd,.000065);
assert.equal(resultMetrics({...results[0],usage:undefined}).estimatedCostUsd,null);
assert.equal(resultMetrics({...results[0],variant:{...results[0].variant,pricing:null}}).estimatedCostUsd,null);
assert.equal(resultMetrics({...results[0],logprobs:[{token:'bad',logprob:-9999}]}).averageLogprob,null);
assert.equal(resultMetrics({...results[0],logprobs:[]}).averageLogprob,null);

// Stop checks late provider results and cancels requests that never entered the pool.
const abort=new AbortController();let started=0;
const cancelled=await runExperiment('Stop me.',six,{signal:abort.signal,onResult:()=>{},request:async()=>{started++;abort.abort();return response}});
assert.equal(started,1);assert(cancelled.every(r=>r.status==='cancelled'));assert(cancelled.slice(1).every(r=>r.durationMs===undefined));

// Compare text across different tokenizers before highlighting provider boundaries.
assert.deepEqual(tokenDifferences('New Delhi','New Delhi',[{token:'N',logprob:0},{token:'ew Delhi',logprob:0}]).indices,[]);
let diff=tokenDifferences('The sky is blue.','The sky is red.',[{token:'The sky is ',logprob:0},{token:'red',logprob:-1},{token:'.',logprob:0}]);
assert.deepEqual(diff.indices,[1]);assert.equal(diff.removedText,'blue');assert.equal(diff.aligned,true);
diff=tokenDifferences('café','café noir',[{token:'café',logprob:0,bytes:[99,97,102,195,169]},{token:' noir',logprob:-1}]);assert.deepEqual(diff.indices,[1]);
diff=tokenDifferences('ABC','ADC',[]);assert.equal(diff.aligned,false);assert(diff.segments.some(s=>s.changed));
assert.equal(tokenDifferences('a '.repeat(1000),'b '.repeat(1000),[]).coarse,true);
console.log('Experiments passed: isolated variants/system prompts, bounded concurrency, independent failures, cancellation/late-result safety, provider usage, honest estimates, visible-token averages, and tokenizer-independent diffs.');
