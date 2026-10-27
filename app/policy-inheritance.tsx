import {Globe2,ShieldCheck} from 'lucide-react';
import type {GlobalPolicyConfiguration} from '../lib/governance/types';
import './policy-inheritance.css';

export default function PolicyInheritance({configuration}:{configuration?:GlobalPolicyConfiguration}){
 if(!configuration)return null;
 const enabled=configuration.rules.filter(rule=>rule.enabled).length;
 return <details className="policy-inheritance"><summary><Globe2 size={17}/><span><strong>Inherited global policies</strong><small>Revision {configuration.revision} · {enabled} enabled · applies to every agent</small></span><span className="policy-inheritance-count">{configuration.rules.length}</span></summary><div><p>These rules apply alongside the agent’s own policies. Owners can edit <code>global.yaml</code> in Policies.</p>{configuration.rules.length?<ul>{configuration.rules.map(rule=><li key={rule.id}><div><ShieldCheck size={14}/><strong>{rule.name}</strong><span>{rule.enabled?'Enabled':'Disabled'}</span></div><p>{rule.description}</p><small>{rule.stage} · {rule.action} · {rule.severity} severity</small></li>)}</ul>:<p>No global rules are configured.</p>}</div></details>;
}
