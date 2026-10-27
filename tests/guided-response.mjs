import assert from 'node:assert/strict';
import {normalizeGuidedResponse} from '../lib/guided-response.mjs';

const response = (content, finish_reason, tokens) => ({choices: [{message: {content}, finish_reason, logprobs: {content: tokens}}]});
const candidates = [{token: ' Delhi', logprob: -0.1, bytes: [32, 68]}, {token: ' Mumbai', logprob: -4}, {token: '<|im_end|>', logprob: -2}, {token: '<think>', logprob: -3}];

for (const content of ['', null]) {
  for (const tokens of [[], null, undefined, [{token: '<|im_end|>', top_logprobs: []}]]) {
    assert.deepEqual(normalizeGuidedResponse(response(content, 'stop', tokens)), {alternatives: [], completed: true});
  }
}

// The sampled EOS/stop does not end the draft if alternatives remain: the UI
// chooses the highest-probability candidate, independently of the sample.
const usable = normalizeGuidedResponse(response('', 'stop', [{token: '<|im_end|>', top_logprobs: candidates}]));
assert.equal(usable.completed, false);
assert.deepEqual(usable.alternatives.map(t => t.token), [' Delhi', '<|im_end|>', '<think>', ' Mumbai']);
assert.equal(usable.alternatives[1].end, true);
assert.equal(usable.alternatives[1].control, false);
assert.equal(usable.alternatives[2].control, true);
assert.deepEqual(usable.alternatives[0].bytes, [32, 68]);

for (const data of [
  {}, {choices: []}, {choices: [{finish_reason: 'stop'}]},
  response('', 'length', []), response('', null, []),
  response(' Delhi', 'stop', []), response(' ', 'stop', []),
  response('', 'stop', [{token: ' Delhi', top_logprobs: []}]),
  response('', 'stop', [{token: '<|im_end|>', top_logprobs: [{token: 'x', logprob: NaN}]}]),
  response('', 'stop', [{token: '<|im_end|>', top_logprobs: {}}]),
  response('', 'stop', 'malformed'),
]) assert.throws(() => normalizeGuidedResponse(data));
assert.throws(() => normalizeGuidedResponse(response('', 'content_filter', [])), /content filter/);

const cleaned = normalizeGuidedResponse(response('x', 'length', [{token: 'x', top_logprobs: [
  ...candidates, {token: '', logprob: 0}, {token: 'bad', logprob: Infinity}, {token: 'bad', logprob: '0'}, {token: 'bad', logprob: 0.1}, null,
]}]));
assert.equal(cleaned.alternatives.length, 4);
const many = normalizeGuidedResponse(response('x', 'length', [{token: 'x', top_logprobs: Array.from({length: 30}, (_, i) => ({token: String(i), logprob: -i}))}]));
assert.equal(many.alternatives.length, 20);
console.log('Guided response checks passed: EOS, empty provider stop, sampled stop, malformed responses, and candidate sorting.');
