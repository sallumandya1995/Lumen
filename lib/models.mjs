export const DEFAULT_MODEL = 'nvidia/Nemotron-3-Ultra-550b-a55b';
export const DEFAULT_VISION_MODEL = 'nvidia/Nemotron-3.5-Super-VL';
export const DEFAULT_VISION_BASE_URL = 'https://api.tokenfactory.nebius.com/v1/';
// One source of truth for new sessions. Saved user selections remain explicit.
export const FEATURE_DEFAULT_MODELS = Object.freeze({
 chat:DEFAULT_MODEL, guided:DEFAULT_MODEL, experiments:DEFAULT_MODEL,
 agentStudio:DEFAULT_MODEL, nodeTests:DEFAULT_MODEL, policyEvaluation:DEFAULT_MODEL,
 governanceAssistant:DEFAULT_MODEL, imageContext:DEFAULT_VISION_MODEL,
});
export const MODELS = {
 'nvidia/Nemotron-3-Ultra-550b-a55b': {label:'Nemotron 3 Ultra',runtime:'cloud',chat:true,guided:true,baseUrl:'https://api.tokenfactory.us-central1.nebius.com/v1/'},
 'deepseek-ai/DeepSeek-V4.1-Flash': {label:'DeepSeek V4.1 Flash',runtime:'cloud',chat:true,guided:false,baseUrl:'https://api.tokenfactory.us-north1.nebius.com/v1/'},
 'deepseek-ai/DeepSeek-V4-Pro': {label:'DeepSeek V4 Pro',runtime:'cloud',chat:false,guided:true,baseUrl:'https://api.tokenfactory.nebius.com/v1/'},
 'Qwen/Qwen3-235B-A22B-Instruct-2507': {label:'Qwen3 235B Instruct',runtime:'cloud',chat:false,guided:true,baseUrl:'https://api.tokenfactory.us-central1.nebius.com/v1/'}
};
export function modelConfig(model=DEFAULT_MODEL){return Object.prototype.hasOwnProperty.call(MODELS,model)?MODELS[model]:null;}
export const DEFAULT_AGENT_BASE_URL='https://api.tokenfactory.us-central1.nebius.com/v1/';
export const NEBIUS_ENDPOINTS=[
 {label:'US Central',baseUrl:DEFAULT_AGENT_BASE_URL},
 {label:'US North',baseUrl:'https://api.tokenfactory.us-north1.nebius.com/v1/'},
 {label:'Global',baseUrl:'https://api.tokenfactory.nebius.com/v1/'}
];
/** Only these Nebius origins may receive the shared server credential. */
export function normalizeNebiusBaseUrl(value){
 if(typeof value!=='string')return '';
 const canonical=value.trim().replace(/\/+$/,'')+'/';
 return NEBIUS_ENDPOINTS.some(endpoint=>endpoint.baseUrl===canonical)?canonical:'';
}
export function agentBaseUrl(model){
 return normalizeNebiusBaseUrl(model?.baseUrl===undefined?(modelConfig(model?.name)?.baseUrl||DEFAULT_AGENT_BASE_URL):model.baseUrl);
}
export function validAgentModelId(value){
 return typeof value==='string'&&!value.includes('://')&&/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value);
}
export function modelUnavailableReason(model,{remoteAvailable=true}={}){
 const config=modelConfig(model);
 if(!config)return 'Unsupported model';
 if(!remoteAvailable)return 'Nebius API is not configured';
 return '';
}
export function restoreGuidedModel(model,config={}){
 return typeof model==='string'&&modelConfig(model)?.guided&&!modelUnavailableReason(model,config)?model:DEFAULT_MODEL;
}
