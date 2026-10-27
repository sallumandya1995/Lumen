export const SETTING_FIELDS = [
 {key:'temperature',label:'Temp',min:0,max:2,step:0.05,hint:'Randomness: 0 focused, 2 more varied.'},
 {key:'top_p',label:'Top P',min:0,max:1,step:0.05,hint:'Sample from tokens within this cumulative probability.'},
 {key:'max_tokens',label:'Max tokens',min:1,max:8192,step:1,hint:'Output budget, including reasoning tokens.'},
 {key:'frequency_penalty',label:'Frequency penalty',min:-2,max:2,step:0.1,hint:'Positive values reduce repeated tokens.'},
 {key:'presence_penalty',label:'Presence penalty',min:-2,max:2,step:0.1,hint:'Positive values encourage new topics.'}
];
export const DEFAULT_SETTINGS={temperature:'',top_p:'',max_tokens:'2048',frequency_penalty:'',presence_penalty:''};
export function parseSettings(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid generation settings.');
 const result={max_tokens:2048};
 for(const field of SETTING_FIELDS){
  const value=input[field.key];
  if(value===undefined||value==='')continue;
  if(typeof value!=='number'||!Number.isFinite(value)||value<field.min||value>field.max||(field.key==='max_tokens'&&!Number.isInteger(value)))throw new Error(`${field.label} must be between ${field.min} and ${field.max}.`);
  result[field.key]=value;
 }
 return result;
}
export function settingsPayload(settings){return Object.fromEntries(Object.entries(settings).filter(([,v])=>v!=='').map(([k,v])=>[k,Number(v)]));}
export function editedConversation(messages,index,text){
 if(!Number.isInteger(index)||messages[index]?.role!=='user'||!text.trim())throw new Error('Choose a user message to edit.');
 return [...messages.slice(0,index),{role:'user',content:text.trim(),...(messages[index].images?.length?{images:messages[index].images}:{})}];
}
