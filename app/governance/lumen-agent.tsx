'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {ArrowUp,ArrowUpRight,Check,Copy,Loader2,MessageCircle,Minus,RotateCcw,Sparkles,Square,X} from 'lucide-react';
import LumenMark from '../lumen-mark';
import type {GovernanceAssistantContext} from '../../lib/governance/assistant-context';
import './lumen-agent.css';

type Viewer={id:string;name:string;role:string};
type Turn={id:string;question:string;answer?:string;error?:string;capturedAt?:string;sectionTitle:string};
type Props={section:string;sectionTitle:string;viewer:Viewer;buildContext:()=>GovernanceAssistantContext};
const questions:Record<string,string[]>={
 overview:['What needs my attention right now?','How are the agents performing?','Which agents have the highest risk?'],
 agents:['Which agents need a closer look?','Compare the agents in this view.','Which agents have policy or approval issues?'],
 runs:['Summarize the failed and blocked runs.','What are the main performance bottlenecks?','Compare live runs with simulated runs.'],
 tools:['Which tools fail or get blocked most?','Which tool calls have the highest risk?','Summarize tool usage and latency.'],
 policies:['Which policy violations are most urgent?','Which open policy reviews need an owner?','What remediation would you recommend?'],
 approvals:['Which approvals should I review first?','Which requests are unassigned or expiring?','Summarize the risks in pending requests.'],
 team:['How is the review workload distributed?','Which reviews need reassignment?','Who has the right expertise for open reviews?'],
 audit:['Summarize recent governance changes.','What approval decisions were recorded?','Which assignment changes need attention?'],
 connectors:['Which connectors need attention?','Which tools are configured for each agent?','What is simulated and what is connected?']
};
const snapshotTime=(value?:string)=>value?new Date(value).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'';

/** Safe, deliberately small text renderer: never inserts model-supplied HTML. */
function AnswerText({text}:{text:string}){
 return <div className="lumen-agent-answer">{text.split(/\n\s*\n/).filter(Boolean).map((paragraph,i)=><p key={i}>{paragraph.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part,j)=>part.startsWith('**')&&part.endsWith('**')?<strong key={j}>{part.slice(2,-2)}</strong>:part.startsWith('`')&&part.endsWith('`')?<code key={j}>{part.slice(1,-1)}</code>:part)}</p>)}</div>
}

