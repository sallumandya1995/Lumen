// Match a complete, contiguous token sequence to the displayed answer.
// Nemotron may include reasoning and protocol markers in logprobs.content.
export function answerTokens(tokens,content,model){
 if(!Array.isArray(tokens))return [];
 let first=0;
 if(model.startsWith('nvidia/Nemotron')){
  const end=tokens.findLastIndex(t=>t.token==='</think>');
  if(end>=0)first=end+1;
 }
 for(let start=first;start<tokens.length;start++){
  let text=''; const decoder=new TextDecoder();
  for(let end=start;end<tokens.length;end++){
   const t=tokens[end];
   text+=Array.isArray(t.bytes)?decoder.decode(new Uint8Array(t.bytes),{stream:true}):t.token;
   if(text===content)return tokens.slice(start,end+1);
   if(!content.startsWith(text))break;
  }
 }
 return [];
}
