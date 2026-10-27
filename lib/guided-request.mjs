import {DEFAULT_MODEL} from './models.mjs';

// Nemotron needs its reasoning block closed before the answer prefix. The
// other guided models accept the literal draft with thinking disabled.
export function guidedRequest(model,prompt,prefix=''){
 const nemotron=model===DEFAULT_MODEL;
 const messages=[{role:'user',content:prompt}];
 if(nemotron||prefix.length)messages.push({role:'assistant',content:(nemotron?'<think>\n\n</think>\n\n':'')+prefix});
 return {
  model,messages,max_tokens:1,logprobs:true,top_logprobs:20,stream:false,temperature:1,
  ...(messages.length>1?{continue_final_message:true,add_generation_prompt:false}:{}),
  ...(!nemotron?{reasoning_effort:'none'}:{})
 };
}
