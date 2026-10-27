// Parse SSE incrementally: network chunks need not align with events or UTF-8 characters.
export async function consumeCompletion(body, onToken, onLogprobs = () => {}) {
 const reader = body.getReader();
 const decoder = new TextDecoder();
 let buffer = '', completed = false;
 function event(block) {
  const payload = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
  if (!payload) return;
  if (payload.trim() === '[DONE]') { completed = true; return; }
  const data = JSON.parse(payload);
  if (data.error) throw new Error('The model interrupted the response. Please try again.');
  const scores = data.choices?.[0]?.logprobs?.content;
  if (Array.isArray(scores) && scores.length) onLogprobs(scores);
  const content = data.choices?.[0]?.delta?.content;
  if (typeof content === 'string' && content) onToken(content);
 }
 try {
  while (!completed) {
   const {value, done} = await reader.read();
   buffer += done ? decoder.decode() : decoder.decode(value, {stream:true});
   let boundary;
   while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
    const block = buffer.slice(0, boundary.index);
    buffer = buffer.slice(boundary.index + boundary[0].length);
    event(block);
    if (completed) break;
   }
   if (done) {
    if (buffer.trim() && !completed) event(buffer);
    if (!completed) throw new Error('The connection ended before the response finished. Your partial answer was saved.');
    break;
   }
  }
 } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}
