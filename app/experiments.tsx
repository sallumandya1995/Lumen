'use client';
import {forwardRef,useCallback,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {ArrowRight,Check,ChevronDown,ChevronUp,Copy,Download,FlaskConical,Info,Play,Plus,RotateCcw,Square,Trash2} from 'lucide-react';
import {DEFAULT_MODEL,MODELS,modelConfig} from '../lib/models.mjs';
import {getRuntimeConfig,runInference} from '../lib/inference';
import {experimentSnapshots,initialVariants,MAX_VARIANTS,newVariant,resultMetrics,runExperiment,tokenDifferences,type ExperimentResult,type ExperimentRun,type Variant} from '../lib/experiments';
import TokenProbabilities from './token-probabilities';
import './experiments.css';

const DEFAULT_PROMPT='Explain why the sky appears blue in two sentences.';
const STORAGE='lumen-experiment-settings-v1';
const money=(value:number|null)=>value===null?'Not priced':value===0?'$0.000000':value<0.000001?'< $0.000001':'$'+value.toFixed(6);
export type ExperimentHandle={reset:()=>void};
type Props={active:boolean;onBusyChange:(busy:boolean)=>void};

const Experiments=forwardRef<ExperimentHandle,Props>(function Experiments({active,onBusyChange},ref){
 const [variants,setVariants]=useState<Variant[]>(initialVariants),[prompt,setPrompt]=useState(DEFAULT_PROMPT);
 const [run,setRun]=useState<ExperimentRun|null>(null),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[remote,setRemote]=useState(true),[hydrated,setHydrated]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[collapsed,setCollapsed]=useState(false),[baselineId,setBaselineId]=useState(''),[showDifferences,setShowDifferences]=useState(true),[exporting,setExporting]=useState(false);
 const mounted=useRef(true),controller=useRef<AbortController|null>(null),busyRef=useRef(false),currentRun=useRef(''),callbacks=useRef({onBusyChange}),nextNumber=useRef(4);
 callbacks.current={onBusyChange};
 useEffect(()=>{
  mounted.current=true;
  getRuntimeConfig().then(c=>{if(mounted.current){setRemote(c.remoteAvailable!==false);setReady(true)}});
  try{
   const saved=JSON.parse(localStorage.getItem(STORAGE)||'null');
   if(saved&&typeof saved.prompt==='string'&&Array.isArray(saved.variants)){
    experimentSnapshots(saved.prompt||DEFAULT_PROMPT,saved.variants);
    setPrompt(saved.prompt);setVariants(saved.defaultsRevision===2?saved.variants:saved.variants.map((variant:Variant)=>({...variant,model:DEFAULT_MODEL})));nextNumber.current=MAX_VARIANTS+1;
   }
  }catch{setNotice('Saved experiment settings could not be restored. The starting configuration is ready.')}
  setHydrated(true);
  return()=>{mounted.current=false;controller.current?.abort();callbacks.current.onBusyChange(false)};
 },[]);
 useEffect(()=>{
  if(!hydrated)return;
  try{localStorage.setItem(STORAGE,JSON.stringify({prompt,variants,defaultsRevision:2}))}catch{setNotice('Your browser could not save these settings. You can still run and export this experiment.')}
 },[prompt,variants,hydrated]);
 const reset=useCallback(()=>{
  if(busyRef.current)return;
  currentRun.current='';setRun(null);setPrompt(DEFAULT_PROMPT);setVariants(initialVariants());setBaselineId('');setError('');setNotice('');setCollapsed(false);nextNumber.current=4;
 },[]);
 useImperativeHandle(ref,()=>({reset}),[reset]);
 function update(id:string,patch:Partial<Variant>){setVariants(current=>current.map(v=>v.id===id?{...v,...patch}:v))}
 function add(source?:Variant){if(variants.length>=MAX_VARIANTS||busyRef.current)return;setVariants(current=>[...current,newVariant(nextNumber.current++,source)])}
 async function start(){
  if(busyRef.current||!ready||!remote)return;
  let snapshots;try{snapshots=experimentSnapshots(prompt,variants)}catch(e){setError(e instanceof Error?e.message:'Check your settings.');return}
  const id=crypto.randomUUID(),abort=new AbortController();controller.current=abort;currentRun.current=id;
  const frozen:ExperimentRun={id,createdAt:new Date().toISOString(),prompt,results:snapshots.map(variant=>({variant,status:'queued'}))};
  setRun(frozen);setBaselineId(snapshots[0].id);setError('');setNotice('');setCollapsed(true);setBusy(true);busyRef.current=true;callbacks.current.onBusyChange(true);
  try{
   await runExperiment(frozen.prompt,snapshots,{signal:abort.signal,request:(args,signal)=>runInference(args,{signal}),onResult:(index,result)=>{
    if(!mounted.current||currentRun.current!==id)return;
    setRun(value=>value?.id===id?{...value,results:value.results.map((old,i)=>i===index?result:old)}:value);
   }});
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'The experiment could not finish.')}
  finally{if(currentRun.current===id&&mounted.current){controller.current=null;busyRef.current=false;setBusy(false);callbacks.current.onBusyChange(false)}}
 }
 const baseline=run?.results.find(r=>r.variant.id===baselineId&&r.status==='success')||run?.results.find(r=>r.status==='success');
 const finished=run?.results.filter(r=>!['queued','running'].includes(r.status)).length||0;
 const successes=run?.results.filter(r=>r.status==='success')||[];
 const priced=successes.map(resultMetrics).filter(m=>m.estimatedCostUsd!==null);
 const estimatedTotal=priced.length?priced.reduce((sum,m)=>sum+m.estimatedCostUsd!,0):null;
 async function exportPdf(){
  if(!run||busy||exporting)return;
  setExporting(true);setError('');
  try{
   const snapshot=structuredClone(run),{buildExperimentPdf}=await import('../lib/experiment-pdf');
   const bytes=await buildExperimentPdf(snapshot,baseline?.variant.id);
   if(!mounted.current)return;
   const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'application/pdf'})),link=document.createElement('a');
   link.href=url;link.download=`lumen-experiment-${snapshot.createdAt.replace(/[:.]/g,'-')}.pdf`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
   setNotice('PDF exported with settings, responses, metrics, token differences, and the full data as an embedded JSON attachment.');
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'The PDF could not be exported. Please try again.')}
  finally{if(mounted.current)setExporting(false)}
 }

 return <section className="experiment-workspace" aria-label="Prompt and model comparison experiments" hidden={!active} style={!active?{display:'none'}:undefined}>
  <div className="experiment-heading"><div><span className="experiment-eyebrow"><FlaskConical size={14}/> LUMEN EXPERIMENTS</span><h1>One prompt. More perspectives.</h1><p>Compare models, system prompts and sampling settings with evidence from each response.</p></div><div className="experiment-heading-actions"><button type="button" onClick={reset} disabled={busy||exporting} title="Start a fresh experiment"><RotateCcw size={15}/> Reset</button><button type="button" className="experiment-export" disabled={!run||busy||exporting} onClick={()=>void exportPdf()}><Download size={16}/>{exporting?'Preparing PDF…':'Export PDF'}</button></div></div>
  {!remote&&<p className="experiment-alert" role="alert">The model API is not configured. Configure the server key before running an experiment.</p>}
  {error&&<p className="experiment-alert" role="alert">{error}</p>}{notice&&<p className="experiment-notice" role="status">{notice}</p>}
  <section className="experiment-prompt-panel"><label htmlFor="experiment-shared-prompt">Shared prompt <small>Identical input for every variant · fresh context</small></label><textarea id="experiment-shared-prompt" value={prompt} maxLength={16000} disabled={busy||exporting} onChange={e=>setPrompt(e.target.value)} placeholder="Enter the prompt you want to compare…" onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.nativeEvent.isComposing){e.preventDefault();void start()}}}/><div className="experiment-prompt-footer"><p><Info size={14}/>{run?'A new run replaces the results below. Export first to keep them.':'Change one setting at a time when you want to isolate its effect.'}</p>{busy?<button className="experiment-stop" type="button" onClick={()=>controller.current?.abort()}><Square size={14}/> Stop experiment</button>:<button className="experiment-run" type="button" disabled={!ready||!remote||exporting||!prompt.trim()} onClick={()=>void start()}><Play size={15} fill="currentColor"/>{run?'Run again':'Run experiment'}<span>{variants.length} variants</span></button>}</div></section>
  <div className="experiment-section-heading"><button className="experiment-collapse" type="button" aria-expanded={!collapsed} aria-controls="experiment-variant-config" onClick={()=>setCollapsed(v=>!v)}><span>Variant setup <small>{variants.length} configurations</small></span>{collapsed?<ChevronDown size={17}/>:<ChevronUp size={17}/>}</button><button type="button" disabled={busy||exporting||variants.length>=MAX_VARIANTS} onClick={()=>{setCollapsed(false);add()}}><Plus size={15}/> Add variant</button></div>
  <div id="experiment-variant-config" className="experiment-config-grid" hidden={collapsed}>
   {variants.map((variant,index)=><article className="experiment-config" key={variant.id}><div className="experiment-config-title"><span>{String(index+1).padStart(2,'0')}</span><input aria-label={`Name for variant ${index+1}`} maxLength={60} value={variant.label} disabled={busy||exporting} onChange={e=>update(variant.id,{label:e.target.value})}/><button type="button" disabled={busy||exporting||variants.length>=MAX_VARIANTS} aria-label={`Duplicate ${variant.label}`} title="Duplicate variant" onClick={()=>add(variant)}><Copy size={14}/></button><button type="button" disabled={busy||exporting||variants.length<=2} aria-label={`Remove ${variant.label}`} title="Remove variant" onClick={()=>setVariants(v=>v.filter(item=>item.id!==variant.id))}><Trash2 size={14}/></button></div>
    <label>Model<select value={variant.model} disabled={busy||exporting} onChange={e=>update(variant.id,{model:e.target.value,inputRate:'',outputRate:''})}>{Object.entries(MODELS).filter(([,config])=>config.chat).map(([id,config])=><option value={id} key={id}>{config.label}</option>)}</select></label>
    <div className="experiment-setting-row"><label>Temperature<input type="number" min={0} max={2} step={0.05} required value={variant.temperature} disabled={busy||exporting} onChange={e=>update(variant.id,{temperature:e.target.value})}/></label><label>Top P<input type="number" min={0} max={1} step={0.05} required value={variant.topP} disabled={busy||exporting} onChange={e=>update(variant.id,{topP:e.target.value})}/></label><label>Max tokens<input type="number" min={1} max={8192} step={1} required value={variant.maxTokens} disabled={busy||exporting} onChange={e=>update(variant.id,{maxTokens:e.target.value})}/></label></div>
    <label>System prompt<textarea value={variant.systemPrompt} maxLength={8000} disabled={busy||exporting} onChange={e=>update(variant.id,{systemPrompt:e.target.value})} placeholder="Leave blank for the model's default behavior"/></label>
    <details className="experiment-pricing"><summary>Cost rates <span>{variant.inputRate!==''&&variant.outputRate!==''?'Custom USD / 1M tokens':'Optional'}</span></summary><p>Enter your Nebius rates in USD per million tokens. The estimate uses provider-reported input and output usage; no rates are assumed.</p><div className="experiment-setting-row"><label>Input / 1M<input type="number" min={0} step="any" value={variant.inputRate} disabled={busy||exporting} placeholder="Not set" onChange={e=>update(variant.id,{inputRate:e.target.value})}/></label><label>Output / 1M<input type="number" min={0} step="any" value={variant.outputRate} disabled={busy||exporting} placeholder="Not set" onChange={e=>update(variant.id,{outputRate:e.target.value})}/></label></div></details>
   </article>)}
  </div>
  <p className="experiment-context-note">Settings are saved in this browser. Results stay in this session; export a PDF to keep a run. Up to three requests run concurrently. Each latency excludes queue time.</p>
  {run?<section className="experiment-results" aria-label="Experiment results"><div className="experiment-results-heading"><div><span className="experiment-eyebrow">RESULTS / {new Date(run.createdAt).toLocaleTimeString()}</span><h2>{busy?'Comparing your variants…':'Your comparison is ready.'}</h2><p role="status">{finished} / {run.results.length} finished · {successes.length} successful{estimatedTotal!==null&&<> · {money(estimatedTotal)} estimated ({priced.length}/{successes.length} successful variants priced)</>}</p></div><label className="experiment-diff-toggle"><input type="checkbox" checked={showDifferences} onChange={e=>setShowDifferences(e.target.checked)}/> Highlight differences</label></div>
   {baseline&&<div className="experiment-diff-legend"><span className="experiment-diff-swatch"/> Changed tokens compared with <strong>{baseline.variant.label}</strong><span>Hover a token for probabilities. Log probabilities are model-specific; they do not measure answer quality.</span></div>}
   <div className="experiment-result-grid" style={{'--experiment-columns':run.results.length} as React.CSSProperties}>{run.results.map(result=><ResultCard key={result.variant.id} result={result} baseline={baseline} showDifferences={showDifferences} onBaseline={()=>setBaselineId(result.variant.id)}/>)}</div>
   <p className="experiment-metrics-note">Output and total counts come from provider usage and may include reasoning tokens. Mean log P uses recorded visible answer tokens only. Latency includes network and model time. Cost estimates use the rates saved with this run, excluding discounts and taxes.</p>
  </section>:<div className="experiment-empty"><span><FlaskConical size={24}/></span><div><h2>Build a comparison you can explain.</h2><p>Run the shared prompt to see latency, token usage, estimated cost, mean log probability, and token differences side by side.</p></div><ArrowRight size={21}/></div>}
 </section>;
});
export default Experiments;

