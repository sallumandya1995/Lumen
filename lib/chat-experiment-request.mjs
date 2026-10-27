/** A separate system field keeps ordinary chat message roles unchanged. */
export function systemMessage(value){
 if(value===undefined||value==='')return [];
 if(typeof value!=='string'||value.length>8000)throw new Error('Keep the system prompt below 8,000 characters.');
 return value.trim()?[{role:'system',content:value}]:[];
}
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
export function chatUsage(value){
 const inputTokens=count(value?.prompt_tokens),outputTokens=count(value?.completion_tokens);
 return {inputTokens,outputTokens,totalTokens:count(value?.total_tokens)??(inputTokens!==null&&outputTokens!==null?inputTokens+outputTokens:null)};
}
