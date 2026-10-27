'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronLeft,ChevronRight,Undo2} from 'lucide-react';
import type {GuidedSelection} from '../lib/guided-history';
import './guided-draft.css';

type Active={index:number;selection:GuidedSelection};
const hasProbability=(selection:GuidedSelection)=>selection.source==='model'&&typeof selection.logprob==='number'&&Number.isFinite(selection.logprob)&&selection.logprob<=0;
const probability=(logprob:number|undefined)=>typeof logprob!=='number'||!Number.isFinite(logprob)||logprob>0||logprob<=-9999?'Unavailable':`${(Math.exp(logprob)*100).toFixed(6)}%`;

/** Selection text is authoritative: custom phrases must keep their exact spaces,
 * line breaks, and Unicode, rather than being decoded as model token bytes. */
export default function GuidedDraft({selections,onRevert,revertDisabled=false}:{selections:GuidedSelection[];onRevert?:(index:number)=>void;revertDisabled?:boolean}){
 const [active,setActive]=useState<Active|null>(null),[position,setPosition]=useState({left:12,top:12,maxHeight:500});
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null),anchor=useRef<HTMLSpanElement|null>(null),popup=useRef<HTMLDivElement|null>(null),nodes=useRef<(HTMLSpanElement|null)[]>([]),id=useId();
 const chosen=active&&selections[active.index]===active.selection&&hasProbability(active.selection)?active.selection:null;
 const modelIndexes=selections.flatMap((selection,index)=>hasProbability(selection)?[index]:[]);
 const ordinal=active?modelIndexes.indexOf(active.index):-1;
 const alternatives=(chosen?.alternatives||[]).filter(t=>Number.isFinite(t.logprob)&&t.logprob<=0).slice().sort((a,b)=>b.logprob-a.logprob).slice(0,20);
 function clear(){if(timer.current){clearTimeout(timer.current);timer.current=null}}
 function close(){clear();setActive(null)}
 function leave(){clear();timer.current=setTimeout(()=>setActive(null),260)}
 function show(index:number,element:HTMLSpanElement,point?:{x:number;y:number}){
  const selection=selections[index];if(!selection||!hasProbability(selection))return;
  clear();anchor.current=element;
  const rects=Array.from(element.getClientRects());
  const rect=point?rects.find(r=>point.x>=r.left&&point.x<=r.right&&point.y>=r.top&&point.y<=r.bottom)||element.getBoundingClientRect():rects[0]||element.getBoundingClientRect();
  const width=Math.min(420,window.innerWidth-24),top=Math.max(rect.bottom+8,point?point.y+12:0);
  setPosition({left:Math.max(12,Math.min(point?.x??rect.left,window.innerWidth-width-12)),top,maxHeight:Math.max(0,window.innerHeight-top-12)});
  setActive({index,selection});
 }
 function move(from:number,direction:number){
  const next=direction<0?modelIndexes.filter(index=>index<from).at(-1):modelIndexes.find(index=>index>from);
  if(next===undefined)return;const element=nodes.current[next];if(element){element.focus({preventScroll:true});show(next,element)}
 }
 useEffect(()=>{if(active&&!chosen)close()},[active,chosen]);
 useEffect(()=>()=>clear(),[]);
 useEffect(()=>{
  if(!chosen)return;
  const dismiss=(event:PointerEvent)=>{if(!popup.current?.contains(event.target as Node)&&!anchor.current?.contains(event.target as Node))close()};
  const scroll=(event:Event)=>{if(!popup.current?.contains(event.target as Node))close()};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')close()};
  document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',escape);window.addEventListener('scroll',scroll,true);window.addEventListener('resize',close);
  return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',escape);window.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',close)};
 },[chosen]);
 return <span className="guide-annotated-draft">
  {selections.map((selection,index)=>selection.source==='custom'?<mark key={index} className="guide-custom-selection" title="Added by you. Model probability was not measured for this text.">{selection.text}</mark>:hasProbability(selection)?<span
   key={index}
   ref={element=>{nodes.current[index]=element}}
   className={'response-token guide-model-selection '+(active?.index===index&&chosen?'hovered':'')}
   tabIndex={0}
   role="button"
   aria-label={`Generated token ${JSON.stringify(selection.text)}: probability ${probability(selection.logprob)}. Show log probability and alternatives.`}
   aria-expanded={active?.index===index&&!!chosen}
   aria-controls={active?.index===index&&chosen?id:undefined}
   onMouseEnter={event=>show(index,event.currentTarget,{x:event.clientX,y:event.clientY})}
   onMouseLeave={leave}
   onFocus={event=>show(index,event.currentTarget)}
   onBlur={event=>{if(!popup.current?.contains(event.relatedTarget as Node|null))leave()}}
   onClick={event=>show(index,event.currentTarget,event.detail?{x:event.clientX,y:event.clientY}:undefined)}
   onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();show(index,event.currentTarget)}else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();move(index,event.key==='ArrowRight'?1:-1)}}}
  >{selection.text}</span>:<span key={index} className="guide-legacy-selection">{selection.text}</span>)}
  {chosen&&active&&createPortal(<div ref={popup} id={id} className="token-popover guide-token-popover" style={position} role="region" aria-label="Guided token log probability and alternatives" onMouseEnter={clear} onMouseLeave={leave} onFocusCapture={clear} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)&&event.relatedTarget!==anchor.current)leave()}}>
   <div className="popover-heading"><div><small>GENERATED TOKEN</small><code>{JSON.stringify(chosen.text)}</code></div><button type="button" aria-label="Close guided token alternatives" onClick={close}>×</button></div>
   <div className="generated-prob">{probability(chosen.logprob)} <span>probability</span></div>
   <p className="token-logprob">log p = {typeof chosen.logprob==='number'?chosen.logprob.toFixed(6):'unavailable'}</p>
   {onRevert&&<div className="guide-token-revert"><button type="button" className="guide-token-revert-button" disabled={revertDisabled||active.index===selections.length-1} title={revertDisabled?'Stop generation before reverting':active.index===selections.length-1?'This token is already the end of your draft':'Keep this token and move all later text to Redo'} onClick={()=>{const index=active.index;anchor.current?.focus({preventScroll:true});close();onRevert(index)}}><Undo2 size={15}/> Revert to here</button><small>{revertDisabled?'Stop generation to revert.':active.index===selections.length-1?'This is the current draft end.':'Keep this token. Later text is available in Redo.'}</small></div>}
   <div className="alternative-heading"><strong>{alternatives.length?`Top ${alternatives.length} alternatives`:'Token alternatives'}</strong><span>PROBABILITY ↓</span></div>
   {alternatives.length?<ol>{alternatives.map((alternative,index)=><li key={index} className={alternative.token===chosen.text?'is-generated':''}>
    <i className="alt-bar" style={{width:`${Math.max(0,Math.min(100,Math.exp(alternative.logprob)*100))}%`}}/>
    <span className="alt-rank">{String(index+1).padStart(2,'0')}</span><code title={JSON.stringify(alternative.token)}>{JSON.stringify(alternative.token)}</code>
    <span className="alt-prob">{probability(alternative.logprob)}{alternative.token===chosen.text&&<small aria-label="Selected token" title="Selected token">●</small>}</span>
   </li>)}</ol>:<p className="no-alternatives">No alternatives were recorded when this token was selected.</p>}
   <div className="token-inspector-nav"><span>Generated token {ordinal+1} of {modelIndexes.length} · ← → to explore</span><button type="button" aria-label="Previous generated draft token" disabled={ordinal<=0} onClick={()=>move(active.index,-1)}><ChevronLeft size={14}/></button><button type="button" aria-label="Next generated draft token" disabled={ordinal===modelIndexes.length-1} onClick={()=>move(active.index,1)}><ChevronRight size={14}/></button></div>
   <p className="popover-note">● Selected token · Recorded at selection time, conditioned on the earlier draft. Probabilities do not measure factual confidence.</p>
  </div>,document.body)}
 </span>;
}
