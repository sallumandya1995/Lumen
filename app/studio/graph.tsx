'use client';

import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {Bot,BrainCircuit,ChevronRight,Flag,GitBranch,LogIn,Maximize2,Minus,Plus,ShieldCheck,Wrench} from 'lucide-react';
import type {AgentNode,AgentEdge} from '../../lib/governance/types';
import './studio.css';

type Props={nodes:AgentNode[];edges:AgentEdge[];selectedId:string|null;onSelect:(id:string)=>void;onOpen?:(id:string)=>void;nodeStates?:Record<string,string>;readOnly?:boolean};
type Placed=AgentNode&{x:number;y:number;layer:number};
const CARD_W=206,CARD_H=108,GAP_X=86,GAP_Y=35,PAD=42;
const appearance:Record<AgentNode['kind'],{fill:string;stroke:string;accent:string;icon:typeof Bot}>={
 Input:{fill:'#f3f7fa',stroke:'#ccdce5',accent:'#547b90',icon:LogIn},
 Agent:{fill:'#f3f9df',stroke:'#b6cd7e',accent:'#648b2f',icon:Bot},
 'Sub-agent':{fill:'#f5f0fc',stroke:'#d4c5e8',accent:'#8a6eaa',icon:GitBranch},
 Tool:{fill:'#edf5fd',stroke:'#c3d8e9',accent:'#4e84ac',icon:Wrench},
 Guardrail:{fill:'#fff2ed',stroke:'#e5c8b9',accent:'#ba7e58',icon:ShieldCheck},
 Memory:{fill:'#eaf6f2',stroke:'#bcded2',accent:'#568f7b',icon:BrainCircuit},
 Output:{fill:'#f1f7e9',stroke:'#ccdcb6',accent:'#6d9251',icon:Flag},
};

function wrapLabel(label:string):string[]{
 const words=label.trim().split(/\s+/),lines:string[]=[];let line='';
 for(const word of words){if((line+' '+word).trim().length>23&&line){lines.push(line);line=word}else line=(line+' '+word).trim()}
 if(line)lines.push(line);
 return lines.slice(0,2).map((value,index)=>value.length>24?value.slice(0,23)+'…':index===1&&lines.length>2?value.slice(0,22)+'…':value);
}

/** A deterministic DAG layout. Invalid draft edges stay editable without breaking the canvas. */
function layoutGraph(nodes:AgentNode[],edges:AgentEdge[]){
 const byId=new Map(nodes.map(n=>[n.id,n])),indegree=new Map(nodes.map(n=>[n.id,0]));
 const valid=edges.filter(e=>byId.has(e.source)&&byId.has(e.target));
 for(const edge of valid)indegree.set(edge.target,(indegree.get(edge.target)||0)+1);
 const layers=new Map(nodes.map(n=>[n.id,0])),queue=nodes.filter(n=>indegree.get(n.id)===0).map(n=>n.id),visited=new Set<string>();
 while(queue.length){const id=queue.shift()!;if(visited.has(id))continue;visited.add(id);for(const edge of valid.filter(e=>e.source===id)){layers.set(edge.target,Math.max(layers.get(edge.target)||0,(layers.get(id)||0)+1));indegree.set(edge.target,(indegree.get(edge.target)||0)-1);if(indegree.get(edge.target)===0)queue.push(edge.target)}}
 // Cycles can exist briefly while editing. Group the remaining nodes after the valid portion.
 const last=Math.max(0,...layers.values());let unresolved=0;
 for(const node of nodes)if(!visited.has(node.id))layers.set(node.id,last+1+Math.floor(unresolved++/3));
 const groups=new Map<number,AgentNode[]>();
 for(const node of nodes){const layer=layers.get(node.id)||0;groups.set(layer,[...(groups.get(layer)||[]),node])}
 const maxRows=Math.max(1,...Array.from(groups.values()).map(group=>group.length));
 const height=PAD*2+maxRows*CARD_H+(maxRows-1)*GAP_Y;
 const placed:Placed[]=[];
 for(const [layer,group] of groups){const groupHeight=group.length*CARD_H+(group.length-1)*GAP_Y;group.forEach((node,index)=>placed.push({...node,layer,x:PAD+layer*(CARD_W+GAP_X),y:(height-groupHeight)/2+index*(CARD_H+GAP_Y)}))}
 return {nodes:placed,edges:valid,width:PAD*2+(Math.max(0,...groups.keys())+1)*CARD_W+Math.max(0,...groups.keys())*GAP_X,height,hasCycle:unresolved>0};
}

