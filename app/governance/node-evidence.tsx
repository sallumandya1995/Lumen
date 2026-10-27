import type {TraceStep} from '../../lib/governance/types';

export default function NodeEvidence({step}:{step:TraceStep}){
 const usage=step.tokenUsage,checks=step.policyChecks;
 if(step.tokens===undefined&&!checks?.length&&!step.baseUrl)return null;
 return <div className="gov-node-evidence">
  {step.baseUrl&&<p className="gov-node-usage"><strong>Generation model · {step.model}</strong><code>base_url="{step.baseUrl}"</code></p>}
  {step.tokens!==undefined&&<p className="gov-node-usage"><strong>{step.tokens.toLocaleString()} total model tokens</strong>{usage&&<span>Generation calls: {usage.generation.toLocaleString()} · Policy checks: {usage.policy.toLocaleString()}</span>}<small>Includes prompt and response tokens reported by the provider.</small></p>}
  {!!checks?.length&&<details className="gov-node-record"><summary>Recorded policy checks · {checks.length}</summary><ul className="gov-policy-evidence">{checks.map((check,index)=><li key={`${check.stage}-${check.id}-${index}`}><div><strong>{check.rule}</strong><span className={'gov-badge '+(!check.violated?'green':check.action==='Block'?'red':'amber')}>{!check.violated?'Passed':check.action==='Flag'?'Flagged':check.action==='Block'?'Blocked':'Requires approval'}</span></div><small>{check.stage} stage</small><p>{check.summary}</p></li>)}</ul></details>}
 </div>;
}