export default function LumenAgent({section,sectionTitle,viewer,buildContext}:Props){
 const [open,setOpen]=useState(false),[draft,setDraft]=useState(''),[turns,setTurns]=useState<Turn[]>([]),[activeId,setActiveId]=useState<string|null>(null),[elapsed,setElapsed]=useState(0),[copied,setCopied]=useState<string|null>(null);
 const launcher=useRef<HTMLButtonElement>(null),composer=useRef<HTMLTextAreaElement>(null),scroll=useRef<HTMLDivElement>(null),controller=useRef<AbortController|null>(null),generation=useRef(0),copyTimer=useRef<ReturnType<typeof setTimeout>|null>(null),autoScroll=useRef(true);
 const panelId=useId(),titleId=useId(),inputId=useId();
 const busy=activeId!==null,suggestions=questions[section]||questions.overview;

 useEffect(()=>()=>{generation.current++;controller.current?.abort();if(copyTimer.current)clearTimeout(copyTimer.current)},[]);
 useEffect(()=>{if(open){const frame=requestAnimationFrame(()=>composer.current?.focus());return()=>cancelAnimationFrame(frame)}},[open]);
 useEffect(()=>{if(!busy){setElapsed(0);return}const started=Date.now();const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-started)/1000)),1000);return()=>clearInterval(timer)},[busy]);
 useEffect(()=>{if(open&&autoScroll.current&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight},[open,turns,busy]);

 function close(){setOpen(false);launcher.current?.focus()}
 function stop(){
  generation.current++;controller.current?.abort();controller.current=null;
  setTurns(current=>current.map(turn=>turn.id===activeId?{...turn,error:'Stopped. Your question is kept; retry whenever you’re ready.'}:turn));setActiveId(null);
 }
 function reset(){generation.current++;controller.current?.abort();controller.current=null;setActiveId(null);setTurns([]);setDraft('');setCopied(null);composer.current?.focus()}
 async function ask(question:string,retryId?:string){
  question=question.trim();if(!question||controller.current)return;
  const id=retryId||crypto.randomUUID(),requestId=++generation.current,abort=new AbortController();controller.current=abort;autoScroll.current=true;
  const prior=(retryId?turns.slice(0,turns.findIndex(t=>t.id===retryId)):turns).filter(t=>t.answer).slice(-3);
  while(prior.length&&prior.reduce((size,t)=>size+t.question.length+Math.min(t.answer!.length,12000),question.length)>30000)prior.shift();
  const messages=[...prior.flatMap(t=>[{role:'user' as const,content:t.question},{role:'assistant' as const,content:t.answer!.slice(0,12000)}]),{role:'user' as const,content:question}];
  setTurns(current=>retryId?[...current.slice(0,Math.max(0,current.findIndex(t=>t.id===retryId))),{id,question,sectionTitle}]:[...current.slice(-23),{id,question,sectionTitle}]);setActiveId(id);if(!retryId)setDraft('');
  try{
   const snapshot=buildContext();
   const response=await fetch('/api/governance-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages,snapshot}),signal:abort.signal});
   let payload:any;try{payload=await response.json()}catch{throw new Error('Lumen-Agent returned an unreadable response. Please retry.')}
   if(!response.ok)throw new Error(typeof payload?.error==='string'?payload.error:'Lumen-Agent could not answer just now. Please retry.');
   if(typeof payload?.answer!=='string'||!payload.answer.trim())throw new Error('No answer was returned. Please retry.');
   if(generation.current!==requestId)return;
   setTurns(current=>current.map(t=>t.id===id?{...t,answer:payload.answer,capturedAt:typeof payload.capturedAt==='string'?payload.capturedAt:snapshot.capturedAt}:t));
  }catch(error){
   if(generation.current!==requestId)return;
   setTurns(current=>current.map(t=>t.id===id?{...t,error:abort.signal.aborted?'Stopped. Your question is kept; retry whenever you’re ready.':error instanceof Error?error.message:'Could not reach Lumen-Agent. Please try again.'}:t));
  }finally{if(generation.current===requestId){controller.current=null;setActiveId(null)}}
 }
 async function copy(turn:Turn){
  try{await navigator.clipboard.writeText(turn.answer||'');setCopied(turn.id);if(copyTimer.current)clearTimeout(copyTimer.current);copyTimer.current=setTimeout(()=>setCopied(null),2000)}catch{setCopied('unavailable')}
 }

 return <div className="lumen-agent-widget">
  {open&&<section id={panelId} className="lumen-agent-panel" role="dialog" aria-modal="false" aria-labelledby={titleId} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();close()}}}>
   <header className="lumen-agent-header"><span className="lumen-agent-avatar"><LumenMark/><Sparkles className="lumen-agent-spark" size={13}/></span><div><h2 id={titleId}>Lumen-Agent</h2><p><span/> Your governance copilot</p></div><div className="lumen-agent-header-actions"><button type="button" className="lumen-agent-icon" aria-label="New Lumen-Agent conversation" title="New conversation" disabled={!turns.length&&!draft} onClick={reset}><RotateCcw size={16}/></button><button type="button" className="lumen-agent-icon" aria-label="Minimize Lumen-Agent" title="Minimize" onClick={close}><Minus size={18}/></button></div></header>
   <div className="lumen-agent-scope"><span><span className="lumen-agent-context-dot"/>{sectionTitle}</span><span>{viewer.role} view · Read only</span></div>
   <div className="lumen-agent-scroll" ref={scroll} onScroll={()=>{const area=scroll.current;if(area)autoScroll.current=area.scrollHeight-area.scrollTop-area.clientHeight<80}}>
    <div className={'lumen-agent-welcome '+(turns.length?'compact':'')}><span className="lumen-agent-welcome-icon"><Sparkles size={21}/></span><h3>{turns.length?'A little clarity, on demand.':'Your dashboard, explained.'}</h3><p>Hi {viewer.name.split(' ')[0]}. Ask about performance, risks, or reviews. I’ll use the latest dashboard data available in your role.</p></div>
    {!turns.length&&<div className="lumen-agent-suggestions"><span>TRY ASKING</span>{suggestions.map(question=><button type="button" key={question} onClick={()=>ask(question)}><span>{question}</span><ArrowUpRight size={16}/></button>)}</div>}
    <div className="lumen-agent-transcript" role="log" aria-label="Lumen-Agent conversation" aria-live="polite" aria-relevant="additions text">
     {turns.map(turn=><article className="lumen-agent-turn" key={turn.id}>
      <div className="lumen-agent-question"><span>You</span><p>{turn.question}</p></div>
      <div className="lumen-agent-response"><div className="lumen-agent-response-heading"><LumenMark/><strong>Lumen-Agent</strong>{turn.answer&&<button type="button" className="lumen-agent-icon" onClick={()=>copy(turn)} aria-label={copied===turn.id?'Answer copied':'Copy answer'} title={copied===turn.id?'Copied':'Copy answer'}>{copied===turn.id?<Check size={14}/>:<Copy size={14}/>}</button>}</div>
       {turn.answer?<><AnswerText text={turn.answer}/><div className="lumen-agent-answer-meta">{turn.sectionTitle} · Snapshot {snapshotTime(turn.capturedAt)}</div></>:turn.error?<div className="lumen-agent-error"><p>{turn.error}</p><button type="button" disabled={busy} onClick={()=>ask(turn.question,turn.id)}><RotateCcw size={13}/> Retry question</button></div>:<div className="lumen-agent-pending" role="status"><span className="lumen-agent-thinking"><i/><i/><i/></span><span>{elapsed<15?'Reading the dashboard…':'Preparing a grounded answer…'}{elapsed>=5&&<small aria-hidden="true">{elapsed}s</small>}</span></div>}
      </div>
     </article>)}
    </div>
    {turns.length>0&&!busy&&<details className="lumen-agent-more"><summary><Sparkles size={13}/> Questions for {sectionTitle}</summary><div>{suggestions.map(question=><button type="button" key={question} onClick={()=>ask(question)}>{question}<ArrowUpRight size={13}/></button>)}</div></details>}
   </div>
   <form className="lumen-agent-compose" onSubmit={event=>{event.preventDefault();ask(draft)}}><label className="lumen-agent-sr-only" htmlFor={inputId}>Ask Lumen-Agent about this dashboard</label><div className="lumen-agent-input-wrap"><textarea id={inputId} ref={composer} value={draft} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();if(!busy)ask(draft)}}} placeholder="Ask about this dashboard…" maxLength={2000} rows={2}/>{busy?<button type="button" className="lumen-agent-send stop" aria-label="Stop answer" title="Stop answer" onClick={stop}><Square size={15} fill="currentColor"/></button>:<button type="submit" className="lumen-agent-send" disabled={!draft.trim()} aria-label="Send question" title="Send question"><ArrowUp size={19}/></button>}</div><div className="lumen-agent-footnote"><span>Powered by Nebius · Answers use a fresh snapshot</span>{copied==='unavailable'?<span role="status">Copy unavailable</span>:<span>↵ Send</span>}</div></form>
  </section>}
  <button type="button" ref={launcher} className={'lumen-agent-launcher '+(open?'is-open':'')} aria-expanded={open} aria-controls={panelId} aria-label={open?'Minimize Lumen-Agent':'Open Lumen-Agent dashboard assistant'} onClick={()=>open?close():setOpen(true)}><span className="lumen-agent-orb">{open?<X size={22}/>:<><LumenMark/><Sparkles size={12} className="lumen-agent-orb-spark"/></>}</span>{!open&&<span className="lumen-agent-launcher-copy"><strong>Lumen-Agent</strong><small>Ask your dashboard</small></span>}{!open&&<MessageCircle size={17} className="lumen-agent-launcher-chat"/>}{open&&busy&&<Loader2 size={15} className="lumen-agent-launcher-loading"/>}</button>
 </div>
}
