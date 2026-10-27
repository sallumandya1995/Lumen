'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {ArrowUpRight,Check,ChevronDown,Clock,Download,Info,Loader2,Play,Square,Terminal} from 'lucide-react';
import {runAgentExecution} from '../../lib/agent-execution/client';
import {sampleExecutionInput} from '../../lib/agent-execution/sample-inputs';
import {isGenerationNode,nodeOutputLabel,nodeTestExplanation} from '../../lib/agent-execution/presentation';
import {END_TO_END_DEMO_ID} from '../../lib/governance/end-to-end-demo';
import type {ExecutionEvent,ExecutionRequest,ExecutionResult,NodeExecution} from '../../lib/agent-execution/types';
import {governanceService} from '../../lib/governance/service';
import {agentBaseUrl} from '../../lib/models.mjs';

type Props={request:Omit<ExecutionRequest,'input'>;userId:string;blockedReason?:string;onTryExample?:()=>void;onRunningChange:(running:boolean)=>void;onProgress:(nodeId:string,status:string)=>void;onGovern:(runId?:string)=>void};
const statusClass=(value:string)=>value.toLowerCase().replaceAll(' ','-');
const exampleNodeLabels:Record<string,string>={'Demo support case':'Support case','Read demo CRM context':'Read account context','Completed demo memo':'Completed memo'};
const passedThrough=(node:NodeExecution)=>node.status==='Success'&&!isGenerationNode(node.kind)&&node.input===node.output;
const outputLabel=(node:NodeExecution)=>node.status!=='Success'?'Output':node.kind==='Input'&&!passedThrough(node)?'Accepted input':nodeOutputLabel(node.kind);
const connectionSnippet=(model:string,baseUrl:string)=>`base_url=${JSON.stringify(baseUrl)}\nmodel=${JSON.stringify(model)}`;
function TokenUsage({value}:{value:Pick<NodeExecution,'tokens'|'tokenUsage'>}){
 return <span className="studio-token-usage"><span>Total model tokens: {value.tokens.toLocaleString()} <small>(prompt + response)</small></span>{value.tokenUsage&&<small>Generation {value.tokenUsage.generation.toLocaleString()} · Policy {value.tokenUsage.policy.toLocaleString()}</small>}</span>;
}
function PolicyChecks({node}:{node:NodeExecution}){
 return <section className="studio-policy-checks" aria-label={`Policy checks for ${node.label}`}><h5>Policy checks</h5>{node.policyChecks?.length?<ul>{node.policyChecks.map((check,index)=><li key={`${check.id}-${index}`}><div><span className="studio-policy-stage">{check.stage}</span><strong>{check.rule}</strong><span className={'studio-policy-verdict '+(check.violated?statusClass(check.action):'pass')}>{check.violated?check.action:'Pass'}</span></div><p>{check.summary}</p></li>)}</ul>:<p className="studio-policy-empty">No policy checks were recorded for this node</p>}</section>;
}
export default function ExecutionPanel({request,userId,blockedReason,onTryExample,onRunningChange,onProgress,onGovern}:Props){
 const [input,setInput]=useState(()=>sampleExecutionInput(request)),[running,setRunning]=useState(false),[nodes,setNodes]=useState<NodeExecution[]>([]),[active,setActive]=useState(''),[result,setResult]=useState<ExecutionResult|null>(null),[error,setError]=useState(''),[recorded,setRecorded]=useState(false),[recordError,setRecordError]=useState('');
 const inputId=useId();
 const isExample=request.agent.id===END_TO_END_DEMO_ID;
 const displayLabel=(label:string)=>isExample?exampleNodeLabels[label]||label:label;
 const exampleNoApproval=!request.definition.limits.requireApproval&&!request.definition.guardrails.some(rule=>rule.enabled&&(rule.action==='Require approval'||rule.action==='Block'));
 const exampleSteps=request.definition.nodes.filter(item=>item.enabled);
 const controller=useRef<AbortController|null>(null),sequence=useRef(0),mounted=useRef(true),accepted=useRef<NodeExecution[]>([]),activeId=useRef(''),busy=useRef(false);
 const node=request.definition.nodes.find(n=>n.id===request.nodeId),modelDefinition=request.references?.find(reference=>reference.agent.id===node?.referencedAgentId)?.definition||request.definition;
 const generationNode=!node||isGenerationNode(node.kind),primaryNode=node?result?.nodes.find(item=>item.nodeId===node.id):result?.nodes.at(-1);
 const linkedRole=!!node?.referencedAgentId&&generationNode,hasLinkedRoles=request.definition.nodes.some(item=>item.enabled&&item.referencedAgentId);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;sequence.current++;controller.current?.abort();if(busy.current)onRunningChange(false)}},[]);
 async function record(value:ExecutionResult){
  try{await governanceService.recordExecution(value,userId);if(mounted.current){setRecorded(true);setRecordError('')}}catch(e:any){if(mounted.current)setRecordError(e.message||'This result could not be saved to governance. It remains visible here.')}
 }
 async function run(){
  if(busy.current||blockedReason||!input.trim())return;
  const call=++sequence.current,c=new AbortController(),snapshot=structuredClone(request),task=input;
  controller.current=c;busy.current=true;accepted.current=[];activeId.current='';setRunning(true);onRunningChange(true);setNodes([]);setActive('Starting');setResult(null);setError('');setRecorded(false);setRecordError('');
  function event(event:ExecutionEvent){
   if(call!==sequence.current||!mounted.current||c.signal.aborted)return;
   if(event.type==='node-start'){activeId.current=event.nodeId;setActive(displayLabel(event.label));onProgress(event.nodeId,'Running')}
   if(event.type==='node-result'){accepted.current=[...accepted.current,event.node];setNodes(accepted.current);onProgress(event.node.nodeId,event.node.status)}
  }
  try{
   const value=await runAgentExecution({...snapshot,input:task},{signal:c.signal,onEvent:event});
   if(call!==sequence.current||!mounted.current)return;
   setResult(value);setNodes(value.nodes);setActive('');for(const item of value.nodes)onProgress(item.nodeId,item.status);if(activeId.current&&!value.nodes.some(item=>item.nodeId===activeId.current))onProgress(activeId.current,value.status);await record(value);
  }catch(e:any){
   if(call!==sequence.current||!mounted.current)return;
   const cancelled=c.signal.aborted||e.name==='AbortError';
   setError(cancelled?'Stopped. Completed node results are preserved below.':e.message||'The run could not finish. Completed results are preserved below.');setActive('');

  }finally{if(call===sequence.current&&mounted.current){busy.current=false;controller.current=null;setRunning(false);onRunningChange(false)}}
 }
 function stop(){controller.current?.abort();setActive('Stopping…')}
 function downloadResult(){if(!result)return;const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=`lumen-${result.id}-result.json`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 return <section className="studio-execution" aria-label={node?`Test ${displayLabel(node.label)}`:'Run agent'}>
  <div className="studio-execution-heading"><div><span><Play size={16}/></span><div><h3>{node?'Test this node':'Run the saved agent'}</h3><p>{node?`${node.kind} · ${displayLabel(node.label)}`:`Follow the saved workflow from input to output`} · revision {request.definition.revision}</p></div></div><span className="studio-live-model">LIVE EXECUTOR</span></div>
  {request.globalPolicies&&<p className="studio-execution-scope">Global policies · revision {request.globalPolicies.revision} · {request.globalPolicies.rules.filter(rule=>rule.enabled).length} enabled rules, alongside this agent’s policies.</p>}
  <p className="studio-execution-scope">{node?nodeTestExplanation(node.kind):'The graph runs in connection order.'} Only Agent and Sub-agent nodes generate responses. Tools run locally. Memory stays within this run.</p>
  {!node&&onTryExample&&<div className="studio-example-invite"><div><strong>See an agent complete the whole flow</strong><p>Open a separate example with a read-only CRM lookup, two agent roles, memory, and a final memo. The default request can complete end to end under its saved policies.</p></div><button type="button" className="studio-btn studio-example-button" disabled={running} onClick={onTryExample}><Play size={14}/> Try end-to-end example</button></div>}
  {isExample&&!node&&<div className="studio-example-banner"><div><span className="studio-example-label">END-TO-END EXAMPLE</span><strong>{exampleNoApproval?(request.globalPolicies?'Read-only workflow · global policies apply':'No approval checkpoints · local tools'):'Customized example · saved rules apply'}</strong><p>{exampleNoApproval?'Create an internal memo from the available context, then let the review role refine it. The result is returned here.':'This example has been customized. Its configured guardrails and review requirements may hold a run.'}</p></div><ol aria-label="Example workflow">{exampleSteps.map((step,index)=><li key={step.id}><b>{index+1}</b><span>{displayLabel(step.label)}</span></li>)}</ol></div>}
  <div className="studio-field"><div className="studio-input-heading"><label htmlFor={inputId}>{node?'Test input / incoming context':'Task for the agent'}</label><button type="button" className="studio-btn studio-sample-button" disabled={running} onClick={()=>setInput(sampleExecutionInput(request))}>Reset sample</button></div><textarea id={inputId} rows={4} maxLength={16000} value={input} disabled={running} onChange={e=>setInput(e.target.value)} placeholder={node?'Provide the text this node should receive…':'Describe the outcome you want this agent to produce…'}/><small>Edit the request or replace it with your own.</small></div>
  <div className="studio-execution-actions"><span className="studio-saved-runtime">{generationNode?<><strong>{node?'Saved generation model':'Saved default generation model'}</strong><code className="studio-connection-snippet">{connectionSnippet(modelDefinition.model.name,agentBaseUrl(modelDefinition.model))}</code><small>Generation temperature {modelDefinition.model.temperature} · up to {modelDefinition.model.maxTokens.toLocaleString()} output tokens per call</small>{linkedRole?<><strong className="studio-policy-runtime-label">Parent policy model</strong><code className="studio-connection-snippet">{connectionSnippet(request.definition.model.name,agentBaseUrl(request.definition.model))}</code><small>Policy temperature 0, when checks apply</small></>:<small>Policy checks use this saved model and endpoint · temperature 0</small>}{!node&&hasLinkedRoles&&<small>Linked roles use their own saved models and endpoints.</small>}</>:<><strong>Saved policy model</strong><code className="studio-connection-snippet">{connectionSnippet(request.definition.model.name,agentBaseUrl(request.definition.model))}</code><small>Only used when checks apply · temperature 0 · up to {Math.min(request.definition.model.maxTokens,4096).toLocaleString()} output tokens per call</small></>}</span><button className={'studio-btn '+(running?'danger':'primary')} disabled={!running&&(!!blockedReason||!input.trim())} onClick={running?stop:run}>{running?<Square size={14} fill="currentColor"/>:<Play size={15} fill="currentColor"/>}{running?'Stop':node?'Run test':'Run agent'}</button></div>
  {blockedReason&&!running&&<p className="studio-execution-notice"><Info size={14}/>{blockedReason}</p>}
  {running&&<div className="studio-execution-live" role="status"><Loader2 size={17} className="studio-spin"/><span>{active||'Recording run…'}<small>{nodes.length} node results received</small></span></div>}
  {error&&<div className="studio-execution-error" role="alert"><Info size={16}/>{error}</div>}
  {(nodes.length>0||result)&&<div className="studio-execution-results">
   {result&&<div className="studio-execution-metrics"><span className={'studio-badge '+statusClass(result.status)}>{result.status}</span><span><Clock size={13}/>{(result.duration/1000).toFixed(1)}s</span><TokenUsage value={result}/><span>Recorded revision {result.configurationRevision}</span>{result.globalPolicyRevision!==undefined&&<span>Global policies · revision {result.globalPolicyRevision}</span>}<span>{result.costKnown?`$${result.cost.toFixed(5)}`:'Cost unavailable'}</span><button className="studio-btn studio-result-download" onClick={downloadResult}><Download size={14}/> Download result</button></div>}
   {nodes.length>0&&<div className="studio-execution-trace">{nodes.map((item,index)=><details key={`${item.nodeId}-${index}`}><summary><span className={'studio-trace-dot '+statusClass(item.status)}/><span><strong>{displayLabel(item.label)}</strong><small>{item.kind} · {item.status}</small></span><span>{(item.duration/1000).toFixed(1)}s</span><ChevronDown size={14}/></summary><div><p>{item.summary}</p><div className="studio-trace-usage"><TokenUsage value={item}/>{item.model&&<span>{isGenerationNode(item.kind)?'Generation model':'Policy model'} · {item.model}</span>}{item.baseUrl&&<span>Recorded endpoint · <code>{item.baseUrl}</code></span>}</div><label>Incoming context</label><pre>{item.input||'No text input'}</pre><label>{outputLabel(item)}</label><pre>{item.output||'No text output'}</pre>{passedThrough(item)&&<p className="studio-unchanged"><Check size={13}/>Passed through unchanged</p>}{(!node||!result)&&<PolicyChecks node={item}/>}</div></details>)}</div>}
   {result?.output&&<div className="studio-execution-output"><h4>{result.status==='Success'?(node&&primaryNode?outputLabel(primaryNode):'Result'):'Last available output'}</h4>{result.status==='Success'&&primaryNode?.summary&&<p className="studio-result-summary">{primaryNode.summary}</p>}<pre>{result.output}</pre>{node&&primaryNode&&passedThrough(primaryNode)&&<p className="studio-unchanged"><Check size={13}/>Passed through unchanged</p>}</div>}
   {node&&result&&primaryNode&&<PolicyChecks node={primaryNode}/>}
   {result&&(!!result.warnings.length||!!result.baseUrl)&&<details className="studio-execution-details"><summary><Info size={14}/><span>Execution details</span><ChevronDown size={14}/></summary>{result.baseUrl&&<div className="studio-recorded-runtime"><strong>Recorded parent runtime</strong><code className="studio-connection-snippet">{connectionSnippet(result.model,result.baseUrl)}</code></div>}{!!result.warnings.length&&<ul className="studio-execution-warnings">{result.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}</details>}
   {recorded&&<div className="studio-execution-recorded"><span><Check size={14}/> Recorded in Agent Governance</span><button className="studio-btn" disabled={running} onClick={()=>onGovern(result?.id)}>View governance <ArrowUpRight size={14}/></button></div>}
   {recordError&&<div className="studio-execution-error" role="alert"><Info size={16}/><span>{recordError} {result&&<button className="studio-btn" disabled={running} onClick={()=>record(result)}>Retry saving result</button>}</span></div>}
  </div>}
  <p className="studio-execution-footnote"><Terminal size={13}/> Recorded outputs and concise summaries only; hidden model reasoning is never displayed.</p>
 </section>;
}
