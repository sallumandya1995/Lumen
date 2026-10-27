import type {Run,Store} from './types';
export type ActivitySource='live'|'historical'|'all';
/** Browser imports and seeded receipts are not server-verified live executions. */
export const isHistoricalRun=(run:Run)=>run.source!=='live'||run.provenance==='browser-import';
export function activityStore(store:Store,source:ActivitySource):Store{
 if(source==='all')return store;
 const runs=store.runs.filter(run=>source==='historical'?isHistoricalRun(run):!isHistoricalRun(run));
 const ids=new Set(runs.map(run=>run.id));
 const policies=store.policies.filter(p=>ids.has(p.runId)),approvals=store.approvals.filter(a=>ids.has(a.runId));
 const reviews=new Set([...policies,...approvals].map(r=>r.id));
 const excluded=new Set([...store.runs.filter(r=>!ids.has(r.id)),...store.policies.filter(p=>!ids.has(p.runId)),...store.approvals.filter(p=>!ids.has(p.runId)),...store.toolCalls.filter(t=>!ids.has(t.runId))].map(r=>r.id));
 return {...store,runs,toolCalls:store.toolCalls.filter(t=>ids.has(t.runId)),policies,approvals,assignments:store.assignments.filter(a=>reviews.has(a.reviewId)),audit:store.audit.filter(a=>!excluded.has(a.target)&&!(source==='live'&&a.id.startsWith('AU-SIM-')))};
}