function ResultCard({result,baseline,showDifferences,onBaseline}:{result:ExperimentResult;baseline?:ExperimentResult;showDifferences:boolean;onBaseline:()=>void}){
 const [copied,setCopied]=useState(false),[expanded,setExpanded]=useState(false),[copyError,setCopyError]=useState('');
 const metrics=resultMetrics(result),isBaseline=baseline?.variant.id===result.variant.id;
 const diff=baseline&&result.status==='success'&&!isBaseline?tokenDifferences(baseline.content||'',result.content||'',result.logprobs):null;
 async function copy(){try{await navigator.clipboard.writeText(result.content||'');setCopied(true);setCopyError('')}catch{setCopyError('Copy is unavailable. Select the response text to copy it.')}}
 return <article className={'experiment-result-card status-'+result.status+(isBaseline?' is-baseline':'')}><div className="experiment-result-title"><div><span className="experiment-result-status">{result.status==='success'?'Completed':result.status==='error'?'Failed':result.status==='cancelled'?'Stopped':result.status==='running'?'Generating':'Queued'}</span><h3>{result.variant.label}</h3><p>{modelConfig(result.variant.model)?.label||result.variant.model}</p></div><button type="button" className="experiment-baseline" disabled={result.status!=='success'} onClick={onBaseline} aria-pressed={isBaseline}>{isBaseline?<><Check size={13}/> Baseline</>:'Use as baseline'}</button></div>
  <div className="experiment-result-parameters">T {result.variant.parameters.temperature} <span>·</span> P {result.variant.parameters.top_p} <span>·</span> Max {result.variant.parameters.max_tokens}</div>
  <div className="experiment-metric-grid"><div><small>Latency</small><strong>{result.durationMs!==undefined?(result.durationMs/1000).toFixed(2)+'s':'—'}</strong></div><div><small>Output tokens</small><strong>{metrics.outputTokens??'—'}</strong><span>{metrics.totalTokens!==null?`${metrics.totalTokens} total · ${metrics.visibleTokens} visible`:'Provider usage unavailable'}</span></div><div><small>Estimated cost</small><strong>{money(metrics.estimatedCostUsd)}</strong><span>{result.variant.pricing?'Saved custom rates':'Add cost rates in setup'}</span></div><div><small>Mean log P</small><strong>{metrics.averageLogprob===null?'—':metrics.averageLogprob.toFixed(4)}</strong><span>Visible answer tokens</span></div></div>
  <details className="experiment-used-system"><summary>System prompt used</summary><p>{result.variant.systemPrompt||'No system prompt supplied.'}</p></details>
  {result.status==='success'?<><div className={'experiment-response'+(expanded?' is-expanded':'')}>
   {diff&&!diff.aligned&&showDifferences?<div className="experiment-fallback-response">{diff.segments.map((segment,i)=><span key={i} className={segment.changed?'experiment-text-change':''}>{segment.text}</span>)}</div>:<TokenProbabilities content={result.content||''} tokens={result.logprobs} highlightedTokenIndices={showDifferences?diff?.indices:undefined}/>}
  </div><div className="experiment-response-actions"><button type="button" onClick={()=>void copy()}>{copied?<Check size={14}/>:<Copy size={14}/>} {copied?'Copied':'Copy'}</button><button type="button" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?'Compact view':'Expand response'}</button></div>{copyError&&<p className="experiment-result-warning" role="alert">{copyError}</p>}
  {diff&&showDifferences&&<p className="experiment-diff-count">{diff.aligned?`${diff.indices.length} changed tokens`:'Text differences shown; provider token alignment unavailable.'}{diff.coarse?' · Long-response comparison uses a broader changed region.':''}</p>}
  {diff?.removedText&&showDifferences&&<details className="experiment-omitted"><summary>Omitted from baseline · […] marks unchanged gaps</summary><p>{diff.removedText}</p></details>}
  {result.finishReason==='length'&&<p className="experiment-result-warning">The response reached its output-token limit and may be incomplete.</p>}{result.warning&&<p className="experiment-result-warning">{result.warning}</p>}</>:<div className="experiment-result-placeholder" role="status">{result.status==='running'?<><span className="experiment-spinner"/>Generating response and token alternatives…</>:result.status==='queued'?'Waiting for an available request slot…':result.error||'This variant could not complete.'}</div>}
 </article>;
}
