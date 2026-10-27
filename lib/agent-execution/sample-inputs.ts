import type {ExecutionRequest} from './types';
import {END_TO_END_DEMO_ID,END_TO_END_DEMO_INPUT} from '../governance/end-to-end-demo';

type Scenario={task:string;context:string;proposal:string};

// Business-style starter requests. Simulation disclosures belong in the UI and tool results.
const scenarios:Record<string,Scenario>={
 'a-support':{
  task:'A customer says they were charged $29 twice for this month’s subscription. Review the account information, identify what needs to be verified, and draft a clear, empathetic reply explaining the next steps.',
  context:'A customer reports two $29 charges for the same monthly subscription. The billing records have not yet been checked. Review the available account information and identify the details needed to investigate.',
  proposal:'Proposed reply: “Thank you for letting us know about the two subscription charges. We’ll review the billing entries and confirm what happened. Could you share the dates of both charges and the last four digits of the payment method used?” The charges have not yet been verified and no refund has been processed.'
 },
 'a-research':{
  task:'Prepare a short brief for our operations team on how to evaluate AI agent governance platforms. Compare approval workflows, audit trails, and CrewAI and LangGraph integration. Include source links for supported findings and a shortlist of questions to ask vendors.',
  context:'Our operations team is comparing AI agent governance platforms. The main requirements are human approvals, audit trails, and CrewAI and LangGraph integration. We need a concise evaluation checklist; supporting sources still need to be collected.',
  proposal:'Evaluation outline: compare approval routing, recorded tool activity, audit exports, and integration options. Questions for vendors: how long are records retained, which deployment options are supported, and which frameworks have maintained connectors? These findings still need source verification.'
 },
 'a-revenue':{
  task:'An operations team has asked for an overview of how we could help automate its customer support workflows. Summarize the available account context and draft a short follow-up inviting them to a discovery session. Keep it relevant to their stated needs and avoid making pricing or performance promises.',
  context:'The account’s operations team is exploring customer support automation and has requested an initial overview. Their budget, buying timeline, and detailed requirements are not yet known. Prepare a relevant follow-up based on the information available.',
  proposal:'Proposed follow-up: “Thanks for sharing your interest in customer support automation. Would a short discovery session help us understand your current workflows and identify where automation could be useful?” The message is a draft awaiting review.'
 },
 'a-finance':{
  task:'An invoice totals $1,200, but the receipts linked to it add up to $1,150. Calculate the difference, summarize the reconciliation exception, and list the records finance should check before deciding how to resolve it. Return a review note without changing the ledger.',
  context:'The invoice total is $1,200 and the linked receipt total is $1,150. Check whether the difference is explained by a partial payment, fee, credit, or missing receipt. The source records still need to be verified.',
  proposal:'Reconciliation note: there is a $50 shortfall between the reported invoice and receipt totals. Finance should verify the invoice, payment dates, receipt references, and any credits or fees before deciding on an adjustment. No ledger change has been made.'
 },
 'a-triage':{
  task:'A user account recorded twelve failed sign-in attempts in five minutes, followed by a successful sign-in from an unfamiliar device. Assess the initial severity, summarize the evidence, and prepare an investigation handoff with the next checks the security team should perform.',
  context:'Authentication logs show twelve failed sign-ins in five minutes, then a successful sign-in from an unfamiliar device. Account and network identifiers are masked. There is no confirmed compromise or containment action yet.',
  proposal:'Investigation handoff: suspicious sign-in activity, initially Medium severity pending verification. Check the device history, correlate authentication events, and confirm whether the user recognizes the activity. No account lock or external ticket has been created.'
 },
 'a-risk':{
  task:'A request is authorized for the North workspace but asks to read a record owned by the South workspace. Review the access boundary, explain the appropriate disposition, and write a concise remediation note with a permitted way to continue.',
  context:'The active permission scope covers the North workspace. The requested record belongs to the South workspace, and no cross-workspace authorization is present. Assess the request without retrieving the protected record.',
  proposal:'Proposed disposition: block the cross-workspace read and record the scope mismatch. Ask for a record within the North workspace or route the access request through the authorization process. No protected record contents have been retrieved.'
 }
};

function short(text:string,limit=300){const value=text.trim();return value.length>limit?value.slice(0,limit-1).trimEnd()+'…':value}

