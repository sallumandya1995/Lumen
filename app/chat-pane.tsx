'use client';
import {CreatorCard} from './about-lumen';
import {forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {Plus,ArrowUp,Sparkles,ScanSearch,MousePointer2,GraduationCap,FlaskConical,PenLine,ArrowUpRight,Copy,Check,RotateCcw,ArrowDown,ShieldCheck,Clock3,Info,Square,X,Keyboard,SendHorizontal} from 'lucide-react';
import {DEFAULT_MODEL,MODELS,modelConfig,modelUnavailableReason} from '../lib/models.mjs';
import {runInference,getRuntimeConfig} from '../lib/inference';
import {prepareImages,imageContexts} from '../lib/image-attachments';
import {DEFAULT_SETTINGS,settingsPayload,parseSettings,editedConversation} from '../lib/chat-settings.mjs';
import {ImageAttachments,ImageAttachButton,useImageAttachments} from './image-attachments';
import GenerationSettings from './generation-settings';
import TokenProbabilities,{type TokenProbability} from './token-probabilities';
import type {ChatMessage,ChatPaneHandle,ChatPaneProps,SharedChatPrompt} from './chat-comparison-types';

const suggestions=[{title:'Explore a simple answer',text:'What is the capital of India? Answer in one short sentence.'},{title:'Compare possible wording',text:'Describe the ocean at sunrise in one vivid sentence.'},{title:'Explain something clearly',text:'Explain how a rainbow forms in two short sentences.'}];
function clone<T,>(value:T):T{return structuredClone(value)}
function parameterTitle(parameters:Record<string,number>){return Object.entries(parameters).map(([key,value])=>key+': '+value).join(' · ')}

const ChatPane=forwardRef<ChatPaneHandle,ChatPaneProps>(function ChatPane({id,seed,comparison,workspaceLocked,anyBusy,onBusyChange,onAdd,onClose,canAdd,onSendAll,onNavigate},ref){
 const [initial]=useState(()=>seed?clone(seed):null);
 const [settings,setSettings]=useState<Record<string,string>>(()=>initial?.settings||{...DEFAULT_SETTINGS});
 const [model,setModel]=useState(()=>initial?.model||DEFAULT_MODEL);
 const [messages,setMessageState]=useState<ChatMessage[]>(()=>initial?.messages||[]);
 const [input,setInput]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[warning,setWarning]=useState(''),[notice,setNotice]=useState(''),[copied,setCopied]=useState(-1);
 const [editing,setEditing]=useState<number|null>(null),[editText,setEditText]=useState(''),[progress,setProgress]=useState('');
 const [remoteAvailable,setRemoteAvailable]=useState(true),[runtimeReady,setRuntimeReady]=useState(false);
 const [retryContext,setRetryContext]=useState<ChatMessage[]|null>(null),[awayFromEnd,setAwayFromEnd]=useState(false);
 const composerInput=useRef<HTMLTextAreaElement>(null),contentArea=useRef<HTMLElement>(null),end=useRef<HTMLDivElement>(null),cancel=useRef<AbortController|null>(null),busyRef=useRef(false),followResponse=useRef(true),mounted=useRef(true),copyTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const messagesRef=useRef(messages),callbacks=useRef({onBusyChange});callbacks.current={onBusyChange};messagesRef.current=messages;
 const attachments=useImageAttachments({disabled:busy||workspaceLocked});
 const latest=useRef({settings,model,runtimeReady,remoteAvailable,workspaceLocked,processing:attachments.processing});latest.current={settings,model,runtimeReady,remoteAvailable,workspaceLocked,processing:attachments.processing};
 const modelLabel=modelConfig(model)?.label||model;
 const helpId='chat-composer-help-'+id;
 function setMessages(value:ChatMessage[]){messagesRef.current=value;if(mounted.current)setMessageState(value)}
 function setRunning(value:boolean){busyRef.current=value;if(mounted.current){setBusy(value);callbacks.current.onBusyChange(id,value)}}
 useEffect(()=>{
  mounted.current=true;
  getRuntimeConfig().then(c=>{if(mounted.current){setRemoteAvailable(c.remoteAvailable!==false);setRuntimeReady(true)}});
  return()=>{mounted.current=false;cancel.current?.abort();if(copyTimer.current)clearTimeout(copyTimer.current);callbacks.current.onBusyChange(id,false)};
 },[id]);
 useEffect(()=>{const el=contentArea.current;if(el&&followResponse.current)el.scrollTo({top:el.scrollHeight,behavior:'smooth'})},[messages.length,messages[messages.length-1]?.content,busy]);
 useEffect(()=>{const el=composerInput.current;if(el){el.style.height='auto';el.style.height=String(Math.min(160,Math.max(58,el.scrollHeight)))+'px'}},[input,comparison]);
 function validatePrompt(prompt:SharedChatPrompt):string|null{
  const current=latest.current;
  if(busyRef.current)return 'This chat is still generating. Stop it or wait before sending another prompt.';
  if(!current.runtimeReady)return 'This chat is still preparing. Try again in a moment.';
  if(current.processing)return 'Wait for the attached image to finish preparing.';
  const unavailable=modelUnavailableReason(current.model,{remoteAvailable:current.remoteAvailable});if(unavailable)return unavailable;
  if(typeof prompt?.text!=='string'||prompt.text.length>16000)return 'Keep your message below 16,000 characters.';
  if(!Array.isArray(prompt.images)||prompt.images.length>3)return 'Attach up to three images.';
  if(prompt.images.some(image=>!image||typeof image.id!=='string'||!image.id||image.id.length>100||typeof image.name!=='string'||!image.name||image.name.length>200)||new Set(prompt.images.map(image=>image.id)).size!==prompt.images.length)return 'Attach images with valid, unique names and identifiers.';
  if(!prompt.text.trim()&&!prompt.images.length)return 'Enter a message or attach an image.';
  if(messagesRef.current.length+1>60)return 'This conversation has reached the request limit. Start a new conversation to continue.';
  try{parseSettings(settingsPayload(current.settings))}catch(e:any){return e.message||'Check your generation settings.'}
  return null;
 }
 function reset(){
  if(busyRef.current)return;
  attachments.clear();setModel(DEFAULT_MODEL);setMessages([]);setInput('');setError('');setWarning('');setNotice('');setRetryContext(null);setCopied(-1);setEditing(null);setEditText('');setProgress('');setAwayFromEnd(false);followResponse.current=true;
  if(copyTimer.current)clearTimeout(copyTimer.current);
 }
 function focusPrompt(text:string){setInput(text);composerInput.current?.focus({preventScroll:true})}
 async function copyMessage(text:string,index:number){
  try{await navigator.clipboard.writeText(text);if(!mounted.current)return;setCopied(index);if(copyTimer.current)clearTimeout(copyTimer.current);copyTimer.current=setTimeout(()=>{if(mounted.current)setCopied(-1)},1800)}
  catch{if(mounted.current)setError('Copy is unavailable in this browser. You can select and copy the message text.')}
 }
 async function generate(next:ChatMessage[],clearComposer=false){
  const current=latest.current;
  if(!current.runtimeReady||busyRef.current||!mounted.current)return;
  let parameters:Record<string,number>;
  try{parameters=parseSettings(settingsPayload(current.settings))}catch(e:any){setError(e.message);return}
  if(next.length>60){setError('This conversation has reached the request limit. Start a new conversation to continue.');return}
  setRunning(true);setMessages(next);if(clearComposer){setInput('');attachments.clear()}
  setEditing(null);setEditText('');setCopied(-1);setError('');setWarning('');setNotice('');setRetryContext(null);followResponse.current=true;setAwayFromEnd(false);
  const controller=new AbortController();cancel.current=controller;const requestModel=current.model,startedAt=performance.now();
  let preparedNext=next;
  const onProgress=(text:string)=>{if(mounted.current&&!controller.signal.aborted)setProgress(text)};
  try{
   for(let i=0;i<preparedNext.length;i++){
    const message=preparedNext[i];if(message.role!=='user'||!message.images?.length)continue;
    const images=await prepareImages(message.images,{signal:controller.signal,onProgress,onPrepared:image=>{
     if(!mounted.current||controller.signal.aborted)return;
     preparedNext=preparedNext.map((m,j)=>j===i?{...m,images:m.images?.map(existing=>existing.id===image.id?image:existing)}:m);
     setMessages(preparedNext);
    }});
    if(controller.signal.aborted||!mounted.current)throw new DOMException('Cancelled','AbortError');
    preparedNext=preparedNext.map((m,j)=>j===i?{...m,images}:m);
   }
   if(controller.signal.aborted||!mounted.current)throw new DOMException('Cancelled','AbortError');
   setMessages(preparedNext);
   const data:any=await runInference({mode:'chat',model:requestModel,parameters,messages:preparedNext.map(({role,content,images})=>({role,content,...(images?.length?{images:imageContexts(images)}:{})}))},{signal:controller.signal,onProgress});
   if(controller.signal.aborted||!mounted.current)throw new DOMException('Cancelled','AbortError');
   const content=typeof data.content==='string'?data.content:'',logprobs:TokenProbability[]=Array.isArray(data.logprobs)?data.logprobs:[];
   if(!content)throw Error('The model returned an empty response. Please try again.');
   setMessages([...preparedNext,{role:'assistant',content,logprobs,model:requestModel,parameters:{...parameters},durationMs:performance.now()-startedAt}]);
   if(data.warning)setWarning(data.warning);
  }catch(e:any){
   if(!mounted.current)return;
   setRetryContext(preparedNext);if(e.name==='AbortError')setNotice('Generation stopped. Your message is ready to retry.');else setError(e.message||'The request could not be completed. Try again.');
  }finally{
   if(cancel.current===controller)cancel.current=null;
   if(mounted.current){setRunning(false);setProgress('')}
  }
 }
 async function sendPrompt(prompt:SharedChatPrompt,options:{clearComposer?:boolean}={}){
  const issue=validatePrompt(prompt);if(issue){if(mounted.current)setError(issue);return}
  const copiedPrompt=clone(prompt);
  await generate([...messagesRef.current,{role:'user',content:copiedPrompt.text.trim()||'Describe the attached image.',...(copiedPrompt.images.length?{images:copiedPrompt.images}:{})}],!!options.clearComposer);
 }
 function send(text=input,editIndex:number|null=null){
  if(busyRef.current||latest.current.workspaceLocked||attachments.processing)return;
  if(editIndex!==null){
   if(!text.trim())return;
   try{void generate(editedConversation(messagesRef.current,editIndex,text))}catch(e:any){setError(e.message)}
   return;
  }
  if(!text.trim()&&!attachments.images.length)return;
  void sendPrompt({text,images:attachments.images},{clearComposer:true});
 }
 async function sendAll(){
  if(!onSendAll||busyRef.current||anyBusy||workspaceLocked||attachments.processing)return;
  try{await onSendAll(id,{text:input,images:clone(attachments.images)})}catch(e:any){if(mounted.current)setError(e.message||'The shared prompt could not be sent.')}
 }
 useImperativeHandle(ref,()=>({
  snapshot:()=>clone({model:latest.current.model,settings:latest.current.settings,messages:messagesRef.current}),
  validatePrompt,sendPrompt,reset,stop:()=>cancel.current?.abort(),focus:()=>composerInput.current?.focus({preventScroll:true}),showError:(message:string)=>{if(mounted.current)setError(message)}
 }));
 const useCases=[{icon:GraduationCap,title:'Learn how models generate',text:'See how words, fragments, and punctuation become tokens, each with its own alternatives.'},{icon:FlaskConical,title:'Experiment with prompts',text:'Rephrase a question and inspect how the wording and token probabilities change.'},{icon:PenLine,title:'Write with more control',text:'Try different continuations and steer a draft one token, phrase, or sentence at a time.'}];
 return <section className={'chat-pane'+(comparison?' is-comparing':'')} aria-label={'Chat '+id}>
 <header className="chat-header"><div className="header-left">{comparison?<><span className="chat-pane-number">CHAT {id}</span><strong>{messages.length?'Conversation':'New conversation'}</strong></>:<><span>Explainability lab</span><span className="slash">/</span><strong>{messages.length?'Conversation':'New conversation'}</strong></>}{messages.length>0&&<span className="chat-turn-count">{messages.filter(m=>m.role==='user').length} {messages.filter(m=>m.role==='user').length===1?'prompt':'prompts'}</span>}</div><div className="chat-pane-controls"><label className="model" title={'Choose the model for Chat '+id}><span className="status-dot"/><select aria-label={'AI model for Chat '+id} value={model} disabled={busy||workspaceLocked||!runtimeReady} onChange={e=>setModel(e.target.value)}>{Object.entries(MODELS).filter(([,config])=>config.chat).map(([modelId,config])=>{const reason=modelUnavailableReason(modelId,{remoteAvailable});return <option key={modelId} value={modelId} disabled={!!reason}>{config.label}{reason?' · '+reason:modelId===DEFAULT_MODEL?' · Default':''}</option>})}</select></label><button type="button" className="chat-pane-add" aria-label={'Add chat to the right of Chat '+id} title={canAdd?'Add a chat with these settings and conversation':'All comparison panels are open'} disabled={!canAdd||anyBusy||workspaceLocked} onClick={()=>onAdd(id)}><Plus size={18}/></button>{onClose&&<button type="button" className="chat-pane-close" aria-label={'Close Chat '+id} title={'Close Chat '+id} disabled={workspaceLocked} onClick={onClose}><X size={16}/></button>}</div></header>
 <section ref={contentArea} className={'content chat-content '+(messages.length?'has-messages':'')} aria-label={'Chat '+id+' messages'} onScroll={()=>{const el=contentArea.current;if(el){const away=el.scrollHeight-el.scrollTop-el.clientHeight>140;followResponse.current=!away;setAwayFromEnd(away)}}}>
 {!messages.length?(comparison?<div className="chat-comparison-empty"><span className="chat-pane-number">CHAT {id}</span><h2>Same prompt. A different perspective.</h2><p>Choose a model and tune its settings below. Send here, or use Send to all to compare responses.</p><div>{suggestions.map(s=><button type="button" key={s.title} onClick={()=>focusPrompt(s.text)}><span>{s.title}</span><ArrowUpRight size={15}/></button>)}</div></div>:<div className="welcome chat-welcome"><div className="welcome-hero"><div className="hero-topline"><span className="hero-pill">POWERED BY NEBIUS</span><span className="hero-index">INSPECT / STEER / GOVERN</span></div><div className="eyebrow">LUMEN / BRING AI INTO VIEW</div><h1>Clarity for AI.<br/><span>Confidence in control.</span></h1><p>Illuminate model choices, guide generation, and bring agent governance and safety into view.</p><div className="hero-capabilities"><span><ScanSearch size={14}/> Token-level insight</span><span><MousePointer2 size={14}/> Human-guided writing</span><span><ShieldCheck size={14}/> Visible governance</span></div><div className="lumen-hackathon-credit">Built for the Nebius × NVIDIA Global AI Hackathon</div></div>
 <div className="chat-starters"><div className="chat-section-label"><span>START WITH A QUESTION</span><small>Choose a prompt to make it your own</small></div><div className="chat-prompt-grid">{suggestions.map(s=><button key={s.title} onClick={()=>focusPrompt(s.text)}><strong>{s.title}</strong><span>{s.text}</span><ArrowUpRight size={16}/></button>)}</div></div>
 <div className="workflow-grid" aria-label="Explore your workspace"><button className="workflow-card" onClick={()=>onNavigate('guided')}><div className="workflow-top"><span className="workflow-icon"><MousePointer2 size={23}/></span><span>02 / STEER</span></div><h2>Guided generation</h2><p>Compare up to 20 next-token candidates. Pick one or add your own text, then explore what comes next.</p><span className="workflow-link">Open the writing lab <ArrowUpRight size={18}/></span></button><button className="workflow-card" onClick={()=>onNavigate('governance')}><div className="workflow-top"><span className="workflow-icon"><ShieldCheck size={23}/></span><span>03 / GOVERN</span></div><h2>Agent governance</h2><p>Explore a live simulation of agent activity, policy reviews, human approvals, and team delegation.</p><span className="workflow-link">Open the control center <ArrowUpRight size={18}/></span></button></div>
 <section className="explainability-uses" aria-labelledby="usecases-title"><div className="uses-heading"><span>PUT EXPLAINABILITY TO WORK</span><h2 id="usecases-title">Useful beyond the answer.</h2></div><div className="usecase-grid">{useCases.map(c=><article key={c.title}><c.icon size={21}/><h3>{c.title}</h3><p>{c.text}</p></article>)}</div><p className="explainability-note"><Info size={15}/> Token probabilities describe model preferences. They don’t verify facts or reveal internal reasoning.</p></section><CreatorCard/>
 </div>):<div className="messages"><div className="chat-inspection-tip"><ScanSearch size={15}/><span>Hover or tap a response token to explore alternatives. Use arrow keys to move between tokens.</span></div>{messages.map((m,i)=><article className={'message '+m.role} key={i}><div className="message-avatar">{m.role==='user'?'Y':<Sparkles size={18}/>}</div><div className="message-body"><div className="chat-message-heading"><small>{m.role==='user'?'You':`Lumen · ${modelConfig(m.model||DEFAULT_MODEL)?.label||'Previous model'}`}</small>{m.role==='assistant'&&<div className="chat-message-meta">{m.logprobs&&m.logprobs.length>0&&<span>{m.logprobs.length} tokens recorded</span>}{m.parameters&&<span className="chat-response-settings" title={parameterTitle(m.parameters)}>T {m.parameters.temperature??'Auto'} · P {m.parameters.top_p??'Auto'}</span>}{m.durationMs!==undefined&&<span title="Time from request to response"><Clock3 size={11}/>{(m.durationMs/1000).toFixed(1)}s</span>}</div>}</div>
 {m.role==='user'&&editing===i?<div className="message-editor"><textarea autoFocus aria-label="Edit sent message" value={editText} maxLength={16000} onChange={e=>setEditText(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setEditing(null);if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.nativeEvent.isComposing){e.preventDefault();send(editText,i)}}}/><p>Resending replaces replies after this message. Ctrl/⌘ + Enter to resend.</p><div><button type="button" onClick={()=>setEditing(null)}>Cancel</button><button type="button" className="resend" disabled={busy||workspaceLocked||!runtimeReady||!editText.trim()} onClick={()=>send(editText,i)}><ArrowUp size={15}/> Resend</button></div></div>:<div className="message-text">{m.role==='assistant'?<TokenProbabilities tokens={m.logprobs} content={m.content}/>:m.content}</div>}
 {m.role==='user'&&!!m.images?.length&&<ImageAttachments images={m.images} compact/>}
 <div className="message-actions">{m.role==='user'&&editing!==i&&<button type="button" className="copy message-action" aria-label="Edit and resend message" title="Edit and resend" disabled={busy||workspaceLocked} onClick={()=>{setEditing(i);setEditText(m.content)}}><PenLine size={16}/></button>}{editing!==i&&<button type="button" className="copy message-action" aria-label={copied===i?'Message copied':m.role==='user'?'Copy message':'Copy response'} title={copied===i?'Copied':m.role==='user'?'Copy message':'Copy response'} onClick={()=>copyMessage(m.content,i)}>{copied===i?<Check size={16}/>:<Copy size={16}/>}</button>}{m.role==='assistant'&&i===messages.length-1&&<button type="button" className="copy message-action" disabled={busy||workspaceLocked} aria-label="Regenerate latest response" title="Regenerate using the selected model and settings" onClick={()=>generate(messagesRef.current.slice(0,i))}><RotateCcw size={15}/></button>}</div></div></article>)}
 {busy&&<div className="chat-working" role="status"><span className="chat-working-icon"><Sparkles size={19}/></span><div><strong>{progress||'Generating your response…'}</strong><span>Collecting the answer and its token alternatives.</span></div><i/><i/><i/></div>}<div ref={end}/></div>}

 </section><div className="composer-wrap chat-composer-wrap">{awayFromEnd&&messages.length>0&&<button type="button" className="chat-jump" onClick={()=>{followResponse.current=true;const el=contentArea.current;if(el)el.scrollTo({top:el.scrollHeight,behavior:'smooth'})}}><ArrowDown size={15}/> Latest response</button>}
 {error&&<div role="alert" className="error chat-feedback"><span>{error}</span>{retryContext&&!busy&&<button type="button" disabled={workspaceLocked} onClick={()=>generate(retryContext)}><RotateCcw size={14}/> Retry</button>}<button type="button" aria-label={'Dismiss error in Chat '+id} onClick={()=>setError('')}><X size={15}/></button></div>}
 {warning&&<div role="status" className="chat-warning"><Info size={15}/><span>{warning}</span><button type="button" aria-label={'Dismiss probability notice in Chat '+id} onClick={()=>setWarning('')}><X size={14}/></button></div>}
 {notice&&<div role="status" className="chat-notice"><span>{notice}</span>{retryContext&&!busy&&<button type="button" disabled={workspaceLocked} onClick={()=>generate(retryContext)}><RotateCcw size={14}/> Retry</button>}</div>}
 {attachments.error&&<div role="alert" className="error chat-feedback"><span>{attachments.error}</span><button type="button" aria-label={'Dismiss image error in Chat '+id} onClick={()=>attachments.setError('')}><X size={14}/></button></div>}
 <form className={'composer '+(busy?'is-busy':'')} onSubmit={e=>{e.preventDefault();send()}}>
  <ImageAttachments images={attachments.images} onRemove={attachments.remove} disabled={busy||workspaceLocked||attachments.processing}/>{attachments.processing&&<p className="image-processing" role="status">Preparing your image…</p>}
  <textarea onPaste={attachments.onPaste} ref={composerInput} aria-label={'Your message for Chat '+id} aria-describedby={helpId} placeholder={busy?'Write your next question while the model works…':comparison?'Write here, then send to this chat or all chats…':'Ask a question or paste an image…'} value={input} maxLength={16000} disabled={workspaceLocked} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send()}}}/>
  <div className="composer-bottom"><span><Sparkles size={14}/> {modelLabel}</span><div className="composer-actions">
   <ImageAttachButton onFiles={attachments.addFiles} disabled={busy||workspaceLocked||attachments.processing||attachments.images.length>=3}/>
   <GenerationSettings value={settings} onChange={setSettings} disabled={busy||workspaceLocked}/>
   {comparison&&onSendAll&&<button type="button" className="chat-send-all" title="Send this prompt to every chat using each chat's settings" aria-label={'Send prompt from Chat '+id+' to all chats'} disabled={!runtimeReady||anyBusy||workspaceLocked||attachments.processing||(!input.trim()&&!attachments.images.length)} onClick={()=>void sendAll()}><SendHorizontal size={16}/><span>Send to all</span></button>}
   {busy?<button type="button" className="send stop" aria-label={'Stop response in Chat '+id} title="Stop response" onClick={()=>cancel.current?.abort()}><Square size={16} fill="currentColor"/></button>:<button className="send" type="submit" aria-label={'Send message to Chat '+id} title="Send to this chat" disabled={!runtimeReady||workspaceLocked||attachments.processing||(!input.trim()&&!attachments.images.length)||!!modelUnavailableReason(model,{remoteAvailable})}><ArrowUp size={21}/></button>}
  </div></div>
 </form>
 {attachments.images.length>0&&<p className="image-context-note">Images are read once by a vision model; your selected model uses that context.</p>}
 <div className="chat-composer-meta" id={helpId}><span><Keyboard size={12}/><kbd>Enter</kbd> send <span className="composer-divider">·</span><kbd>Shift Enter</kbd> new line</span><span>{input.length>0?input.length.toLocaleString()+' / 16,000':'Your API key stays on the server'}</span></div>
 <p className="footnote">Powered by Nebius Token Factory. <span>Token probabilities are not factual confidence.</span></p><span className="chat-sr" role="status">{copied>=0?'Message copied to clipboard':''}</span>
 </div></section>;
});
export default ChatPane;
