'use client';
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {ArrowUpRight,Check,CheckCheck,ChevronDown,ChevronRight,Code2,Download,FileCode2,FileText,Globe2,Info,Layers3,Loader2,LockKeyhole,RefreshCw,RotateCcw,Save,Search,ShieldCheck,Upload,X} from 'lucide-react';
import {governanceService as service,scopeStore,canAccess,canManage} from '../../lib/governance/service';
import {configurationFrom} from '../../lib/governance/definitions';
import {parsePolicyYaml,stringifyPolicyYaml,type PolicyFileScope} from '../../lib/governance/policy-yaml';
import type {Guardrail,Store} from '../../lib/governance/types';
import {useWorkspaceUser} from '../governance/use-workspace-user';
import './policies.css';

type Props={onDirtyChange?:(dirty:boolean)=>void;onSavingChange?:(saving:boolean)=>void;onConfigureAgent?:(id:string)=>void};
type PolicyFile={key:string;filename:string;label:string;target:PolicyFileScope;rules:Guardrail[];revision:number;updatedAt:string;updatedBy:string};
type Draft={key:string;source:string;baseline:string;revision:number;target:PolicyFileScope};
type Pending={kind:'file';key:string}|{kind:'role';userId:string}|{kind:'reset'};
const MAX_FILE_SIZE=64*1024;
const initials=(name:string)=>name.split(' ').map(word=>word[0]).slice(0,2).join('').toUpperCase();
const date=(value:string)=>new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const message=(error:unknown,fallback:string)=>error instanceof Error?error.message.slice(0,1800):fallback;
const enabledCount=(rules:Guardrail[])=>rules.filter(rule=>rule.enabled).length;
const className=(value:string)=>value.toLowerCase().replaceAll(' ','-');
function filesFor(store:Store):PolicyFile[]{
 const global=store.globalPolicies;
 return [...(global?[{key:'global',filename:'global.yaml',label:'Workspace policies',target:{scope:'global'} as PolicyFileScope,rules:global.rules,revision:global.revision,updatedAt:global.updatedAt,updatedBy:global.updatedBy}]:[]),...store.agents.flatMap(agent=>{const definition=store.definitions.find(item=>item.agentId===agent.id);return definition?[{key:`agent:${agent.id}`,filename:`${agent.id.replace(/[^a-z0-9._-]/gi,'-')}.yaml`,label:agent.name,target:{scope:'agent',agentId:agent.id} as PolicyFileScope,rules:definition.guardrails,revision:definition.revision,updatedAt:definition.updatedAt,updatedBy:definition.updatedBy}]:[]})];
}
function draftFor(file:PolicyFile):Draft{const source=stringifyPolicyYaml(file.target,file.rules);return {key:file.key,target:file.target,source,baseline:source,revision:file.revision}}
function RulePreview({rule,inherited=false}:{rule:Guardrail;inherited?:boolean}){
 return <article className={'pol-rule '+(!rule.enabled?'is-disabled':'')}><div className="pol-rule-top"><strong>{rule.name}</strong><span className={'pol-enabled '+(rule.enabled?'on':'off')}>{rule.enabled?'Enabled':'Disabled'}</span></div><p>{rule.description||'No description provided.'}</p><div className="pol-rule-tags"><span>{rule.stage}</span><span className={'pol-action '+className(rule.action)}>{rule.action}</span><span className={'pol-severity '+className(rule.severity)}>{rule.severity}</span>{inherited&&<span>Inherited</span>}</div><code>{rule.id}</code></article>;
}