export default function AgentGraph({nodes,edges,selectedId,onSelect,onOpen,nodeStates={},readOnly=false}:Props){
 const id=useId().replace(/:/g,''),viewport=useRef<HTMLDivElement>(null),nodeRefs=useRef<Record<string,SVGGElement|null>>({});
 const [zoom,setZoom]=useState(1),[dimensions,setDimensions]=useState({width:800,height:420});
 const graph=useMemo(()=>layoutGraph(nodes,edges),[nodes,edges]),positions=new Map(graph.nodes.map(n=>[n.id,n]));
 const displayHeight=Math.max(380,Math.min(560,graph.height+30)),focusId=selectedId&&positions.has(selectedId)?selectedId:graph.nodes[0]?.id;
 useEffect(()=>{const el=viewport.current;if(!el)return;const observer=new ResizeObserver(entries=>{const box=entries[0]?.contentRect;if(box)setDimensions({width:box.width,height:box.height})});observer.observe(el);return()=>observer.disconnect()},[]);
 function fit(){setZoom(Math.min(1.25,Math.max(.2,Math.min((dimensions.width-24)/graph.width,(dimensions.height-24)/graph.height))));viewport.current?.scrollTo({left:0,top:0,behavior:'smooth'})}
 function focusNode(nodeId:string){onSelect(nodeId);requestAnimationFrame(()=>nodeRefs.current[nodeId]?.focus())}
 function onNodeKey(event:React.KeyboardEvent<SVGGElement>,node:Placed){
  if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect(node.id);if(event.key==='Enter')onOpen?.(node.id);return}
  if(event.key==='Home'||event.key==='End'){event.preventDefault();const target=event.key==='Home'?graph.nodes[0]:graph.nodes[graph.nodes.length-1];if(target)focusNode(target.id);return}
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
  event.preventDefault();const horizontal=event.key==='ArrowLeft'||event.key==='ArrowRight',sign=event.key==='ArrowRight'||event.key==='ArrowDown'?1:-1;
  const candidates=graph.nodes.filter(n=>n.id!==node.id&&(horizontal?(n.x-node.x)*sign>0:(n.y-node.y)*sign>0));
  candidates.sort((a,b)=>{const score=(n:Placed)=>horizontal?Math.abs(n.x-node.x)+Math.abs(n.y-node.y)*.65:Math.abs(n.y-node.y)+Math.abs(n.x-node.x)*2;return score(a)-score(b)});
  if(candidates[0])focusNode(candidates[0].id);
 }
 const kinds=Array.from(new Set(nodes.map(n=>n.kind)));
 if(!nodes.length)return <div className="studio-graph-empty"><GitBranch size={30}/><strong>{readOnly?'No saved nodes':'Your workflow starts here'}</strong><p>{readOnly?'No graph nodes are available for this definition.':'Add a node to begin defining this agent’s graph.'}</p></div>;
 return <div className="studio-graph-shell">
  <div className="studio-graph-controls"><div className="studio-graph-context"><span className="studio-graph-live-dot"/><span>Definition graph</span><ChevronRight size={13}/><strong>{nodes.length} nodes · {edges.length} connections</strong></div><div className="studio-graph-zoom"><button type="button" aria-label="Zoom out of graph" disabled={zoom<=.2} onClick={()=>setZoom(value=>Math.max(.2,Math.round((value-.15)*100)/100))}><Minus size={15}/></button><output aria-label="Graph zoom">{Math.round(zoom*100)}%</output><button type="button" aria-label="Zoom into graph" disabled={zoom>=1.75} onClick={()=>setZoom(value=>Math.min(1.75,Math.round((value+.15)*100)/100))}><Plus size={15}/></button><button type="button" className="studio-graph-fit" onClick={fit}><Maximize2 size={14}/> Fit view</button></div></div>
  <div ref={viewport} className="studio-graph-viewport" style={{height:displayHeight}} aria-label="Agent workflow graph. Scroll to explore or use Fit view.">
   <svg width={Math.max(graph.width*zoom,dimensions.width-2)} height={Math.max(graph.height*zoom,displayHeight-2)} role="group" aria-label={readOnly?'Saved agent graph':'Configurable agent graph'} style={{display:'block',overflow:'visible'}}>
    <defs><marker id={`${id}-arrow`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 1 1 L 7 4 L 1 7" fill="none" stroke="#8da8b4" strokeWidth="1.4"/></marker><marker id={`${id}-active-arrow`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 1 1 L 7 4 L 1 7" fill="none" stroke="#8ba950" strokeWidth="1.4"/></marker><filter id={`${id}-shadow`} x="-10%" y="-15%" width="120%" height="135%"><feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#183c4e" floodOpacity=".06"/></filter></defs>
    <g transform={`translate(${Math.max(0,(dimensions.width-graph.width*zoom)/2)},${Math.max(0,(displayHeight-graph.height*zoom)/2)}) scale(${zoom})`}>
     {graph.edges.map(edge=>{const source=positions.get(edge.source)!,target=positions.get(edge.target)!,active=source.id===selectedId||target.id===selectedId,x1=source.x+CARD_W+1,y1=source.y+CARD_H/2,x2=target.x-2,y2=target.y+CARD_H/2;const forward=x2>x1;const bend=Math.max(30,Math.abs(x2-x1)*.48);const path=forward?`M ${x1} ${y1} C ${x1+bend} ${y1},${x2-bend} ${y2},${x2} ${y2}`:`M ${x1} ${y1} C ${x1+55} ${y1-100},${x2-55} ${y2-100},${x2} ${y2}`;const label=edge.label.length>20?edge.label.slice(0,19)+'…':edge.label;return <g className={'studio-graph-edge '+(active?'active':'')} key={edge.id} opacity={source.enabled&&target.enabled?1:.45}><title>{`${source.label} → ${target.label}${edge.label?`: ${edge.label}`:''}`}</title><path d={path} fill="none" stroke={active?'#8ba950':'#b6c8cf'} strokeWidth={active?2.2:1.6} strokeDasharray={!source.enabled||!target.enabled?'5 5':undefined} markerEnd={`url(#${id}-${active?'active-arrow':'arrow'})`}/>{label&&forward&&<g transform={`translate(${(x1+x2)/2},${(y1+y2)/2-11})`}><rect x={-Math.max(18,label.length*3.2)} y="-9" width={Math.max(36,label.length*6.4)} height="17" rx="6" fill="#f4f8f9"/><text textAnchor="middle" dominantBaseline="middle" fontSize="10" fill={active?'#69813e':'#78919c'}>{label}</text></g>}</g>})}
     {graph.nodes.map(node=>{const theme=appearance[node.kind],Icon=theme.icon,selected=selectedId===node.id,status=nodeStates[node.id],stateColor=status==='Running'?'#3d81ba':status==='Success'?'#678f35':['Failed','Blocked','Cancelled'].includes(status)?'#b35f64':status==='Awaiting approval'?'#b78835':theme.accent,lines=wrapLabel(node.label||'Untitled node');return <g key={node.id} ref={el=>{nodeRefs.current[node.id]=el}} transform={`translate(${node.x},${node.y})`} className={'studio-graph-node '+(selected?'selected':'')+(!node.enabled?' disabled':'')+(status==='Running'?' is-running':'')} role="button" tabIndex={focusId===node.id?0:-1} aria-label={`${node.label}, ${node.kind}${node.enabled?'':', disabled'}. ${status||'Ready'}. ${readOnly?'Select to inspect.':'Double-click or press Enter to edit and test.'}`} aria-pressed={selected} onClick={()=>onSelect(node.id)} onDoubleClick={()=>onOpen?.(node.id)} onKeyDown={event=>onNodeKey(event,node)} style={{cursor:'pointer',outline:'none',opacity:node.enabled?1:.55}}>
      <title>{`${node.label} · ${node.kind}${node.description?`\n${node.description}`:''}`}</title><rect className="studio-graph-focus-ring" x="-5" y="-5" width={CARD_W+10} height={CARD_H+10} rx="18" fill="none" stroke="#839e42" strokeWidth="2" opacity="0"/><rect width={CARD_W} height={CARD_H} rx="14" fill={selected?theme.fill:'#ffffff'} stroke={status?stateColor:selected?theme.accent:theme.stroke} strokeWidth={status||selected?2:1.2} filter={`url(#${id}-shadow)`}/><rect x="13" y="14" width="29" height="29" rx="8" fill={theme.fill} stroke={theme.stroke} strokeWidth=".8"/><Icon x="20" y="21" width="15" height="15" color={theme.accent} strokeWidth="1.7"/><text x="51" y="28" fontSize="10" fontWeight="650" fill={theme.accent} letterSpacing=".8">{node.kind.toUpperCase()}</text><circle cx={CARD_W-19} cy="26" r="3" fill={node.enabled?stateColor:'#aebbc1'}/>{lines.map((line,index)=><text key={index} x="15" y={63+index*17} fontSize="13" fontWeight="600" fill="#244b5e">{line}</text>)}<text x="15" y="96" fontSize="10" fill="#78909b">{status|| (node.kind==='Tool'?node.toolName||'Select a tool':node.kind==='Sub-agent'?(node.referencedAgentId?'Linked agent':'Specialist worker'):node.enabled?'Enabled':'Disabled')}</text><circle cx="0" cy={CARD_H/2} r="3.3" fill="#fff" stroke={theme.stroke} strokeWidth="1.5"/><circle cx={CARD_W} cy={CARD_H/2} r="3.3" fill="#fff" stroke={theme.stroke} strokeWidth="1.5"/>
     </g>})}
    </g>
   </svg>
  </div>
  <div className="studio-graph-legend"><div>{kinds.map(kind=><span key={kind}><i style={{background:appearance[kind].accent}}/>{kind}</span>)}</div><span>{graph.hasCycle?'Cycle in draft · remove it before saving':readOnly?'Select a node to inspect · arrow keys to explore':'Double-click or Enter to edit & test · arrow keys to explore'}</span></div>
 </div>;
}
