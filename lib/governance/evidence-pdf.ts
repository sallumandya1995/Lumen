import {PDFDocument,rgb,type PDFPage} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {verifyEvidence,type EvidenceBundle} from './integrity';
/** Human-readable evidence report plus the complete, independently verifiable JSON attachment. */
export async function buildGovernancePdf(bundle:EvidenceBundle,fontBytes?:Uint8Array){
 await verifyEvidence(bundle);
 if(!fontBytes){const response=await fetch('/fonts/DejaVuSans.ttf',{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('The PDF font could not be loaded.');fontBytes=new Uint8Array(await response.arrayBuffer())}
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);const font=await pdf.embedFont(fontBytes,{subset:true}),supported=new Set(font.getCharacterSet());
 pdf.setTitle('Lumen - Agent governance evidence');pdf.setAuthor('Lumen');pdf.setSubject('Runs, policies, reviews, and signed audit evidence');
 await pdf.attach(new TextEncoder().encode(JSON.stringify(bundle,null,2)),'lumen-evidence.json',{mimeType:'application/json',description:'Complete signed governance evidence. Verify with Lumen or the included Python verifier.'});
 const INK=rgb(.025,.17,.25),MUTED=rgb(.31,.41,.47),LINE=rgb(.83,.88,.9),LIME=rgb(.85,1,.21),W=595.28,H=841.89,M=42,CW=W-M*2;let page!:PDFPage,y=0;
 const safe=(text:any)=>Array.from(String(text??'')).map(c=>c==='\n'||c==='\t'||supported.has(c.codePointAt(0)!)?c:`[U+${c.codePointAt(0)!.toString(16).toUpperCase()}]`).join('').replace(/\r/g,'').replace(/\t/g,'  ');
 function newPage(){page=pdf.addPage([W,H]);page.drawText('LUMEN  /  GOVERNANCE EVIDENCE',{x:M,y:H-30,size:8,font,color:MUTED});page.drawLine({start:{x:M,y:H-42},end:{x:W-M,y:H-42},thickness:.7,color:LINE});y=H-66}
 function ensure(n:number){if(y-n<49)newPage()}
 function text(value:any,size=10,color=INK){const paragraphs=safe(value).split('\n');for(const paragraph of paragraphs){let line='';for(const word of paragraph.match(/\S+\s*|\s+/g)||[]){if(font.widthOfTextAtSize(line+word,size)>CW&&line){ensure(size*1.5);page.drawText(line,{x:M,y,size,font,color});y-=size*1.5;line=''}for(const char of word){if(font.widthOfTextAtSize(line+char,size)>CW){ensure(size*1.5);page.drawText(line,{x:M,y,size,font,color});y-=size*1.5;line=''}line+=char}}ensure(size*1.5);page.drawText(line,{x:M,y,size,font,color});y-=size*1.5}y-=5}
 function heading(value:string){ensure(60);y-=12;text(value,16);y-=3}
 function rule(){ensure(12);page.drawLine({start:{x:M,y},end:{x:W-M,y},thickness:.6,color:LINE});y-=14}
 const r=bundle.records,runs=r.runs as any[];
 newPage();page.drawRectangle({x:M,y:y-8,width:48,height:4,color:LIME});y-=31;text('Every action. A record.',28);text('Agent governance evidence pack',17,MUTED);text(`Exported ${bundle.createdAt}`,9,MUTED);text(`Scope: ${bundle.scope}`,9,MUTED);y-=12;
 const live=runs.filter(x=>x.source==='live'),sim=runs.length-live.length;heading('Evidence overview');
 text(`${runs.length} runs  |  ${r.toolCalls.length} tool calls  |  ${r.policyEvents.length} policy events  |  ${r.approvals.length} reviews`,11);
 text(`${live.filter(x=>x.provenance==='studio').length} Studio executions; ${live.filter(x=>x.provenance==='external').length} external traces; ${live.filter(x=>x.provenance==='browser-import').length} imported records; ${sim} simulated runs.`,10,MUTED);
 heading('Integrity checkpoint');text(`Verified: ${bundle.ledger.length} audit links and ECDSA P-256 signature.`,11);text('Signing-key fingerprint (SHA-256)',9,MUTED);text(bundle.keyFingerprint,9);text('Audit head',9,MUTED);text(bundle.checkpoint.head,9);text('Records digest',9,MUTED);text(bundle.checkpoint.recordsDigest,9);
 heading('What this report establishes');for(const item of bundle.limitations)text('• '+item,9,MUTED);
 text('The complete JSON is embedded as lumen-evidence.json. The visual report presents up to 50 runs and 30 steps per run. Long inputs, outputs, and review notes are excerpted; the attachment retains the full selected evidence. Unsupported glyphs appear as Unicode code points.',9,MUTED);
 for(const run of runs.slice(0,50)){
  newPage();text(run.provenance==='external'?'EXTERNAL TRACE':run.provenance==='browser-import'?'IMPORTED BROWSER RECORD':run.source==='live'?'STUDIO EXECUTION':'SIMULATED RECORD',9,MUTED);
  heading(r.agents.find((a:any)=>a.id===run.agentId)?.name||run.agentId);text(run.id,8,MUTED);text(`${run.executionStatus||run.status}  |  ${(run.duration/1000).toFixed(2)}s  |  ${run.tokens} tokens  |  ${run.costKnown===false?'Cost unavailable':'Estimated $'+Number(run.cost).toFixed(5)}`,10);text(`Started ${run.at}`,9,MUTED);
  if(run.model)text('Model: '+run.model,9);if(run.baseUrl)text('Endpoint: '+run.baseUrl,8,MUTED);if(run.configurationRevision)text(`Recorded agent revision ${run.configurationRevision}; global policy revision ${run.globalPolicyRevision??'not recorded'}`,9,MUTED);
  heading('Request');text(run.task.slice(0,1000)+(run.task.length>1000?' […]':''));
  if(run.output){heading('Recorded output');text(run.output.slice(0,2400)+(run.output.length>2400?' […]':''))}
  heading('Execution timeline');for(const [i,step] of run.steps.slice(0,30).entries()){ensure(60);text(`${String(i+1).padStart(2,'0')}  ${step.label}  /  ${step.outcome}`,10);text(`${step.kind} · ${step.duration} ms · ${step.tokens??'Unknown'} tokens`,8,MUTED);text(step.summary.slice(0,450)+(step.summary.length>450?' […]':''),9);rule()}
  if(run.steps.length>30)text(`${run.steps.length-30} additional steps are in the JSON attachment.`,9,MUTED);
  for(const warning of run.warnings||[])text('Note: '+warning,8,MUTED);
 }
 newPage();heading('Policy events and review decisions');
 if(!r.policyEvents.length&&!r.approvals.length)text('No policy events or approval records are linked to this export.');
 for(const event of r.policyEvents.slice(0,100)){ensure(85);text(`${event.severity} / ${event.rule} / ${event.status}`,11);text(`${event.id} · ${event.disposition}`,8,MUTED);text(event.context.slice(0,900),9);if(event.notes)text('Remediation: '+event.notes.slice(0,900),9);rule()}
 for(const approval of r.approvals.slice(0,100)){ensure(85);text(`${approval.status} / ${approval.action}`,11);text(`${approval.id} · reviewer ${approval.assigneeId||'Unassigned'} · ${approval.decisionAt||approval.at}`,8,MUTED);text(approval.context.slice(0,700),9);if(approval.note)text('Review note: '+approval.note.slice(0,900),9);for(const a of r.assignments.filter((a:any)=>a.reviewId===approval.id))text(`Assigned ${a.fromId||'Unassigned'} → ${a.toId} by ${a.actorId} at ${a.at}`,8,MUTED);rule()}
 if(r.policyEvents.length>100||r.approvals.length>100)text('Additional events and reviews are included in the attached JSON.',9,MUTED);
 heading('Verification');text('In Governance → Evidence & exports, select Verify JSON. For offline verification use verify_evidence.py from the Python adapters download. Pin the signing-key fingerprint through a separately trusted record.',10);
 const pages=pdf.getPages();for(const [i,p] of pages.entries()){p.drawLine({start:{x:M,y:35},end:{x:W-M,y:35},thickness:.5,color:LINE});p.drawText('Recorded evidence · no hidden model reasoning',{x:M,y:22,size:7,font,color:MUTED});p.drawText(`${i+1} / ${pages.length}`,{x:W-M-36,y:22,size:8,font,color:MUTED})}
 return pdf.save();
}
