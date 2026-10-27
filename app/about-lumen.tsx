'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Info,X} from 'lucide-react';
import LumenMark from './lumen-mark';

const PROFILE_URL='https://www.linkedin.com/in/sallu-mandya/';

export function CreatorCard(){return <section className="lumen-creator-card" aria-label="About the builder"><div className="lumen-creator-avatar" aria-hidden="true">A</div><div><span className="lumen-creator-eyebrow">THE BUILDER BEHIND LUMEN</span><h2>Arsalan<span>Project Owner &amp; AI Lead</span></h2><p>I built Lumen for the Nebius × NVIDIA Global AI Hackathon—a workspace for understanding model choices, guiding generation, and governing AI agents.</p></div><a href={PROFILE_URL} target="_blank" rel="noopener noreferrer">Connect on LinkedIn <ArrowUpRight size={17}/><span className="sr-only"> (opens in a new tab)</span></a></section>}

export default function AboutLumen(){
 const [open,setOpen]=useState(false);
 return <><button type="button" className="lumen-about-button" onClick={()=>setOpen(true)} aria-label="About Lumen and its builder" title="About Lumen"><Info size={17}/><span>About</span></button>{open&&<AboutDialog onClose={()=>setOpen(false)}/>}</>;
}

function AboutDialog({onClose}:{onClose:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const dialog=ref.current;dialog?.showModal();return()=>{dialog?.close();previous?.focus?.()}},[]);
 return <dialog ref={ref} className="lumen-about-dialog" aria-labelledby="lumen-about-title" onCancel={e=>{e.preventDefault();onClose()}} onClick={e=>{if(e.target===ref.current){const box=ref.current.getBoundingClientRect();if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)onClose()}}}>
  <button type="button" className="lumen-about-close" onClick={onClose} aria-label="Close About Lumen" autoFocus><X size={20}/></button>
  <div className="lumen-about-intro"><LumenMark className="lumen-mark"/><span className="lumen-creator-eyebrow">EXPLAINABLE AI + AGENT GOVERNANCE</span><h2 id="lumen-about-title">Clarity for AI.<br/>Confidence in control.</h2><p>Model visibility, guided generation, and agent oversight in one workspace.</p><span className="lumen-hackathon-label">Built for the Nebius × NVIDIA Global AI Hackathon</span></div>
  <div className="lumen-about-story"><span className="lumen-creator-eyebrow">ABOUT ME</span><h3>Hi, I’m Arsalan.</h3><p>I’m the project owner and AI lead behind Lumen. I built this workspace for the hackathon to make AI systems easier to understand, guide, and govern.</p><p>Explore the alternatives behind each generated token, steer a response one step at a time, and connect agent definitions with visible governance and recorded execution evidence.</p><a className="lumen-profile-link" href={PROFILE_URL} target="_blank" rel="noopener noreferrer">Connect with me on LinkedIn <ArrowUpRight size={18}/><span className="sr-only"> (opens in a new tab)</span></a><small>Built by Arsalan · Powered by Nebius TokenFactory</small></div>
 </dialog>;
}