export default function Policies({onDirtyChange,onSavingChange,onConfigureAgent}:Props){
 const [raw,setRaw]=useState<Store|null>(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
 const [userId,setUserId]=useWorkspaceUser();
 const [selectedKey,setSelectedKey]=useState('global'),[query,setQuery]=useState(''),[scope,setScope]=useState<'all'|'global'|'agent'>('all');
 const [draft,setDraft]=useState<Draft|null>(null),[saving,setSaving]=useState(false),[importing,setImporting]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState<Pending|null>(null);
 const loadSequence=useRef(0),importSequence=useRef(0),mounted=useRef(true),lineNumbers=useRef<HTMLPreElement>(null),sourceInput=useRef<HTMLTextAreaElement>(null),fileInput=useRef<HTMLInputElement>(null),scopeRef=useRef('');
 const editorId=useId(),sourceHintId=useId(),errorId=useId(),importId=useId();
 const user=service.mode==='api'?raw?.users[0]:raw?.users.find(person=>person.id===userId)||raw?.users[0];
 const store=useMemo(()=>raw&&user?scopeStore(raw,user):null,[raw,user]);
 const files=useMemo(()=>store?filesFor(store):[],[store]);
 const file=files.find(item=>item.key===selectedKey)||files[0];
 const dirty=!!draft&&draft.source!==draft.baseline,busy=saving||importing;
 const writable=!!file&&!!user&&(file.target.scope==='global'?user.role==='Owner':canManage(user)&&canAccess(user,file.target.agentId));
 const stale=!!draft&&!!file&&draft.key===file.key&&draft.revision!==file.revision;
 const sourceReady=!!draft&&draft.key===file?.key;
 const global=store?.globalPolicies,globalEnabled=global?enabledCount(global.rules):0;
 const savedSource=file?stringifyPolicyYaml(file.target,file.rules):'';
 const scopeKey=`${user?.id||''}|${file?.key||''}`;scopeRef.current=scopeKey;
 const parsed=useMemo(()=>{if(!draft)return {rules:null,error:''};try{return {rules:parsePolicyYaml(draft.source,draft.target),error:''}}catch(reason){return {rules:null,error:message(reason,'The policy YAML could not be validated.')}}},[draft?.source,draft?.key]);

 async function reload(){const sequence=++loadSequence.current;try{const next=await service.load();if(mounted.current&&sequence===loadSequence.current){setRaw(next);setLoadError('')}return next}catch(reason){if(mounted.current&&sequence===loadSequence.current)setLoadError(message(reason,'The policy workspace could not be loaded.'));return null}finally{if(mounted.current&&sequence===loadSequence.current)setLoading(false)}}
 useEffect(()=>{mounted.current=true;reload();const unsubscribe=service.subscribe(reload);return()=>{mounted.current=false;loadSequence.current++;importSequence.current++;unsubscribe()}},[]);
 useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false)},[dirty,onDirtyChange]);
 useEffect(()=>{onSavingChange?.(busy);return()=>onSavingChange?.(false)},[busy,onSavingChange]);
 useEffect(()=>{if(!dirty)return;const beforeUnload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};window.addEventListener('beforeunload',beforeUnload);return()=>window.removeEventListener('beforeunload',beforeUnload)},[dirty]);
 useEffect(()=>{if(!file){setDraft(null);return}if(!files.some(item=>item.key===selectedKey))setSelectedKey(file.key);setDraft(current=>{if(!current||current.key!==file.key)return draftFor(file);if(current.source!==current.baseline)return current;if(current.baseline!==savedSource||current.revision!==file.revision)return draftFor(file);return current})},[file?.key,file?.revision,savedSource,user?.id]);
 useEffect(()=>{if(lineNumbers.current)lineNumbers.current.style.transform='translateY(0)';if(sourceInput.current)sourceInput.current.scrollTop=0;setError('');setNotice('')},[file?.key]);

 function perform(target:Pending){
  setPending(null);setError('');setNotice('');importSequence.current++;
  if(target.kind==='reset'){if(file)setDraft(draftFor(file));setNotice('The latest saved policy file is loaded.');return}
  setDraft(null);
  if(target.kind==='role'){setUserId(target.userId);setSelectedKey('global')}else setSelectedKey(target.key);
 }
 function navigate(target:Pending){if(busy)return;if(target.kind==='file'&&target.key===file?.key||target.kind==='role'&&target.userId===user?.id)return;if(dirty)setPending(target);else perform(target)}
 function updateSource(source:string){if(!writable||busy)return;setDraft(current=>current?{...current,source}:current);setError('');setNotice('')}
 function validate(){if(parsed.error){setError(parsed.error);setNotice('');sourceInput.current?.focus();return}setError('');setNotice(`Valid YAML · ${parsed.rules?.length||0} rules. ${dirty?'This draft is ready to save.':'The saved file is valid.'}`)}
 function download(){if(!draft||!file)return;const url=URL.createObjectURL(new Blob([draft.source],{type:'application/yaml;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=file.filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice(`Downloaded ${file.filename}${dirty?' from your unsaved draft':''}.`)}
 async function importFile(upload:File){
  if(!writable||busy||!draft)return;setError('');setNotice('');
  if(!/\.ya?ml$/i.test(upload.name)){setError('Choose a .yaml or .yml file.');return}
  if(upload.size>MAX_FILE_SIZE){setError('Policy YAML must be no larger than 64 KiB.');return}
  const sequence=++importSequence.current,currentScope=scopeRef.current,target=draft.target;setImporting(true);
  try{const source=await upload.text();parsePolicyYaml(source,target);if(mounted.current&&sequence===importSequence.current&&currentScope===scopeRef.current){setDraft(current=>current?{...current,source}:current);setNotice(`Imported ${upload.name}. Review this draft, then save to apply it. Saved policies have not changed.`)}}catch(reason){if(mounted.current&&sequence===importSequence.current)setError(message(reason,'The YAML file could not be imported.'))}finally{if(mounted.current&&sequence===importSequence.current)setImporting(false)}
 }
 async function save(){
  if(!draft||!file||!user||!raw||!writable||busy||!dirty)return;
  if(stale){setError('This file changed after you opened it. Download your draft if needed, then load the latest saved version.');return}
  let rules:Guardrail[];try{rules=parsePolicyYaml(draft.source,draft.target)}catch(reason){setError(message(reason,'Validate the YAML before saving.'));return}
  setSaving(true);setError('');setNotice('');let persisted=false;
  try{
   if(draft.target.scope==='global')await service.saveGlobalPolicies({expectedRevision:draft.revision,rules},user.id);
   else{const agent=raw.agents.find(item=>item.id===draft.target.agentId),definition=raw.definitions.find(item=>item.agentId===draft.target.agentId);if(!agent||!definition)throw Error('The selected agent is no longer available. Reload the workspace.');const configuration=configurationFrom(agent,definition);configuration.expectedRevision=draft.revision;configuration.definition.guardrails=rules;await service.saveAgentConfiguration(agent.id,configuration,user.id)}
   persisted=true;const next=await reload();if(!mounted.current)return;
   if(next){const saved=filesFor(next).find(item=>item.key===file.key);if(saved){setDraft(draftFor(saved));setNotice(`${saved.filename} saved · revision ${saved.revision}. ${saved.target.scope==='global'?'These policies apply to every agent.':'Agent Studio and Agent Governance use the same saved rules.'}`)}else setError('Policies were saved, but this file is no longer in the workspace. Refresh the file list.')}else setNotice('Policies were saved. Refresh the workspace to load the latest revision.');
  }catch(reason){if(mounted.current){setError(message(reason,persisted?'Policies were saved, but the latest file could not be loaded.':'The policy file could not be saved. Your draft is preserved.'));await reload()}}finally{if(mounted.current)setSaving(false)}
 }

 if(loading||!store||!user)return <div className="pol-loading" role="status">{loadError?<Info size={30}/>:<Loader2 size={30} className="pol-spin"/>}<h2>{loadError?'Policies are unavailable':'Opening policy workspace'}</h2><p>{loadError||'Loading the rules shared by your agents…'}</p>{loadError&&<button className="pol-btn primary" onClick={()=>{setLoading(true);reload()}}>Retry loading</button>}</div>;
 const visibleFiles=files.filter(item=>(scope==='all'||item.target.scope===scope)&&`${item.filename} ${item.label}`.toLowerCase().includes(query.trim().toLowerCase()));
 const editorRules=sourceReady?parsed.rules:null,editorError=sourceReady?parsed.error:'';
 const editedBy=file?store.users.find(person=>person.id===file.updatedBy)?.name||'Workspace user':'';
 const lineCount=draft?.source.split('\n').length||1;
 return <div className="pol-shell">
  <aside className="pol-sidebar" aria-label="Policy file library">
   <div className="pol-brand"><span><FileCode2 size={24}/></span><div><strong>Policy library</strong><small>Rules for every agent.</small></div></div>
   <div className="pol-library-label">WORKSPACE FILES <span>{files.length}</span></div>
   <label className="pol-search"><Search size={15}/><input aria-label="Search policy files" placeholder="Find a policy file…" value={query} onChange={event=>setQuery(event.target.value)}/></label>
   <div className="pol-file-filters" aria-label="Filter policy files by scope">{(['all','global','agent'] as const).map(value=><button key={value} type="button" aria-pressed={scope===value} className={scope===value?'selected':''} onClick={()=>setScope(value)}>{value==='all'?'All files':value==='global'?'Global':'Agents'}</button>)}</div>
   <nav className="pol-file-list" aria-label="Policy files">{visibleFiles.map(item=><button type="button" key={item.key} className={file?.key===item.key?'selected':''} aria-current={file?.key===item.key?'page':undefined} disabled={busy} onClick={()=>navigate({kind:'file',key:item.key})}><span className={'pol-file-icon '+item.target.scope}>{item.target.scope==='global'?<Globe2 size={18}/>:<FileText size={18}/>}</span><span><strong>{item.filename}</strong><small>{item.label}</small></span><span className="pol-file-count" title={`${enabledCount(item.rules)} enabled rules`}>{enabledCount(item.rules)}</span></button>)}{!visibleFiles.length&&<div className="pol-library-empty"><Search size={20}/><p>No policy files match your filters.</p><button type="button" onClick={()=>{setQuery('');setScope('all')}}>Clear filters</button></div>}</nav>
   <div className="pol-sidebar-note"><ShieldCheck size={18}/><strong>One source of truth</strong><p>Global rules apply to every agent. Agent files add rules for a specific workflow.</p><span>{service.mode==='mock'?'Shared local workspace':'Connected API workspace'}</span></div>
  </aside>
  <div className="pol-workarea">
   <header className="pol-topbar"><div>Lumen workspace <ChevronRight size={14}/><strong>Policies</strong></div><label className="pol-user"><span className="pol-avatar">{initials(user.name)}</span><span><strong>{user.name}</strong><small>{user.role} · {service.mode==='mock'?'Switch role':'Server identity'}</small></span><ChevronDown size={14}/><select aria-label="Current policy workspace user and role" value={user.id} disabled={busy||service.mode!=='mock'} onChange={event=>navigate({kind:'role',userId:event.target.value})}>{store.users.map(person=><option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}</select></label></header>
   <section className="pol-scroll" aria-label="Policy editor workspace">
    <div className="pol-page-heading"><div><span className="pol-eyebrow">DEFINE / INHERIT / ENFORCE</span><h1>Clear rules. Shared boundaries.</h1><p>Manage global and agent policies as readable YAML, with a live preview of every rule.</p></div><button type="button" className="pol-icon-btn" aria-label="Refresh saved policy workspace" title="Refresh saved policy workspace" disabled={busy} onClick={reload}><RefreshCw size={17}/></button></div>
    {loadError&&<div className="pol-feedback error" role="alert"><Info size={16}/><span>{loadError}</span><button type="button" disabled={busy} onClick={reload}>Retry</button></div>}
    {!global&&<div className="pol-feedback warning" role="status"><Info size={16}/><span>Global policies are unavailable in the current workspace response. Refresh the workspace or check the backend policy endpoint.</span></div>}
    {!file||!sourceReady?<div className="pol-empty"><FileCode2 size={32}/><h2>{file?'Opening policy file':'No policy files available'}</h2><p>{file?'Preparing the saved YAML configuration…':'There are no policy files in your current workspace scope.'}</p></div>:<>
     <div className="pol-file-heading"><div><span className={'pol-file-icon '+file.target.scope}>{file.target.scope==='global'?<Globe2 size={22}/>:<FileCode2 size={22}/>}</span><div><div className="pol-file-path">policies / {file.target.scope==='agent'?'agents / ':''}<strong>{file.filename}</strong></div><h2>{file.target.scope==='global'?'Global policies':file.label}</h2></div></div><span className={'pol-access '+(writable?'editable':'')}><LockKeyhole size={12}/>{writable?'Editable':'Read only'}</span></div>
     <div className="pol-summary-grid"><div><span><ShieldCheck size={14}/>Enabled in this file</span><strong>{editorRules?enabledCount(editorRules):'—'}<small>of {editorRules?editorRules.length:'—'} rules</small></strong></div><div><span><Layers3 size={14}/>{file.target.scope==='global'?'Applies to':'Inherited global rules'}</span><strong>{file.target.scope==='global'?'Every agent':global?globalEnabled:'—'}<small>{file.target.scope==='global'?'across the workspace':global?'enabled across all agents':'unavailable'}</small></strong></div><div><span><Code2 size={14}/>Saved revision</span><strong>{draft.revision}<small>{dirty?'Unsaved changes':'Up to date'}</small></strong></div></div>
     {!writable&&<div className="pol-feedback info"><LockKeyhole size={16}/><span>{file.target.scope==='global'?'Only the workspace owner can edit global policies. You can inspect and download this file.':'Only the owner and assigned admins can edit this agent’s policies. You can inspect and download this file.'}</span></div>}
     {stale&&<div className="pol-feedback warning" role="status"><Info size={16}/><span>A newer revision ({file.revision}) is available. Your draft is preserved. Download it if needed, then load the latest version before saving.</span><button type="button" disabled={busy} onClick={()=>navigate({kind:'reset'})}>Load latest</button></div>}
     {error&&<div className="pol-feedback error" role="alert"><Info size={16}/><span>{error}</span><button type="button" aria-label="Dismiss policy error" onClick={()=>setError('')}><X size={15}/></button></div>}
     {notice&&<div className="pol-feedback success" role="status"><Check size={16}/><span>{notice}</span><button type="button" aria-label="Dismiss policy notice" onClick={()=>setNotice('')}><X size={15}/></button></div>}
     <div className="pol-editor-layout">
      <section className="pol-editor-card" aria-label={`${file.filename} editor`}>
       <div className="pol-editor-heading"><div><FileCode2 size={16}/><label htmlFor={editorId}>{file.filename}</label><span className="pol-language">YAML</span></div><span className={'pol-save-status '+(dirty?'dirty':'')}><i/>{dirty?'Unsaved changes':'Saved'}</span></div>
       <div className="pol-editor-toolbar"><div><button type="button" className="pol-btn" onClick={download}><Download size={14}/>Download YAML</button><button type="button" className="pol-btn" disabled={!writable||busy} onClick={()=>fileInput.current?.click()}><Upload size={14}/>{importing?'Importing…':'Import YAML'}</button><input id={importId} ref={fileInput} type="file" accept=".yaml,.yml,application/yaml,text/yaml" hidden aria-label="Import a policy YAML file" onChange={event=>{const upload=event.target.files?.[0];event.target.value='';if(upload)importFile(upload)}}/></div><button type="button" className="pol-btn" onClick={validate} disabled={busy}><CheckCheck size={14}/>Validate</button></div>
       <div className={'pol-code-editor '+(editorError?'invalid':'')}><div className="pol-line-gutter" aria-hidden="true"><pre ref={lineNumbers}>{Array.from({length:lineCount},(_,index)=>index+1).join('\n')}</pre></div><textarea id={editorId} ref={sourceInput} aria-label={`${file.filename} YAML source`} aria-describedby={`${sourceHintId}${editorError?` ${errorId}`:''}`} aria-invalid={!!editorError} value={draft.source} maxLength={MAX_FILE_SIZE} readOnly={!writable||busy} spellCheck={false} autoCapitalize="off" autoComplete="off" autoCorrect="off" wrap="off" onChange={event=>updateSource(event.target.value)} onScroll={event=>{if(lineNumbers.current)lineNumbers.current.style.transform=`translateY(-${event.currentTarget.scrollTop}px)`}}/></div>
       <div className={'pol-editor-status '+(editorError?'invalid':'')}><span>{editorError?<Info size={13}/>:<Check size={13}/>} {editorError?'YAML needs attention':'YAML is valid'}</span><span>{lineCount} lines · {new TextEncoder().encode(draft.source).byteLength.toLocaleString()} / 65,536 bytes</span></div>
       {editorError&&<p id={errorId} className="pol-inline-error">{editorError}</p>}
       <div className="pol-editor-footer"><p id={sourceHintId}>{file.target.scope==='global'?'Saving updates policies inherited by every agent.':'Saving updates this agent’s rules. Global policies remain inherited.'}<small>YAML is generated from shared policy data; formatting is standardized on save.</small></p><div><button type="button" className="pol-btn" disabled={busy||!dirty} onClick={()=>navigate({kind:'reset'})}><RotateCcw size={14}/>Reset draft</button><button type="button" className="pol-btn primary" disabled={!writable||busy||!dirty||stale||!!editorError} onClick={save}>{saving?<Loader2 size={15} className="pol-spin"/>:<Save size={15}/>} {saving?'Saving…':'Save changes'}</button></div></div>
      </section>
      <aside className="pol-preview" aria-label="Parsed policy preview"><div className="pol-preview-heading"><span><ShieldCheck size={17}/></span><div><h3>Rule preview</h3><p>{dirty?'Reflects your current draft':'Reflects the saved file'}</p></div><span>{editorRules?.length??'—'}</span></div><div className="pol-preview-rules">{editorRules?editorRules.length?editorRules.map(rule=><RulePreview key={rule.id} rule={rule}/>):<div className="pol-preview-empty"><ShieldCheck size={25}/><strong>No rules in this file</strong><p>{file.target.scope==='agent'?'Enabled global policies still apply to this agent.':'No global rules are configured. Agent-specific rules remain in their own files.'}</p></div>:<div className="pol-preview-empty"><Info size={25}/><strong>Preview needs valid YAML</strong><p>Fix the source error to see the exact rules in this draft.</p></div>}</div>
       {file.target.scope==='agent'&&<div className="pol-inheritance"><div><Globe2 size={17}/><strong>Inherited from global.yaml</strong></div><p>{global?`${globalEnabled} enabled global ${globalEnabled===1?'rule applies':'rules apply'} in addition to this file, even when the agent file is empty.`:'Global policies are unavailable in this workspace response.'} Runtime approval settings also apply.</p>{global&&<details><summary>View inherited rules <ChevronDown size={13}/></summary><div>{global.rules.length?global.rules.map(rule=><RulePreview key={rule.id} rule={rule} inherited/>):<p>No global rules are configured.</p>}</div></details>}<button type="button" disabled={busy||!global} onClick={()=>navigate({kind:'file',key:'global'})}>Open global.yaml <ArrowUpRight size={13}/></button></div>}
      </aside>
     </div>
     <details className="pol-format-guide"><summary><Info size={15}/><strong>Policy file reference</strong><span>Schema, stages, and actions</span><ChevronDown size={15}/></summary><div><section><h3>Document scope</h3><p>Keep <code>version: 1</code> and <code>scope: {file.target.scope}</code>. {file.target.scope==='agent'?<>This file also requires <code>agent_id: {file.target.agentId}</code>. </>:null}Use a <code>policies</code> list with up to 30 rules. Imports must match the selected file’s scope.</p></section><section><h3>Every rule</h3><p>Provide <code>id</code>, <code>name</code>, <code>description</code>, <code>enabled</code>, <code>stage</code>, <code>action</code>, and <code>severity</code>. IDs and names must be unique in each file. Set <code>enabled: false</code> to retain a rule without enforcing it.</p></section><section><h3>Evaluation and action</h3><p>Stages: <b>Input</b>, <b>Tool</b>, <b>Output</b>. Actions: <b>Block</b>, <b>Require approval</b>, <b>Flag</b>. Severity: <b>Low</b>, <b>Medium</b>, <b>High</b>, <b>Critical</b>. YAML aliases, anchors, and custom fields are not supported.</p></section></div></details>
     <footer className="pol-file-footer"><span>Saved {date(file.updatedAt)} by {editedBy} · revision {file.revision}</span>{file.target.scope==='agent'&&onConfigureAgent&&<button type="button" disabled={busy} onClick={()=>onConfigureAgent(file.target.agentId!)}>Configure agent <ArrowUpRight size={13}/></button>}<span>{service.mode==='mock'?'Shared local workspace':'Shared API workspace'}</span></footer>
    </>}
   </section>
  </div>
  {pending&&<DiscardDialog onCancel={()=>setPending(null)} onDiscard={()=>perform(pending)} reset={pending.kind==='reset'} filename={file?.filename||'this policy file'}/>}
 </div>;
}

function DiscardDialog({onCancel,onDiscard,reset,filename}:{onCancel:()=>void;onDiscard:()=>void;reset:boolean;filename:string}){
 const dialog=useRef<HTMLDialogElement>(null),titleId=useId(),descriptionId=useId();useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();return()=>{dialog.current?.close();previous?.focus()}},[]);
 return <dialog ref={dialog} className="pol-discard-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event=>{event.preventDefault();onCancel()}}><span className="pol-discard-icon"><RotateCcw size={23}/></span><h2 id={titleId}>{reset?'Reset this policy draft?':'Unsaved policy changes'}</h2><p id={descriptionId}>{reset?`Discard your edits to ${filename} and load its latest saved revision?`:`Your edits to ${filename} have not been saved. Keep editing, or discard this draft to continue.`}</p><div><button type="button" className="pol-btn" autoFocus onClick={onCancel}>Keep editing</button><button type="button" className="pol-btn danger" onClick={onDiscard}>Discard changes</button></div></dialog>;
}
