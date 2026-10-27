'use client';
import Guided from './guided';
import GovernanceDashboard from './governance/dashboard';
import AgentStudio from './studio/studio';
import Architecture from './architecture';
import ChatWorkspace,{type ChatWorkspaceHandle} from './chat-workspace';
import LumenMark from './lumen-mark';
import AboutLumen from './about-lumen';
import {useState,useEffect,useRef,useCallback} from 'react';
import {Plus,ScanSearch,MousePointer2,ShieldCheck,Workflow,FileCode2,Network} from 'lucide-react';
import './chat-enhancements.css';
import './lumen-brand.css';
import './lumen-glass.css';
import './chat-comparison.css';
import './lumen-typography.css';
import './lumen-theme.css';

type Mode='chat'|'guided'|'governance'|'studio'|'policies'|'architecture';
const modes:{id:Mode;label:string;icon:typeof ScanSearch}[]=[{id:'chat',label:'Explainable chat',icon:ScanSearch},{id:'guided',label:'Guided generation',icon:MousePointer2},{id:'governance',label:'Agent governance',icon:ShieldCheck},{id:'studio',label:'Agent studio',icon:Workflow},{id:'architecture',label:'Architecture',icon:Network}];

export default function Home(){
 const [governRunId,setGovernRunId]=useState<string|null>(null);
 const [governanceSection,setGovernanceSection]=useState<string>('overview');
 const [guidedSession,setGuidedSession]=useState(0),[mode,setMode]=useState<Mode>('chat');
 const [studioAgentId,setStudioAgentId]=useState<string|null>(null),[governAgentId,setGovernAgentId]=useState<string|null>(null),[pendingMode,setPendingMode]=useState<Mode|null>(null);
 const studioDirty=useRef(false),policiesDirty=useRef(false),modeRef=useRef<Mode>('chat'),studioSavingRef=useRef(false),policiesSavingRef=useRef(false),busyRef=useRef(false);
 const [studioSaving,setStudioSaving]=useState(false),[policiesSaving,setPoliciesSaving]=useState(false),[busy,setBusy]=useState(false);
 const chat=useRef<ChatWorkspaceHandle>(null);
 const reportStudioSaving=useCallback((saving:boolean)=>{studioSavingRef.current=saving;setStudioSaving(saving)},[]),reportStudioDirty=useCallback((dirty:boolean)=>{studioDirty.current=dirty},[]);
 const reportPoliciesSaving=useCallback((saving:boolean)=>{policiesSavingRef.current=saving;setPoliciesSaving(saving)},[]),reportPoliciesDirty=useCallback((dirty:boolean)=>{policiesDirty.current=dirty},[]);
 const reportChatBusy=useCallback((value:boolean)=>{busyRef.current=value;setBusy(value)},[]);
 useEffect(()=>{
  try{localStorage.removeItem('azure-chats')}catch{}
  const read=()=>{const value=window.location.hash.slice(1);if(!busyRef.current&&(value==='policies'||modes.some(m=>m.id===value)))changeMode(value as Mode)};
  read();window.addEventListener('hashchange',read);return()=>window.removeEventListener('hashchange',read);
 },[]);
 function applyMode(next:Mode){if(next==='policies'){setGovernanceSection('policy-files');next='governance'}studioDirty.current=false;policiesDirty.current=false;modeRef.current=next;setMode(next);setPendingMode(null);window.history.replaceState(null,'',`${window.location.pathname}${window.location.search}#${next}`)}
 function changeMode(next:Mode){
  if(busyRef.current||next===modeRef.current)return;
  if(studioSavingRef.current||policiesSavingRef.current){window.history.replaceState(null,'',`${window.location.pathname}${window.location.search}#${modeRef.current}`);return}
  if((modeRef.current==='studio'&&studioDirty.current)||(modeRef.current==='governance'&&policiesDirty.current)){setPendingMode(next);window.history.replaceState(null,'',`${window.location.pathname}${window.location.search}#${modeRef.current}`);return}
  applyMode(next);
 }
 function fresh(){
  if(busyRef.current)return;
  if(mode==='guided'){try{localStorage.removeItem('azure-guided')}catch{}setGuidedSession(n=>n+1)}
  else chat.current?.reset();
 }
 return <div className="shell lumen-workspace"><div className="aurora one"/><div className="aurora two"/><main><div className="mode-tabs">
  <a className="brand" href="#chat" onClick={e=>{e.preventDefault();changeMode('chat')}} aria-label="Lumen — explainable chat" title="Lumen · Clarity for AI. Confidence in control."><LumenMark className="lumen-mark"/><span className="lumen-wordmark">Lumen<span className="brand-dot">.</span></span></a>
  <div className="mode-options" role="group" aria-label="Workspace mode">{modes.map(m=><button key={m.id} disabled={busy||studioSaving||policiesSaving} className={mode===m.id?'active':''} aria-pressed={mode===m.id} onClick={()=>changeMode(m.id)}><m.icon size={16}/><span>{m.label}</span></button>)}</div>
  {mode==='chat'||mode==='guided'?<button type="button" className="newchat" onClick={fresh} disabled={busy}><Plus size={18}/><span>New conversation</span></button>:<span className="workspace-mark"><span/> {mode==='architecture'?'System map':mode==='studio'?'Define & configure':mode==='policies'?'Rules & safeguards':'Monitor & govern'}</span>}
 <AboutLumen/>
 </div>
 {pendingMode&&<LeaveWorkspaceDialog workspace={mode==='governance'?'Policies':'Agent Studio'} onStay={()=>setPendingMode(null)} onLeave={()=>applyMode(pendingMode)}/>}
 <ChatWorkspace ref={chat} active={mode==='chat'} onBusyChange={reportChatBusy} onNavigate={changeMode}/>
 {mode==='architecture'?<Architecture/>:mode==='studio'?<AgentStudio initialAgentId={studioAgentId} onSavingChange={reportStudioSaving} onDirtyChange={reportStudioDirty} onGovern={(id,runId)=>{setGovernAgentId(id);setGovernRunId(runId||null);setGovernanceSection(runId?'runs':'agents');applyMode('governance')}}/>:mode==='governance'?<GovernanceDashboard initialRunId={governRunId} initialScreen={governanceSection} onDirtyChange={reportPoliciesDirty} onSavingChange={reportPoliciesSaving} initialAgentId={governAgentId} onConfigureAgent={id=>{setStudioAgentId(id);changeMode('studio')}}/>:mode==='guided'?<Guided key={guidedSession}/>:null}
 </main></div>;
}

function LeaveWorkspaceDialog({workspace,onStay,onLeave}:{workspace:'Agent Studio'|'Policies';onStay:()=>void;onLeave:()=>void}){const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{const previous=document.activeElement as HTMLElement;const dialog=ref.current;dialog?.showModal();return()=>{dialog?.close();previous?.focus?.()}},[]);return <dialog ref={ref} className="workspace-leave-dialog" aria-labelledby="leave-workspace-title" onCancel={e=>{e.preventDefault();onStay()}}><span className="leave-icon">{workspace==='Policies'?<FileCode2 size={24}/>:<Workflow size={24}/>}</span><h2 id="leave-workspace-title">Leave without saving?</h2><p>{workspace==='Policies'?'Your policy file has unsaved changes. Save it first to update the shared rules used by Studio and Governance.':'Your Agent Studio configuration has unsaved changes. Save it first to update the shared governance data.'}</p><div><button type="button" onClick={onStay} autoFocus>Keep editing</button><button type="button" className="discard" onClick={onLeave}>Discard & leave</button></div></dialog>}
