import type {ChatPaneHandle,SharedChatPrompt} from '../app/chat-comparison-types';

type ComparisonTarget={id:number;handle:Pick<ChatPaneHandle,'validatePrompt'|'sendPrompt'|'showError'>};

/** Validate the whole round before any panel commits a new user message. */
export function validateComparisonPrompt(targets:ComparisonTarget[],prompt:SharedChatPrompt){
 for(const target of targets){
  const issue=target.handle.validatePrompt(prompt);
  if(issue){target.handle.showError(issue);throw new Error(`Chat ${target.id}: ${issue}`)}
 }
}

/** Each request owns its prompt, cancellation, settings, and failure. */
export function dispatchComparisonPrompt(targets:ComparisonTarget[],sourceId:number,prompt:SharedChatPrompt){
 validateComparisonPrompt(targets,prompt);
 const requests=targets.map(target=>{
  try{return Promise.resolve(target.handle.sendPrompt(structuredClone(prompt),{clearComposer:target.id===sourceId}))}
  catch(error){return Promise.reject(error)}
 });
 return Promise.allSettled(requests);
}