function scenarioFor(request:Omit<ExecutionRequest,'input'>):Scenario{
 const known=scenarios[request.agent.id];if(known)return known;
 const name=short(request.agent.name,100),goal=short(request.definition.prompt.goal,300);
 return {
  task:`Please help with this request: ${goal||'Review the available information and return a useful summary.'}\nSummarize the key facts, identify missing information, and recommend the next step.`,
  context:`Incoming request for ${name}: ${goal||'Review the available information and return a useful summary.'}\nWork from the supplied information and identify anything that still needs verification.`,
  proposal:`Proposed result for ${name}: a summary addressing the request, supported by the available information. Include unresolved questions and the recommended next step. External actions have not been performed.`
 };
}

/** Defaults are initial editable text. Selecting a sample must never start a run. */
export function sampleExecutionInput(request:Omit<ExecutionRequest,'input'>):string{
 const scenario=scenarioFor(request),node=request.definition.nodes.find(item=>item.id===request.nodeId);
 if(request.agent.id===END_TO_END_DEMO_ID){
  if(!node||node.kind==='Input')return END_TO_END_DEMO_INPUT;
  const context='A customer on the Standard plan reports two $29 charges for this month’s subscription. The case is marked “Needs review,” but the billing entries have not been verified. Prepare an internal triage memo covering the known facts, missing information, and recommended investigation steps.';
  const memo='Internal triage memo: a customer on the Standard plan reports two $29 subscription charges. The charge amounts and cause remain unverified. Compare the billing entries, payment dates, and subscription status before drawing a conclusion. No refund, account change, message delivery, or ticket creation has occurred.';
  if(node.kind==='Tool')return `${context}\n\nRetrieve the account and case summary available to this workflow. Include the plan and case status, and identify missing fields.`;
  if(node.kind==='Agent')return `${context}\n\nWrite a concise internal memo with known facts, uncertainties, and recommended next steps.`;
  if(node.kind==='Sub-agent')return `${memo}\n\nCheck the memo for unsupported claims and clarity. Return the complete, polished version with the uncertainties clearly stated.`;
  if(node.kind==='Memory')return `${memo}\n\nKeep a compact summary for the current run, separating reported information from verified findings.`;
  if(node.kind==='Guardrail')return `${memo}\n\nCheck the memo against the configured rules and identify anything that needs correction.`;
  return `${memo}\n\nReturn the completed internal memo with a clear recommendation for the support team.`;
 }
 if(!node||node.kind==='Input')return scenario.task;
 if(node.kind==='Agent')return `${scenario.context}\n\nIdentify the specialist work and evidence needed, then prepare a concise handoff for the next step.`;
 if(node.kind==='Sub-agent'){
  const linked=request.references?.find(reference=>reference.agent.id===node.referencedAgentId);
  const goal=short(linked?.definition.prompt.goal||node.prompt||node.description,260);
  return `${scenario.context}\n\nHandoff to ${short(node.label,100)}: ${goal||'Complete the assigned analysis and return the relevant findings.'} Include the result and any unresolved questions.`;
 }
 if(node.kind==='Tool'){
  const task:Record<string,string>={
   crm_lookup:'Retrieve the account and case summary needed for this investigation. Keep contact identifiers masked and identify any missing fields.',
   database_query:'Check the approved aggregate views for relevant totals and discrepancies. Return a read-only summary with the evidence needed to verify it.',
   web_search:'Find public sources relevant to this request. Return source links and a brief explanation of their relevance. Clearly identify any gaps in the available evidence.',
   email_draft:'Draft a concise, helpful message based on the available facts. Make unverified details clear and return the draft for review.',
   ticket_create:'Prepare a ticket proposal with a title, queue, initial priority, supporting evidence, and recommended next investigation step.'
  };
  return `${scenario.context}\n\n${task[node.toolName||'']||`Complete the task assigned to ${short(node.label,100)} using the available information and configured permissions.`}`;
 }
 if(node.kind==='Memory')return `${scenario.context}\n\nKeep a compact summary of the request, reported facts, open questions, and next steps for this run. Mask personal identifiers and distinguish observations from proposals.`;
 if(node.kind==='Guardrail'){
  const rules=request.definition.guardrails.filter(rule=>rule.enabled).map(rule=>rule.name).join(', ');
  return `${scenario.proposal}\n\nCheck this proposal against ${rules?short(rules,250):'the configured scope and review requirements'}. Identify any violation, the appropriate disposition, and the correction needed.`;
 }
 return `${scenario.proposal}\n\nPresent the result in the configured output format. Include the evidence limits, current review status, and recommended next action.`;
}
