import type {AgentNode} from '../governance/types';

type NodeKind=AgentNode['kind'];

export const isGenerationNode=(kind:NodeKind)=>kind==='Agent'||kind==='Sub-agent';

const outputLabels:Record<NodeKind,string>={
 Input:'Accepted input (unchanged)',
 Agent:'Generated response',
 'Sub-agent':'Generated response',
 Tool:'Tool function result',
 Memory:'Prepared context',
 Guardrail:'Checked context',
 Output:'Returned output',
};
export const nodeOutputLabel=(kind:NodeKind)=>outputLabels[kind];

const explanations:Record<NodeKind,string>={
 Input:'Accepts the task and evaluates applicable input policies. Accepted text passes through unchanged.',
 Agent:'Uses the saved model and instructions to generate a response from the incoming context.',
 'Sub-agent':'Uses the specialist role and its saved model and instructions to generate a response from the incoming context.',
 Tool:'Runs the selected local tool function after applicable policy checks. The output is the function result.',
 Memory:'Prepares run-scoped context using the configured redaction and retained-line limits. Text can remain unchanged when no changes are needed.',
 Guardrail:'Evaluates the configured policy rules and passes permitted context through unchanged.',
 Output:'Evaluates applicable output policies and returns the preceding result unchanged. For this test, the input below stands in for that result.',
};
export const nodeTestExplanation=(kind:NodeKind)=>explanations[kind];

const editorIntroductions:Record<NodeKind,string>={
 Input:'Inspect the task entry point, then test the input against applicable saved policies. This node accepts text without generating a response.',
 Agent:'Inspect the role, edit its instructions, and test the response generated from your input.',
 'Sub-agent':'Choose a specialist role or linked agent, edit its instructions, and test its generated response.',
 Tool:'Choose a local tool capability and test its function result with your own input.',
 Memory:'Inspect this node and its parent memory settings, then test how redaction and retained-line limits prepare context.',
 Guardrail:'Inspect the saved rules under parent configuration, then test whether the supplied context is permitted.',
 Output:'Inspect the final handoff and test applicable output policies. This node returns its incoming text; it does not generate a response.',
};
export const nodeEditorIntroduction=(kind:NodeKind)=>editorIntroductions[kind];
