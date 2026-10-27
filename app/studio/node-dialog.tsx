'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import {Info,Save,Settings2,X} from 'lucide-react';
import type {Agent,AgentConfiguration,AgentNode} from '../../lib/governance/types';
import {isGenerationNode,nodeEditorIntroduction} from '../../lib/agent-execution/presentation';
import {agentBaseUrl} from '../../lib/models.mjs';

type Props={node:AgentNode;draft:AgentConfiguration;agents:Agent[];disabled:boolean;saving:boolean;dirty:boolean;running:boolean;error:string;onChange:(value:Partial<AgentNode>)=>void;onSave:()=>void;onClose:()=>void;children:ReactNode};
const kinds:AgentNode['kind'][]=['Input','Agent','Sub-agent','Tool','Guardrail','Memory','Output'];
export default function NodeDialog({node,draft,agents,disabled,saving,dirty,running,error,onChange,onSave,onClose,children}:Props){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;ref.current?.showModal();return()=>{ref.current?.close();previous?.focus()}},[]);
 return <dialog className="studio-node-dialog" ref={ref} aria-label={`Configure ${node.label}`} onCancel={e=>{e.preventDefault();if(!running&&!saving)onClose()}}>
  <header><div><span><Settings2 size={21}/></span><div><small>{node.kind.toUpperCase()} · {node.id}</small><h2>{node.label}</h2></div></div><button className="studio-icon" aria-label="Close node editor" disabled={running||saving} onClick={onClose}><X size={20}/></button></header>
  <div className="studio-node-dialog-body">
   <p className="studio-node-dialog-intro">{nodeEditorIntroduction(node.kind)}</p>
   {error&&<div className="studio-feedback error" role="alert"><Info size={16}/><span>{error}</span></div>}
   <fieldset className="studio-fieldset" disabled={disabled}>
    <div className="studio-form-grid"><label className="studio-field"><span>Node name</span><input value={node.label} maxLength={100} onChange={e=>onChange({label:e.target.value})}/></label><label className="studio-field"><span>Node type</span><select value={node.kind} onChange={e=>{const kind=e.target.value as AgentNode['kind'];onChange({kind,...(kind==='Tool'?{toolName:draft.agent.tools[0]}:{toolName:undefined}),...(kind!=='Sub-agent'?{referencedAgentId:undefined}:{})})}}>{kinds.map(kind=><option key={kind}>{kind}</option>)}</select></label><label className="studio-field wide"><span>Responsibility</span><textarea rows={3} maxLength={2000} value={node.description} onChange={e=>onChange({description:e.target.value})}/></label>
    {node.kind==='Tool'&&<label className="studio-field wide"><span>Tool capability</span><select value={node.toolName||''} onChange={e=>onChange({toolName:e.target.value})}><option value="">Choose a capability</option>{draft.agent.tools.map(tool=><option key={tool}>{tool}</option>)}</select><small>Tool tests execute local functions. External services are not connected.</small></label>}
    {node.kind==='Sub-agent'&&<label className="studio-field wide"><span>Linked agent</span><select value={node.referencedAgentId||''} onChange={e=>onChange({referencedAgentId:e.target.value||undefined})}><option value="">Local specialist role</option>{agents.map(agent=><option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><small>A linked agent contributes its saved model and prompt as this specialist’s role.</small></label>}
    {['Agent','Sub-agent'].includes(node.kind)&&<label className="studio-field wide"><span>Node instructions</span><textarea className="studio-prompt-input" rows={6} maxLength={8000} value={node.prompt} onChange={e=>onChange({prompt:e.target.value})}/><small>These instructions are combined with the saved agent prompt and incoming context.</small></label>}
    </div><label className="studio-node-enabled"><input type="checkbox" checked={node.enabled} onChange={e=>onChange({enabled:e.target.checked})}/> Enable this node</label>
   </fieldset>
   <details className="studio-node-context"><summary>Parent agent configuration</summary><dl><dt>{isGenerationNode(node.kind)?'Parent generation model':'Policy evaluation model'}</dt><dd>{draft.definition.model.name}{!isGenerationNode(node.kind)&&' · policy temperature 0, when checks apply'}</dd><dt>Base URL</dt><dd><code>{agentBaseUrl(draft.definition.model)||'Select a valid Nebius endpoint in Runtime.'}</code></dd><dt>System instructions</dt><dd><pre>{draft.definition.prompt.system}</pre></dd><dt>Goal</dt><dd>{draft.definition.prompt.goal}</dd><dt>Output format</dt><dd>{draft.definition.prompt.outputFormat}</dd>{node.kind==='Memory'&&<><dt>Memory</dt><dd>{draft.definition.memory.enabled?'Enabled':'Disabled'} · {draft.definition.memory.strategy} · {draft.definition.memory.scope} scope. Live execution keeps context within this run; persistent storage is not connected.</dd></>}{node.kind==='Guardrail'&&<><dt>Enabled guardrails</dt><dd>{draft.definition.guardrails.filter(g=>g.enabled).length?draft.definition.guardrails.filter(g=>g.enabled).map(g=><p key={g.id}><strong>{g.name}</strong> · {g.stage} · {g.action}<br/>{g.description}</p>):'No guardrails are enabled.'}</dd></>}</dl></details>
   <div className="studio-node-save"><span>{dirty?'Save all configuration changes before testing.':'Saved configuration is ready for testing.'}</span><button className="studio-btn primary" disabled={disabled||!dirty} onClick={onSave}><Save size={15}/>{saving?'Saving…':'Save configuration'}</button></div>
   {children}
  </div>
 </dialog>;
}
