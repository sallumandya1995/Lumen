'use client';

import {forwardRef,useCallback,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {Columns2,FlaskConical,Info,MessageSquare,Plus,Square,X} from 'lucide-react';
import {prepareImages} from '../lib/image-attachments';
import {dispatchComparisonPrompt} from '../lib/chat-comparison';
import ChatPane from './chat-pane';
import Experiments,{type ExperimentHandle} from './experiments';
import type {ChatPaneHandle,ChatSnapshot,SharedChatPrompt} from './chat-comparison-types';

const MAX_CHAT_PANES=4;
type Pane={id:number;seed?:ChatSnapshot};
type Feedback={message:string;error?:boolean};
export type ChatWorkspaceHandle={reset:()=>void};
type Props={active:boolean;onBusyChange:(busy:boolean)=>void;onNavigate:(mode:'guided'|'governance')=>void};

const ChatWorkspace=forwardRef<ChatWorkspaceHandle,Props>(function ChatWorkspace({active,onBusyChange,onNavigate},ref){
 const [panes,setPanes]=useState<Pane[]>([{id:1}]);
 const [view,setView]=useState<'chat'|'experiments'>('chat');
 const experiment=useRef<ExperimentHandle>(null),experimentBusy=useRef(false);
 const [anyBusy,setAnyBusy]=useState(false),[preparing,setPreparing]=useState(false),[feedback,setFeedback]=useState<Feedback|null>(null);
 const panesRef=useRef(panes),handles=useRef(new Map<number,ChatPaneHandle>()),busy=useRef(new Map<number,boolean>());
 const callbacks=useRef(new Map<number,(handle:ChatPaneHandle|null)=>void>()),nextId=useRef(2),row=useRef<HTMLDivElement>(null),focusNext=useRef<number|null>(null);
 const mounted=useRef(true),prepareController=useRef<AbortController|null>(null),preparingRef=useRef(false),broadcastRunning=useRef(false),epoch=useRef(0);
 const reportBusy=useRef(onBusyChange),lastBusy=useRef(false);
 reportBusy.current=onBusyChange;

 const publishBusy=useCallback(()=>{
  const value=experimentBusy.current||preparingRef.current||panesRef.current.some(pane=>busy.current.get(pane.id));
  if(value===lastBusy.current)return;
  lastBusy.current=value;
  if(mounted.current)setAnyBusy(value);
  reportBusy.current(value);
 },[]);
 const reportExperimentBusy=useCallback((value:boolean)=>{experimentBusy.current=value;publishBusy()},[publishBusy]);
 const paneBusyChanged=useCallback((id:number,value:boolean)=>{
  if(!panesRef.current.some(pane=>pane.id===id))return;
  if(!!busy.current.get(id)===value)return;
  busy.current.set(id,value);publishBusy();
 },[publishBusy]);

 useEffect(()=>{mounted.current=true;return()=>{
  mounted.current=false;epoch.current++;prepareController.current?.abort();
  for(const handle of handles.current.values())handle.stop();
  if(lastBusy.current)reportBusy.current(false);
 }},[]);
 useEffect(()=>{
  if(focusNext.current===null)return;
  const id=focusNext.current;focusNext.current=null;
  const frame=requestAnimationFrame(()=>{
   handles.current.get(id)?.focus();
   const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
   row.current?.scrollTo({left:row.current.scrollWidth,behavior:reduced?'auto':'smooth'});
  });
  return()=>cancelAnimationFrame(frame);
 },[panes.length]);

 const addPane=useCallback((sourceId:number)=>{
  if(preparingRef.current||broadcastRunning.current||panesRef.current.some(pane=>busy.current.get(pane.id))||panesRef.current.length>=MAX_CHAT_PANES)return;
  const source=handles.current.get(sourceId);if(!source)return;
  const pane={id:nextId.current++,seed:structuredClone(source.snapshot())};
  const next=[...panesRef.current,pane];panesRef.current=next;focusNext.current=pane.id;
  setPanes(next);setFeedback({message:`Chat ${pane.id} starts with the same conversation and settings. Change its model or parameters to compare.`});
 },[]);
 const closePane=useCallback((id:number)=>{
  if(preparingRef.current||panesRef.current.length<=1)return;
  const remaining=panesRef.current.filter(pane=>pane.id!==id);
  if(remaining.length===panesRef.current.length)return;
  // Remove the identity before cancelling so a late completion cannot restore it.
  panesRef.current=remaining;handles.current.get(id)?.stop();handles.current.delete(id);busy.current.delete(id);callbacks.current.delete(id);
  setPanes(remaining);setFeedback(null);publishBusy();
 },[publishBusy]);

 const sendToAll=useCallback(async(sourceId:number,sourcePrompt:SharedChatPrompt)=>{
  if(broadcastRunning.current||preparingRef.current||panesRef.current.some(pane=>busy.current.get(pane.id)))return;
  const targets=panesRef.current.map(pane=>({id:pane.id,handle:handles.current.get(pane.id)}));
  if(targets.some(target=>!target.handle)){
   setFeedback({message:'A chat is still getting ready. Please try again.',error:true});return;
  }
  const prompt=structuredClone(sourcePrompt),source=handles.current.get(sourceId);
  for(const target of targets){
   const issue=target.handle!.validatePrompt(prompt);
   if(issue){target.handle!.showError(issue);setFeedback({message:`Chat ${target.id}: ${issue}`,error:true});return}
  }
  const job=++epoch.current,controller=new AbortController();
  prepareController.current=controller;broadcastRunning.current=true;preparingRef.current=true;setPreparing(true);publishBusy();
  setFeedback({message:prompt.images.length?'Reading the images once for all chats…':`Sending the same prompt to ${targets.length} chats…`});
  try{
   const images=await prepareImages(prompt.images,{signal:controller.signal,onProgress:message=>{if(mounted.current&&job===epoch.current)setFeedback({message})}});
   if(!mounted.current||controller.signal.aborted||job!==epoch.current)throw new DOMException('Cancelled','AbortError');
   const prepared={...prompt,images};
   // Recheck before dispatch: no chat should receive this round if a panel
   // became unavailable while an image was being read.
   const requests=dispatchComparisonPrompt(targets.map(target=>({id:target.id,handle:target.handle!})),sourceId,prepared);
   preparingRef.current=false;prepareController.current=null;setPreparing(false);publishBusy();
   setFeedback({message:`Prompt sent to ${targets.length} chats. Each response uses that chat’s model, settings, and conversation.`});
   const settled=await requests;
   if(mounted.current&&job===epoch.current&&settled.some(result=>result.status==='rejected'))setFeedback({message:'Some chats could not complete. Check their messages and retry them individually.',error:true});
  }catch(error){
   if(mounted.current&&job===epoch.current){
    const aborted=controller.signal.aborted||(error instanceof DOMException&&error.name==='AbortError');
    const message=aborted?'Sending to all stopped. Your draft is preserved.':error instanceof Error?error.message:'The prompt could not be sent to all chats. Your draft is preserved.';
    setFeedback({message,error:!aborted});if(!aborted)source?.showError(message);
   }
  }finally{
   if(job===epoch.current){
    broadcastRunning.current=false;preparingRef.current=false;prepareController.current=null;
    if(mounted.current)setPreparing(false);publishBusy();
   }
  }
 },[publishBusy]);

 const stopAll=useCallback(()=>{
  prepareController.current?.abort();for(const handle of handles.current.values())handle.stop();
 },[]);
 useImperativeHandle(ref,()=>({reset:()=>{
  if(experimentBusy.current)return;
  if(view==='experiments'){experiment.current?.reset();return}
  if(preparingRef.current||panesRef.current.some(pane=>busy.current.get(pane.id)))return;
  epoch.current++;broadcastRunning.current=false;setFeedback(null);
  for(const handle of handles.current.values())handle.reset();
  handles.current.get(panesRef.current[0].id)?.focus();
 }}),[view]);

 function paneRef(id:number){
  let callback=callbacks.current.get(id);
  if(!callback){callback=handle=>{if(handle)handles.current.set(id,handle);else handles.current.delete(id)};callbacks.current.set(id,callback)}
  return callback;
 }
 const comparing=panes.length>1,canAdd=panes.length<MAX_CHAT_PANES&&!anyBusy&&!preparing;
 return <section className={'chat-workspace'+(comparing?' is-comparing':'')} aria-label={comparing?'Chat comparison workspace':'Explainable chat workspace'} hidden={!active} style={!active?{display:'none'}:undefined}>
  <div className="chat-view-switch" role="group" aria-label="Explainable chat mode"><button type="button" aria-pressed={view==='chat'} disabled={anyBusy} onClick={()=>setView('chat')}><MessageSquare size={15}/> Conversations</button><button type="button" aria-pressed={view==='experiments'} disabled={anyBusy} onClick={()=>setView('experiments')}><FlaskConical size={15}/> Experiments</button><span>Observe, compare, and understand model responses.</span></div>
  <Experiments ref={experiment} active={active&&view==='experiments'} onBusyChange={reportExperimentBusy}/>
  <div className="chat-conversation-area" hidden={view!=='chat'}>
  {comparing&&<div className="chat-comparison-toolbar"><div><strong><Columns2 size={17}/> Compare responses</strong><p>Same prompt. Independent models and settings.</p></div><div className="chat-comparison-toolbar-actions"><span className="chat-comparison-count">{panes.length} chats</span>{anyBusy&&<button type="button" className="chat-compare-stop" onClick={stopAll}><Square size={13}/> Stop all</button>}<button type="button" className="chat-compare-add" disabled={!canAdd} onClick={()=>addPane(panesRef.current[panesRef.current.length-1].id)} aria-label="Add comparison chat" title={panes.length>=MAX_CHAT_PANES?'Up to four chats can be compared':'Add a chat to the right'}><Plus size={16}/><span>Add chat</span></button></div></div>}
  {comparing&&feedback&&<div className={'chat-comparison-feedback'+(feedback.error?' is-error':'')} role={feedback.error?'alert':'status'}><Info size={14}/><span>{feedback.message}</span><button type="button" onClick={()=>setFeedback(null)} aria-label="Dismiss comparison notice"><X size={13}/></button></div>}
  <div className="chat-pane-row" ref={row}>{panes.map(pane=><ChatPane key={pane.id} ref={paneRef(pane.id)} id={pane.id} seed={pane.seed} comparison={comparing} workspaceLocked={preparing} anyBusy={anyBusy} onBusyChange={paneBusyChanged} onAdd={addPane} onClose={comparing?()=>closePane(pane.id):undefined} canAdd={canAdd} onSendAll={comparing?sendToAll:undefined} onNavigate={onNavigate}/>)}</div>
  </div>
 </section>;
});

export default ChatWorkspace;
