'use client';
import {useState,useEffect,useRef,useId} from 'react';
import {createPortal} from 'react-dom';
import {ChevronLeft,ChevronRight} from 'lucide-react';

export type TokenProbability={token:string,logprob:number,bytes?:number[],top_logprobs?:TokenProbability[]};

export default function TokenProbabilities({tokens=[],content,highlightedTokenIndices=[]}:{tokens?:TokenProbability[],content:string;highlightedTokenIndices?:number[]}) {
 const [active,setActive]=useState<number|null>(null);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const anchor=useRef<HTMLElement|null>(null);
 const tokenNodes=useRef<(HTMLSpanElement|null)[]>([]);
 const popup=useRef<HTMLDivElement>(null);
 const [position,setPosition]=useState({left:12,top:12,maxHeight:500});
 const id=useId();

 function clear(){if(timer.current){clearTimeout(timer.current);timer.current=null}}
 function close(){clear();setActive(null)}
 function leave(){clear();timer.current=setTimeout(()=>setActive(null),260)}
 function move(direction:number){if(active===null)return;let next=active+direction;while(next>=0&&next<tokens.length&&!tokenNodes.current[next])next+=direction;const node=tokenNodes.current[next];if(node){node.focus({preventScroll:true});show(next,node)}}
 function show(i:number,el:HTMLElement,point?:{x:number,y:number}){
  clear();anchor.current=el;
  const rects=Array.from(el.getClientRects());
  const r=point?rects.find(r=>point.x>=r.left&&point.x<=r.right&&point.y>=r.top&&point.y<=r.bottom)||el.getBoundingClientRect():rects[0]||el.getBoundingClientRect();
  const width=Math.min(420,window.innerWidth-24);
  const top=Math.max(r.bottom+8,point?point.y+12:0);
  setPosition({left:Math.max(12,Math.min(point?.x??r.left,window.innerWidth-width-12)),top,maxHeight:Math.max(0,window.innerHeight-top-12)});
  setActive(i);
 }

 useEffect(()=>{
  if(active===null)return;
  const dismiss=(e:PointerEvent)=>{if(!popup.current?.contains(e.target as Node)&&!anchor.current?.contains(e.target as Node))close()};
  const scroll=(e:Event)=>{if(!popup.current?.contains(e.target as Node))close()};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')close()};
  document.addEventListener('pointerdown',dismiss);
  document.addEventListener('keydown',escape);
  window.addEventListener('scroll',scroll,true);
  window.addEventListener('resize',close);
  return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',escape);window.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',close)};
 },[active]);
 useEffect(()=>()=>clear(),[]);

 const decoder=new TextDecoder();
 const pieces=tokens.map(t=>Array.isArray(t.bytes)?decoder.decode(new Uint8Array(t.bytes),{stream:true}):t.token);
 const prefix=pieces.join('');
 const aligned=content.startsWith(prefix);
 const chosen=active===null?null:tokens[active];
 const alternatives=[...(chosen?.top_logprobs||[])].sort((a,b)=>b.logprob-a.logprob).slice(0,10);
 const pct=(logprob:number)=>!Number.isFinite(logprob)||logprob>0||logprob<=-9999?'Unavailable':(Math.exp(logprob)*100).toFixed(6)+'%';
 const highlighted=new Set(highlightedTokenIndices);

 return <div className="token-response">
  <div className="token-response-text">{aligned?<>{pieces.map((piece,i)=>piece&&<span
   key={i}
   ref={el=>{tokenNodes.current[i]=el}}
   className={'response-token '+(active===i?'hovered':'')+(highlighted.has(i)?' is-different':'')}
   tabIndex={0}
   role="button"
   aria-label={`Token ${JSON.stringify(tokens[i].token)}: show alternatives below this token`}
   aria-expanded={active===i}
   aria-controls={active===i?id:undefined}
   onMouseEnter={e=>show(i,e.currentTarget,{x:e.clientX,y:e.clientY})}
   onMouseLeave={leave}
   onFocus={e=>show(i,e.currentTarget)}
   onBlur={e=>{if(!popup.current?.contains(e.relatedTarget as Node|null))leave()}}
   onClick={e=>show(i,e.currentTarget,e.detail?{x:e.clientX,y:e.clientY}:undefined)}
   onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();show(i,e.currentTarget)}if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();let next=i+(e.key==='ArrowRight'?1:-1);while(next>=0&&next<tokens.length&&!tokenNodes.current[next])next+=e.key==='ArrowRight'?1:-1;tokenNodes.current[next]?.focus({preventScroll:true})}}}
  >{piece}</span>)}{content.slice(prefix.length)}</>:content}</div>
  {chosen&&createPortal(<div ref={popup} id={id} className="token-popover" style={position} role="region" aria-label="Token alternatives below hovered token" onMouseEnter={clear} onMouseLeave={leave} onFocusCapture={clear} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null)&&e.relatedTarget!==anchor.current)leave()}}>
   <div className="popover-heading"><div><small>GENERATED TOKEN</small><code>{JSON.stringify(chosen.token)}</code></div><button type="button" aria-label="Close token alternatives" onClick={close}>×</button></div>
   <div className="generated-prob">{pct(chosen.logprob)} <span>probability</span></div>
   <p className="token-logprob">log p = {Number.isFinite(chosen.logprob)&&chosen.logprob>-9999?chosen.logprob.toFixed(6):'unavailable'}</p>
   <div className="alternative-heading"><strong>{alternatives.length?`Top ${alternatives.length} alternatives`:'Token alternatives'}</strong><span>PROBABILITY ↓</span></div>
   {alternatives.length?<ol>{alternatives.map((alt,i)=><li key={i} className={alt.token===chosen.token?'is-generated':''}>
    <i className="alt-bar" style={{width:`${Number.isFinite(alt.logprob)?Math.max(0,Math.min(100,Math.exp(alt.logprob)*100)):0}%`}}/>
    <span className="alt-rank">{String(i+1).padStart(2,'0')}</span><code title={JSON.stringify(alt.token)}>{JSON.stringify(alt.token)}</code>
    <span className="alt-prob">{pct(alt.logprob)}{alt.token===chosen.token&&<small aria-label="Generated token" title="Generated token">●</small>}</span>
   </li>)}</ol>:<p className="no-alternatives">The provider did not return alternatives for this token. You can regenerate the response to request them again.</p>}
   <div className="token-inspector-nav"><span>Token {(active??0)+1} of {tokens.length} · ← → to explore</span><button type="button" aria-label="Previous response token" disabled={active===0} onClick={()=>move(-1)}><ChevronLeft size={14}/></button><button type="button" aria-label="Next response token" disabled={active===tokens.length-1} onClick={()=>move(1)}><ChevronRight size={14}/></button></div>
   <p className="popover-note">● Generated token · Probabilities are conditioned on earlier tokens, rounded, and do not measure factual confidence.</p>
  </div>,document.body)}
 </div>
}
