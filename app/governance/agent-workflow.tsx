'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {ArrowRight,Check,GitBranch,List,Network} from 'lucide-react';
import type {Agent,AgentDefinition} from '../../lib/governance/types';
import AgentGraph from '../studio/graph';
import './agent-workflow.css';

/** Read directly from the same saved definition as Studio; never reconstruct from run traces. */
export default function AgentWorkflow({definition,agents}:{definition:AgentDefinition;agents:Agent[]}){
 const [selectedId,setSelectedId]=useState<string|null>(null),[view,setView]=useState<'graph'|'list'>('graph');
 const inspector=useRef<HTMLElement>(null),heading=useId();
 const {nodes,edges}=definition;
 const selected=nodes.find(n=>n.id===selectedId)||nodes.find(n=>n.kind==='Agent')||nodes[0];
 useEffect(()=>{if(selectedId&&!nodes.some(n=>n.id===selectedId))setSelectedId(null)},[nodes,selectedId]);
 const name=(id:string)=>nodes.find(n=>n.id===id)?.label||id;
 const incoming=edges.filter(e=>e.target===selected?.id),outgoing=edges.filter(e=>e.source===selected?.id);
 const inspect=(id:string)=>{setSelectedId(id);requestAnimationFrame(()=>{inspector.current?.scrollIntoView({block:'nearest',behavior:'smooth'});inspector.current?.focus({preventScroll:true})})};
 return <section className="gov-workflow" aria-label="Saved agent workflow">
  <div className="gov-workflow-heading"><div><h3><Network size={18}/> Saved workflow</h3><p>Inspect the nodes and directed connections saved in Agent Studio.</p></div><span className="gov-workflow-revision"><Check size={14}/> Revision {definition.revision}</span></div>
  <div className="gov-workflow-toolbar"><span>{nodes.length} nodes · {nodes.filter(n=>n.enabled).length} enabled · {edges.length} connections</span><div className="studio-view-toggle" role="group" aria-label="Workflow presentation"><button onClick={()=>setView('graph')} aria-pressed={view==='graph'} className={view==='graph'?'active':''}><Network size={14}/> Graph</button><button onClick={()=>setView('list')} aria-pressed={view==='list'} className={view==='list'?'active':''}><List size={14}/> List</button></div></div>
  {view==='graph'?<AgentGraph readOnly nodes={nodes} edges={edges} selectedId={selected?.id||null} onSelect={setSelectedId} onOpen={inspect}/>:<div className="gov-workflow-node-list">{nodes.map(node=><button key={node.id} aria-pressed={selected?.id===node.id} onClick={()=>setSelectedId(node.id)}><span><strong>{node.label}</strong><small>{node.kind} · {node.id}</small></span><span>{node.enabled?'Enabled':'Disabled'}</span></button>)}{!nodes.length&&<p>No nodes saved for this agent.</p>}</div>}
  {selected&&<section className="gov-workflow-inspector" ref={inspector} tabIndex={-1} aria-labelledby={heading}>
   <div className="gov-workflow-heading"><div><span className="gov-kicker">NODE INSPECTOR · {selected.kind.toUpperCase()}</span><h3 id={heading}>{selected.label}</h3><code>{selected.id}</code></div><span className={'gov-badge '+(selected.enabled?'green':'neutral')}>{selected.enabled?'Enabled':'Disabled'}</span></div>
   <p>{selected.description||'No description configured.'}</p>
   {!selected.enabled&&<p className="gov-workflow-note">This node is disabled. The executor bypasses it while following its outgoing connections.</p>}
   <dl className="gov-detail-list"><dt>Tool binding</dt><dd>{selected.toolName||'None'}</dd><dt>Linked agent</dt><dd>{selected.referencedAgentId?<>{agents.find(a=>a.id===selected.referencedAgentId)?.name||'Agent outside your scope'} <code>{selected.referencedAgentId}</code></>:'None'}</dd></dl>
   <h4>Node instructions</h4><pre className="gov-workflow-prompt">{selected.prompt||'No node-specific instructions. The executor uses the saved agent settings and this node’s behavior.'}</pre>
   <div className="gov-workflow-links">{[{label:'Incoming',items:incoming,other:'source' as const},{label:'Outgoing',items:outgoing,other:'target' as const}].map(group=><div key={group.label}><h4>{group.label} · {group.items.length}</h4>{group.items.map(edge=><button key={edge.id} onClick={()=>setSelectedId(edge[group.other])}><span><strong>{name(edge[group.other])}</strong><small>{edge.label||'Unlabeled connection'}</small></span><ArrowRight size={14}/></button>)}{!group.items.length&&<p className="gov-muted">No {group.label.toLowerCase()} connections.</p>}</div>)}</div>
  </section>}
  <section className="gov-workflow-connections"><h3><GitBranch size={17}/> Connections <span>{edges.length}</span></h3><div className="gov-table-wrap"><table className="gov-table"><thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col">Label / connection ID</th></tr></thead><tbody>{edges.map(edge=><tr key={edge.id} className={edge.source===selected?.id||edge.target===selected?.id?'gov-workflow-connected':''}><td><button className="gov-link" onClick={()=>inspect(edge.source)}>{name(edge.source)}</button><small>{edge.source}</small></td><td><button className="gov-link" onClick={()=>inspect(edge.target)}>{name(edge.target)}</button><small>{edge.target}</small></td><td>{edge.label||'Unlabeled'}<small>{edge.id}</small></td></tr>)}</tbody></table></div>{!edges.length&&<p className="gov-muted">No connections saved for this agent.</p>}</section>
  <p className="gov-workflow-note">This is the current saved definition. Unsaved Studio edits stay in Studio. Run timelines retain the node details and configuration revision recorded during execution.</p>
 </section>;
}
