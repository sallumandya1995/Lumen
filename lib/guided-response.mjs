const END_TOKENS = new Set(['<|im_end|>', '<|endoftext|>', '<｜end▁of▁sentence｜>', '</s>', '<|eot_id|>']);
const isProtocolToken = token => /^<\|.*\|>$|^<｜.*｜>$|^<\/?think>$/.test(token);

// A one-token request may sample a different token from the one selected in
// guided mode. Its finish_reason alone must never end a selectable draft.
export function normalizeGuidedResponse(data) {
  const choice = data?.choices?.[0];
  if (!choice || typeof choice !== 'object' || !choice.message || typeof choice.message !== 'object') {
    throw new Error('The provider returned an incomplete next-token response. Retry this step.');
  }
  const content = choice.message.content;
  const tokens = choice.logprobs?.content;
  if ((content != null && typeof content !== 'string') || (tokens != null && !Array.isArray(tokens))) {
    throw new Error('The provider returned invalid next-token data. Retry this step.');
  }
  const top = tokens?.[0]?.top_logprobs;
  if (top != null && !Array.isArray(top)) {
    throw new Error('The provider returned invalid token alternatives. Retry this step.');
  }
  const alternatives = (top || [])
    .filter(t => t && typeof t.token === 'string' && t.token.length > 0 && Number.isFinite(t.logprob) && t.logprob <= 0)
    .map(t => ({
      token: t.token,
      logprob: t.logprob,
      ...(Array.isArray(t.bytes) && t.bytes.every(b => Number.isInteger(b) && b >= 0 && b <= 255) ? {bytes: t.bytes} : {}),
      end: END_TOKENS.has(t.token),
      control: isProtocolToken(t.token) && !END_TOKENS.has(t.token),
    }))
    .sort((a, b) => b.logprob - a.logprob)
    .slice(0, 20);
  if (alternatives.length) return {alternatives, completed: false};

  // Providers can omit EOS from logprobs entirely. Accept a clean, empty stop,
  // but preserve errors for missing metadata, malformed alternatives, length
  // limits, filtered output, or a real text token without its alternatives.
  const noGeneratedText = content == null || content === '';
  const noTextTokens = !tokens?.length || tokens.every(t => t && END_TOKENS.has(t.token));
  if (choice.finish_reason === 'stop' && noGeneratedText && noTextTokens && !top?.length) {
    return {alternatives: [], completed: true};
  }
  if (choice.finish_reason === 'content_filter') {
    throw new Error('The provider stopped this continuation because of a content filter. Your draft is preserved.');
  }
  throw new Error('This model did not return usable next-token alternatives for this prefix. Retry or add your own text.');
}
